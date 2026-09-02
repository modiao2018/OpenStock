import { log, logError } from '../config';
import { fetchWithRetry } from '../http';
import { getKv, setKv } from '../store';
import { pushMessage } from '../notify';
import { fetchDailyBars, formingSessionDate } from '../alpaca-daily';
import { getCikMap } from './edgar';
import { fetchFilingXml } from './insider-edgar';
import { parseForm4Xml } from '../form-parse';
import { connectToDatabase } from '@/database/mongoose';
import { InsiderFiling, InsiderTrade } from '@/database/models/insider.model';
import { fetchTwelveDaily, twelveConfigured } from '@/lib/twelvedata';
import { getAiDipPool } from '../../../lib/ai-dips-pool';
import { completedBars } from '../../../lib/ai-dips-math';
import { shiftDate } from '../../../lib/insider-math';
import {
  alertSignature,
  compareQuote,
  findMissingFilings,
  rotateSample,
  DEFAULT_MISSING_OPTS,
  type FilingKey,
  type QuoteMismatch,
} from '../../../lib/xcheck-math';
import type { MonitorConfig, NewEvent } from '../types';

// 每轮抽样股数：Twelve 免费档 800 credits/天，探活 48 + 抽样 10 留足余量
const SAMPLE_SIZE = 10;
// txCodes 未解析的候选申报每轮最多补拉的 XML 数（SEC 限速）
const MAX_BACKFILL = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface QuoteXcheckResult {
  checkedAt: string;
  sessionDate: string;
  sampled: string[];
  mismatches: QuoteMismatch[];
  errors: Array<{ symbol: string; source: string; message: string }>;
}

export interface InsiderXcheckResult {
  checkedAt: string;
  windowFrom: string;
  windowTo: string;
  checkedFilings: number;
  missing: Array<{ symbol: string; filingDate: string; accessionNumber: string; url: string }>;
}

export const XCHECK_QUOTES_KEY = 'source_xcheck:quotes';
export const XCHECK_INSIDER_KEY = 'source_xcheck:insider';

/** 签名变化才推送：同一批不一致每天重复出现不刷屏，恢复后再出现会重新提醒 */
async function pushIfChanged(config: MonitorConfig, sigKey: string, sig: string, title: string, body: string): Promise<void> {
  const prev = (await getKv(sigKey)) ?? '';
  if (sig && sig !== prev) {
    const siteUrl = process.env.BETTER_AUTH_URL;
    await pushMessage(config.env, { title, body, urgent: false, url: siteUrl ? `${siteUrl}/status` : undefined });
  }
  await setKv(sigKey, sig);
}

async function checkQuotes(config: MonitorConfig): Promise<void> {
  if (!twelveConfigured()) {
    log('xcheck', '未配置 TWELVEDATA_API_KEY，跳过行情交叉验证');
    return;
  }
  if (!config.env.alpacaKey || !config.env.alpacaSecret || !config.env.finnhubKey) {
    log('xcheck', 'Alpaca/Finnhub 未配置，跳过行情交叉验证');
    return;
  }
  // 只在收盘后跑，且每个 session 一次（XCHECK_FORCE=1 仅供本地验证跳过门闩）
  if (formingSessionDate() !== undefined && process.env.XCHECK_FORCE !== '1') return;

  const pool = await getAiDipPool();
  if (pool.length === 0) return;
  const cursor = Number((await getKv('xcheck_quotes_cursor')) ?? '0') || 0;
  const { picked, next } = rotateSample(pool, cursor, SAMPLE_SIZE);
  const symbols = picked.map((p) => p.symbol);

  const barsBySymbol = await fetchDailyBars(config, symbols);
  const last = new Map<string, { date: string; c: number }>();
  for (const s of symbols) {
    const bars = completedBars(barsBySymbol[s] ?? []);
    if (bars.length > 0) last.set(s, bars[bars.length - 1]);
  }
  const sessionDate = [...last.values()].reduce((m, b) => (b.date > m ? b.date : m), '');
  if (!sessionDate) {
    log('xcheck', '无 Alpaca 日线，跳过');
    return;
  }
  if ((await getKv('xcheck_quotes_session')) === sessionDate) return;

  const errors: QuoteXcheckResult['errors'] = [];
  const mismatches: QuoteMismatch[] = [];
  for (const symbol of symbols) {
    const alpaca = last.get(symbol);
    let finnhub: { c: number; t: number } | null = null;
    try {
      const res = await fetchWithRetry(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${config.env.finnhubKey}`,
        {},
        { timeoutMs: 10_000 }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const q = (await res.json()) as { c?: number; t?: number };
      if (q.c && q.t) finnhub = { c: q.c, t: q.t };
    } catch (err) {
      errors.push({ symbol, source: 'finnhub', message: err instanceof Error ? err.message : String(err) });
    }
    await sleep(1100);

    let twelve: { date: string; close: number } | null = null;
    try {
      const bars = await fetchTwelveDaily(symbol, 2);
      // 取与 Alpaca session 同日的那根；没有就取最新一根让 compareQuote 报日期不符
      twelve = bars.find((b) => b.date === alpaca?.date) ?? bars[0] ?? null;
    } catch (err) {
      errors.push({ symbol, source: 'twelvedata', message: err instanceof Error ? err.message : String(err) });
    }
    // 免费档 8 credits/min
    await sleep(8000);

    const mm = compareQuote({
      symbol,
      date: alpaca?.date ?? sessionDate,
      alpaca: alpaca?.c ?? null,
      finnhub,
      twelve,
    });
    if (mm) mismatches.push(mm);
  }

  const result: QuoteXcheckResult = {
    checkedAt: new Date().toISOString(),
    sessionDate,
    sampled: symbols,
    mismatches,
    errors,
  };
  await setKv(XCHECK_QUOTES_KEY, JSON.stringify(result));
  await setKv('xcheck_quotes_session', sessionDate);
  await setKv('xcheck_quotes_cursor', String(next));
  log('xcheck', `行情核对 ${sessionDate}：抽样 ${symbols.length} 只，不一致 ${mismatches.length}，错误 ${errors.length}`);

  const lines = mismatches.map((m) =>
    m.reason === 'dateMismatch'
      ? `${m.symbol} Twelve 最新日 ${m.twelveDate} ≠ Alpaca ${m.date}`
      : `${m.symbol} Alpaca $${m.alpaca?.toFixed(2)} vs Twelve $${m.twelve?.toFixed(2)}（偏差 ${m.deviationPct?.toFixed(2)}%）`
  );
  await pushIfChanged(
    config,
    'source_xcheck:quotes:sig',
    alertSignature(mismatches.map((m) => `${m.symbol}:${m.reason}`)),
    `行情交叉验证｜${mismatches.length} 只不一致`,
    `${sessionDate} 收盘价多源比对（抽样 ${symbols.length} 只）\n${lines.join('\n')}\n请到数据源状态页查看`
  );
}

async function checkInsiders(config: MonitorConfig): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if ((await getKv('xcheck_insider_date')) === today) return;
  await connectToDatabase();

  const opts = DEFAULT_MISSING_OPTS;
  const from = shiftDate(today, -opts.lookbackDays);
  const to = shiftDate(today, -opts.graceDays);
  const filingDocs = await InsiderFiling.find({ form: '4', filingDate: { $gte: from, $lte: to } }).lean();
  const symbols = [...new Set(filingDocs.map((d) => d.symbol))];
  const tradeDocs = symbols.length
    ? await InsiderTrade.find(
        { symbol: { $in: symbols }, filingDate: { $gte: shiftDate(from, -opts.toleranceDays), $lte: shiftDate(to, opts.toleranceDays) } },
        { symbol: 1, filingDate: 1 }
      ).lean()
    : [];

  const filings: FilingKey[] = filingDocs.map((d) => ({
    symbol: d.symbol,
    filingDate: d.filingDate,
    accessionNumber: d.accessionNumber,
    txCodes: d.txCodes ?? null,
  }));
  const trades = tradeDocs.map((d) => ({ symbol: d.symbol, filingDate: d.filingDate }));
  let candidates = findMissingFilings(filings, trades, today, opts);

  // 建档路径没拉过 XML 的候选：补解析交易代码，剔除纯期权/授予类申报
  const unparsed = candidates.filter((c) => c.txCodes === null).slice(0, MAX_BACKFILL);
  if (unparsed.length > 0) {
    const cikMap = await getCikMap(config);
    const byAccession = new Map(filingDocs.map((d) => [d.accessionNumber, d]));
    for (const c of unparsed) {
      const doc = byAccession.get(c.accessionNumber);
      const cik = cikMap[c.symbol];
      const primaryDoc = doc?.url.split('/').pop() ?? '';
      if (!doc || !cik || !primaryDoc) continue;
      try {
        const codes = [...new Set(parseForm4Xml(await fetchFilingXml(config, cik, c.accessionNumber, primaryDoc)).map((t) => t.transactionCode))];
        c.txCodes = codes;
        await InsiderFiling.updateOne({ accessionNumber: c.accessionNumber }, { $set: { txCodes: codes } });
      } catch (err) {
        logError('xcheck:backfill', err);
      }
      await sleep(150);
    }
    candidates = findMissingFilings(candidates, trades, today, opts);
  }

  const missing = candidates
    .filter((c) => c.txCodes !== null)
    .map((c) => {
      const doc = filingDocs.find((d) => d.accessionNumber === c.accessionNumber);
      return { symbol: c.symbol, filingDate: c.filingDate, accessionNumber: c.accessionNumber, url: doc?.url ?? '' };
    });
  const result: InsiderXcheckResult = {
    checkedAt: new Date().toISOString(),
    windowFrom: from,
    windowTo: to,
    checkedFilings: filings.length,
    missing,
  };
  await setKv(XCHECK_INSIDER_KEY, JSON.stringify(result));
  await setKv('xcheck_insider_date', today);
  log('xcheck', `内部人核对 ${from}~${to}：EDGAR ${filings.length} 份，Finnhub 缺失 ${missing.length}`);

  await pushIfChanged(
    config,
    'source_xcheck:insider:sig',
    alertSignature(missing.map((m) => m.accessionNumber)),
    `内部人数据交叉验证｜Finnhub 缺失 ${missing.length} 份申报`,
    `EDGAR 有 Form 4 但 Finnhub 超过 ${opts.graceDays} 天仍无对应交易：\n` +
      missing.slice(0, 10).map((m) => `${m.symbol} ${m.filingDate}`).join('\n') +
      (missing.length > 10 ? `\n…共 ${missing.length} 份` : '') +
      '\n请到数据源状态页查看'
  );
}

/**
 * 多源交叉验证：行情（Alpaca 日线 vs Twelve Data，Finnhub 作第三参考）每个
 * 交易日收盘后抽样核对一次；内部人（EDGAR Form 4 vs Finnhub 交易表）每日一次。
 * 结果写 KV 供 /status 展示，不一致集合变化时推 Bark。不产生时间线事件。
 */
export async function collectXcheck(config: MonitorConfig): Promise<NewEvent[]> {
  try {
    await checkQuotes(config);
  } catch (err) {
    logError('xcheck:quotes', err);
  }
  try {
    await checkInsiders(config);
  } catch (err) {
    logError('xcheck:insider', err);
  }
  return [];
}
