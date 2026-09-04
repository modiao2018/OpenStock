import { log, logError } from '../config';
import { getKv, setKv } from '../store';
import { fetchWithRetry } from '../http';
import { edgarHeaders, getCikMap } from './edgar';
import { parseForm144Xml, parseForm4Xml } from '../form-parse';
import { SEC_MIN_REQUEST_GAP_MS, filingDocUrl, secTimestampToIso, submissionsUrl } from '../../../lib/edgar';
import { connectToDatabase } from '@/database/mongoose';
import { InsiderFiling } from '@/database/models/insider.model';
import {
  CLUSTER_DAYS,
  CLUSTER_MIN_SELLERS,
  notifyInsiderTriggers,
  recentSellsFromDb,
  type InsiderAlertItem,
} from '../insider-alert';
import { getAiDipPool } from '../../../lib/ai-dips-pool';
import { aggregateSameDayTxs, decideNotify, insiderEdgarSeedKey, isLateFiling, shiftDate, type InsiderTx } from '../../../lib/insider-math';
import type { MonitorConfig, NewEvent } from '../types';

// 只看最近几天的申报：更早的要么已被 Finnhub 链路覆盖，要么是首访建档
const LOOKBACK_DAYS = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const etParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
});

/** EDGAR 受理时段 6:00–22:00 ET 且仅工作日——时段外没有新申报，跳过整轮 */
function isEdgarActiveHours(now = new Date()): boolean {
  const parts = Object.fromEntries(etParts.formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  const hhmm = `${parts.hour}:${parts.minute}`;
  return hhmm >= '05:55' && hhmm <= '22:35';
}

export async function fetchFilingXml(config: MonitorConfig, cik: string, accession: string, primaryDoc: string): Promise<string> {
  // primaryDocument 常带 xslF345X05/ 渲染前缀，filingDocUrl 会剥掉取原始 XML
  const url = filingDocUrl(cik, accession, primaryDoc);
  const res = await fetchWithRetry(url, { headers: edgarHeaders(config.env.edgarContact) }, { timeoutMs: 20_000 });
  if (!res.ok) throw new Error(`filing doc HTTP ${res.status}: ${url}`);
  return res.text();
}

/**
 * EDGAR 即时内部人监控（AI 低吸股票池）：10 分钟轮询池子股票的 submissions，
 * 新 Form 4 = 申报即知（当天申报的当天提醒，绕开 Finnhub 摄取延迟）；
 * 新 Form 144 = 拟卖出预告（下单当天提交，"当天知道卖出意图"的唯一合规信号）。
 * 提醒阈值与 Finnhub 链路一致，共享管线按申报日跨源去重。不产生时间线事件。
 */
export async function collectInsiderEdgar(config: MonitorConfig): Promise<NewEvent[]> {
  if (!isEdgarActiveHours()) return [];
  await connectToDatabase();

  const pool = await getAiDipPool();
  const cikMap = await getCikMap(config);
  // 按 symbol 首访建档：新标的的近几天存量申报只入库不推送。
  // 以 KV 标记为准（库里有记录也算），否则 5 天内没申报的标的永远"未建档"，
  // 第一份真实申报会被当成存量吞掉
  const seededSymbols = new Set<string>(await InsiderFiling.distinct('symbol'));
  for (const meta of pool) {
    if (!seededSymbols.has(meta.symbol) && (await getKv(insiderEdgarSeedKey(meta.symbol)))) seededSymbols.add(meta.symbol);
  }
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = shiftDate(today, -LOOKBACK_DAYS);
  const opts = { sellMinUsd: config.env.insiderSellMinUsd, clusterDays: CLUSTER_DAYS, clusterMinSellers: CLUSTER_MIN_SELLERS };

  const triggers = new Map<string, InsiderAlertItem[]>();
  const accessionsBySymbol = new Map<string, string[]>();
  let seedCount = 0;
  let fetchErrors = 0;

  for (const meta of pool) {
    const cik = cikMap[meta.symbol];
    if (!cik) continue; // ETF 等无 CIK/无申报义务的标的
    try {
      const res = await fetchWithRetry(
        submissionsUrl(cik),
        { headers: edgarHeaders(config.env.edgarContact) },
        { timeoutMs: 30_000 }
      );
      if (!res.ok) throw new Error(`${meta.symbol} submissions HTTP ${res.status}`);
      const data = (await res.json()) as any;
      const recent = data.filings?.recent ?? {};
      const forms: string[] = recent.form ?? [];
      const isSeed = !seededSymbols.has(meta.symbol);

      for (let i = 0; i < forms.length; i++) {
        if (forms[i] !== '4' && forms[i] !== '144') continue;
        const filingDate: string = recent.filingDate?.[i] ?? '';
        if (!filingDate || filingDate < cutoff) continue;
        const accession: string = recent.accessionNumber[i];
        const primaryDoc: string = recent.primaryDocument?.[i] ?? '';
        const url = filingDocUrl(cik, accession, primaryDoc);

        // accession 唯一索引幂等入库，11000 冲突 = 已见过
        try {
          await InsiderFiling.create({
            symbol: meta.symbol,
            accessionNumber: accession,
            form: forms[i],
            filingDate,
            acceptedAt: (() => { const iso = secTimestampToIso(recent.acceptanceDateTime?.[i]); return iso ? new Date(iso) : null; })(),
            url,
            firstSeen: isSeed,
          });
        } catch (err: unknown) {
          if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) continue;
          throw err;
        }
        if (isSeed) {
          seedCount++;
          continue;
        }
        if (!primaryDoc) continue;

        // 新申报：拉原始 XML 解析出交易/拟售明细
        const xml = await fetchFilingXml(config, cik, accession, primaryDoc);
        const items: InsiderAlertItem[] = [];
        if (forms[i] === '4') {
          const parsedTxs = parseForm4Xml(xml);
          // 交易代码集合供 xcheck 判断"该申报是否应出现在 Finnhub 的 P/S 表里"
          await InsiderFiling.updateOne(
            { accessionNumber: accession },
            { $set: { txCodes: [...new Set(parsedTxs.map((t) => t.transactionCode))] } }
          );
          // 同一人同一天的多笔分单（券商按价位拆成十几行）合并成一笔再判阈值：
          // ALAB 2026-09-01 一人 24 行合计 $51M，逐行判只报了其中 2 行 $27M
          const openMarket: InsiderTx[] = parsedTxs
            .filter((t) => t.transactionCode === 'P' || t.transactionCode === 'S')
            .map((t) => ({
              symbol: meta.symbol,
              name: t.name,
              change: t.change,
              transactionPrice: t.price,
              transactionCode: t.transactionCode as 'P' | 'S',
              transactionDate: t.transactionDate,
              filingDate,
            }));
          for (const tx of aggregateSameDayTxs(openMarket)) {
            // 迟报（如 9 月才申报 7 月的买入）是旧闻，只入库不提醒
            if (isLateFiling(tx)) {
              log('insider-edgar', `${meta.symbol} 跳过迟报：${tx.name} ${tx.transactionDate} ${tx.transactionCode}（申报 ${filingDate}）`);
              continue;
            }
            const recentSells = tx.transactionCode === 'S'
              ? await recentSellsFromDb(meta.symbol, shiftDate(tx.transactionDate, -CLUSTER_DAYS))
              : [];
            const decision = decideNotify(tx, recentSells, opts);
            if (decision.notify && decision.reason) items.push({ tx, reason: decision.reason });
          }
        } else {
          const parsed = parseForm144Xml(xml);
          // 拟售预告只报大额（与卖出阈值一致），小额例行 144 静默入库
          if (parsed.valueUsd !== null && parsed.valueUsd > opts.sellMinUsd) {
            const shares = parsed.shares ?? 1;
            items.push({
              intent: true,
              reason: 'intentSell',
              tx: {
                symbol: meta.symbol,
                name: parsed.person ?? '关联方',
                change: -shares,
                // 用 拟售总值/股数 折算均价，让金额展示与阈值逻辑复用现有管线
                transactionPrice: parsed.valueUsd / shares,
                transactionCode: 'S',
                transactionDate: parsed.approxSaleDate ?? filingDate,
                filingDate,
              },
            });
          }
        }
        if (items.length > 0) {
          triggers.set(meta.symbol, [...(triggers.get(meta.symbol) ?? []), ...items]);
          accessionsBySymbol.set(meta.symbol, [...(accessionsBySymbol.get(meta.symbol) ?? []), accession]);
        }
      }
      if (!seededSymbols.has(meta.symbol)) await setKv(insiderEdgarSeedKey(meta.symbol), today);
    } catch (err) {
      fetchErrors++;
      logError('insider-edgar', err);
    }
    await sleep(SEC_MIN_REQUEST_GAP_MS); // SEC 限速 10 req/s，保守一点
  }

  if (seedCount > 0) log('insider-edgar', `建档 ${seedCount} 份申报（新标的存量，不推送）`);

  const delivered = await notifyInsiderTriggers('insider-edgar', config, pool, triggers);
  for (const symbol of delivered) {
    const accessions = accessionsBySymbol.get(symbol) ?? [];
    if (accessions.length > 0) {
      await InsiderFiling.updateMany({ accessionNumber: { $in: accessions } }, { $set: { notified: true } });
    }
  }

  if (fetchErrors > 0 && fetchErrors * 3 >= pool.length) {
    throw new Error(`EDGAR submissions 拉取失败 ${fetchErrors}/${pool.length} 只`);
  }
  return [];
}
