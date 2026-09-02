import { log, logError } from '../config';
import { fetchWithRetry } from '../http';
import { getKv, setKv, sha256 } from '../store';
import { pushMessage } from '../notify';
import { ACTION_PREFIX, ACTION_WORDS, extractAction } from '../analyze';
import { fetchDailyBars, etToday, formingSessionDate } from '../alpaca-daily';
import { connectToDatabase } from '@/database/mongoose';
import { InsiderInsight, InsiderTrade } from '@/database/models/insider.model';
import { resolveLlmConfig } from '@/lib/llm-config';
import { callAIProviderWithConfig } from '@/lib/ai-provider';
import { getAiDipPool } from '../../../lib/ai-dips-pool';
import { completedBars, computeDipStats, type DipStats } from '../../../lib/ai-dips-math';
import {
  decideNotify,
  filterOpenMarketTxs,
  formatUsdCompact,
  shiftDate,
  summarizeInsiderTxs,
  txAmountUsd,
  txExternalKey,
  type InsiderSummary,
  type InsiderTx,
  type NotifyReason,
  type RawInsiderTx,
} from '../../../lib/insider-math';
import type { MonitorConfig, NewEvent } from '../types';

const FINNHUB_URL = 'https://finnhub.io/api/v1/stock/insider-transactions';
// 页面与聚合统计的回看窗口（天）
const WINDOW_DAYS = 90;
// 集中卖出判定：7 日内 ≥3 名不同内部人卖出
const CLUSTER_DAYS = 7;
const CLUSTER_MIN_SELLERS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REASON_ZH: Record<NotifyReason, string> = {
  buy: '内部人买入',
  largeSell: '内部人大额卖出',
  clusterSell: '内部人集中卖出',
};

/** 与 web/Finnhub 共用一个 key，免费档 60 req/min，串行 + 1.1s 间隔留足余量 */
async function fetchSymbolTxs(key: string, symbol: string, from: string, to: string): Promise<InsiderTx[]> {
  const url = `${FINNHUB_URL}?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${key}`;
  const res = await fetchWithRetry(url, {}, { timeoutMs: 15_000 });
  if (!res.ok) throw new Error(`Finnhub insider-transactions HTTP ${res.status}`);
  const data = (await res.json()) as { data?: RawInsiderTx[] };
  return filterOpenMarketTxs(symbol, data.data ?? []);
}

const fmtTx = (tx: InsiderTx): string => {
  const side = tx.transactionCode === 'P' ? '买入' : '卖出';
  const amount = txAmountUsd(tx);
  const price = tx.transactionPrice > 0 ? ` @ $${tx.transactionPrice.toFixed(2)}` : '';
  const usd = amount !== null ? ` ≈ ${formatUsdCompact(amount)}` : '（金额未知）';
  return `${tx.name} ${tx.transactionDate.slice(5)} ${side} ${Math.abs(tx.change).toLocaleString('en-US')} 股${price}${usd}`;
};

const fmtSummary = (s: InsiderSummary): string =>
  `近 ${WINDOW_DAYS} 日内部人：买 ${s.buyCount} 笔 ${formatUsdCompact(s.buyUsd)} / 卖 ${s.sellCount} 笔 ${formatUsdCompact(s.sellUsd)}，净${s.netUsd >= 0 ? '买入' : '卖出'} ${formatUsdCompact(Math.abs(s.netUsd))}`;

const fmtPct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

const fmtDipLine = (symbol: string, stats: DipStats | null): string =>
  stats
    ? `${symbol} 收 $${stats.lastClose.toFixed(2)}，连跌 ${stats.streakDays} 天 累计 ${fmtPct(stats.streakDeclinePct)}（30 日回撤 ${fmtPct(stats.drawdownFromHighPct)}）`
    : `${symbol} 无行情数据`;

/**
 * 用户核心纪律「不管基本面如何，不能买贵」写死在 prompt 里：
 * 内部人买入公布时（Form 4 有 T+2 延迟）价格往往已反应，
 * 回撤不足时必须提示勿追高，只有跌得够深利好才值得低吸。
 */
function buildPrompt(
  meta: { symbol: string; name: string },
  stats: DipStats | null,
  items: Array<{ tx: InsiderTx; reason: NotifyReason }>,
  summary: InsiderSummary
): string {
  return (
    '你是美股 AI 板块低吸监控助手，用户是中国投资者，核心纪律是：' +
    '「不管基本面如何，不能买贵」——利好（含内部人买入）公布前股价往往已提前反应，' +
    '若当前股价并未处于回撤低位（连跌很短、30 日回撤很小甚至接近高位），' +
    '即使出现内部人买入也必须提示谨慎/观望，防止追高；只有回撤充分时利好才值得低吸。\n\n' +
    `标的: ${meta.symbol} ${meta.name}\n` +
    `当前行情: ${fmtDipLine(meta.symbol, stats)}\n` +
    `本次触发的内部人交易（SEC Form 4，申报有 T+2 延迟，价格可能已反应）:\n` +
    items.map(({ tx }) => `- ${fmtTx(tx)}（申报 ${tx.filingDate}）`).join('\n') +
    `\n${fmtSummary(summary)}\n\n` +
    '请用简体中文输出不超过 200 字的纯文本（不要 markdown）：' +
    '先一句话概括本次内部人动向及其信号强度；' +
    '再结合当前回撤位置判断是否符合"买得便宜"的纪律——回撤不足时明确提示勿追高；' +
    `最后一行必须是"${ACTION_PREFIX}X"，X 只能从【${ACTION_WORDS.join(' / ')}】中选一个，` +
    '后接一句执行说明（时机/仓位/等待信号）。'
  );
}

async function analyzeTrigger(
  meta: { symbol: string; name: string },
  stats: DipStats | null,
  items: Array<{ tx: InsiderTx; reason: NotifyReason }>,
  summary: InsiderSummary
): Promise<string | null> {
  const llm = await resolveLlmConfig();
  if (!llm) {
    log('insider', 'LLM 未配置，跳过分析');
    return null;
  }
  try {
    const start = Date.now();
    const reply = await callAIProviderWithConfig(buildPrompt(meta, stats, items, summary), {
      name: llm.provider,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      model: llm.model,
    });
    const analysis = reply.trim().slice(0, 500);
    log('insider', `${meta.symbol} 分析完成（${Date.now() - start}ms）`);
    return analysis;
  } catch (err) {
    logError('insider:analyze', err);
    return null;
  }
}

/**
 * 内部人买卖监控（AI 低吸股票池）：拉取 Finnhub Form 3/4/5 数据，
 * 新交易按「买入必报 / 卖出仅大额或集中时报」推 Bark，附 AI 综合分析
 * （结合连跌/回撤位置给"不买贵"纪律下的建议）。不产生时间线事件。
 */
export async function collectInsider(config: MonitorConfig): Promise<NewEvent[]> {
  if (!config.env.finnhubKey) {
    log('insider', '未配置 NEXT_PUBLIC_FINNHUB_API_KEY，跳过');
    return [];
  }
  await connectToDatabase();

  const today = etToday();
  const from = shiftDate(today, -WINDOW_DAYS);
  // 每轮从 DB 读股票池——网页端改动无需重启 daemon
  const pool = await getAiDipPool();
  // 按 symbol 判断是否已建档：库里没有该股任何记录 = 新加入池子的标的，
  // 其 90 天存量只入库不推送——扩池时不会把历史申报一次性刷屏
  const seededSymbols = new Set<string>(await InsiderTrade.distinct('symbol'));

  // 逐 symbol 串行拉取；单只失败不废掉整轮
  const fetched: InsiderTx[] = [];
  let fetchErrors = 0;
  for (const meta of pool) {
    try {
      fetched.push(...(await fetchSymbolTxs(config.env.finnhubKey, meta.symbol, from, today)));
    } catch (err) {
      fetchErrors++;
      logError('insider', err);
    }
    await sleep(1100);
  }
  if (fetched.length === 0 && fetchErrors === pool.length && pool.length > 0) {
    throw new Error('Finnhub insider-transactions 全部失败');
  }

  // 唯一索引幂等入库，11000 冲突 = 已见过
  const newTxs: Array<{ id: string; tx: InsiderTx }> = [];
  let seedCount = 0;
  for (const tx of fetched) {
    const isSeed = !seededSymbols.has(tx.symbol);
    try {
      const doc = await InsiderTrade.create({
        symbol: tx.symbol,
        externalId: sha256(txExternalKey(tx)),
        name: tx.name,
        transactionCode: tx.transactionCode,
        change: tx.change,
        transactionPrice: tx.transactionPrice,
        amountUsd: txAmountUsd(tx),
        transactionDate: tx.transactionDate,
        filingDate: tx.filingDate,
        firstSeen: isSeed,
      });
      if (isSeed) seedCount++;
      else newTxs.push({ id: String(doc._id), tx });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) continue;
      throw err;
    }
  }

  if (seedCount > 0) log('insider', `建档 ${seedCount} 笔（新标的存量，不推送）`);
  if (newTxs.length === 0) {
    if (seedCount === 0) log('insider', '无新增内部人交易');
    return [];
  }
  log('insider', `新增 ${newTxs.length} 笔内部人交易`);

  // 逐笔判定是否提醒，按 symbol 聚合
  const opts = { sellMinUsd: config.env.insiderSellMinUsd, clusterDays: CLUSTER_DAYS, clusterMinSellers: CLUSTER_MIN_SELLERS };
  const triggers = new Map<string, Array<{ id: string; tx: InsiderTx; reason: NotifyReason }>>();
  for (const { id, tx } of newTxs) {
    let recentSells: InsiderTx[] = [];
    if (tx.transactionCode === 'S') {
      const docs = await InsiderTrade.find({
        symbol: tx.symbol,
        transactionCode: 'S',
        transactionDate: { $gte: shiftDate(tx.transactionDate, -CLUSTER_DAYS) },
      }).lean();
      recentSells = docs.map((d) => ({
        symbol: d.symbol, name: d.name, change: d.change, transactionPrice: d.transactionPrice,
        transactionCode: d.transactionCode, transactionDate: d.transactionDate, filingDate: d.filingDate,
      }));
    }
    const decision = decideNotify(tx, recentSells, opts);
    if (!decision.notify || !decision.reason) continue;
    if (decision.reason === 'clusterSell') {
      // 同一波集中卖出 7 天内只报一次
      const lastNotified = await getKv(`insider_cluster_notified:${tx.symbol}`);
      if (lastNotified && lastNotified >= shiftDate(today, -CLUSTER_DAYS)) continue;
    }
    const list = triggers.get(tx.symbol) ?? [];
    list.push({ id, tx, reason: decision.reason });
    triggers.set(tx.symbol, list);
  }
  if (triggers.size === 0) return [];

  // 行情上下文：仅为触发标的拉日线（未配 Alpaca 则降级为无行情分析）
  let barsBySymbol: Record<string, Array<{ date: string; c: number }>> = {};
  const excludeDate = formingSessionDate();
  if (config.env.alpacaKey && config.env.alpacaSecret) {
    try {
      barsBySymbol = await fetchDailyBars(config, [...triggers.keys()]);
    } catch (err) {
      logError('insider:bars', err);
    }
  }

  const siteUrl = process.env.BETTER_AUTH_URL;
  for (const [symbol, items] of triggers) {
    const meta = pool.find((m) => m.symbol === symbol) ?? { symbol, name: symbol };
    const stats = computeDipStats(completedBars(barsBySymbol[symbol] ?? [], excludeDate));
    const docs = await InsiderTrade.find({ symbol, transactionDate: { $gte: from } }).lean();
    const summary = summarizeInsiderTxs(
      docs.map((d) => ({
        symbol: d.symbol, name: d.name, change: d.change, transactionPrice: d.transactionPrice,
        transactionCode: d.transactionCode, transactionDate: d.transactionDate, filingDate: d.filingDate,
      })),
      today,
      WINDOW_DAYS
    );

    // LLM 失败不阻塞推送：body 退化为交易概要
    const analysis = await analyzeTrigger(meta, stats, items, summary);
    const action = extractAction(analysis);
    const trigger = items.map(({ tx }) => fmtTx(tx)).join('；');
    if (analysis) {
      await InsiderInsight.findOneAndUpdate(
        { symbol },
        { $set: { analysis, action, trigger } },
        { upsert: true }
      );
    }

    // 标题取最强信号：买入优先于卖出类
    const reason = items.some((i) => i.reason === 'buy') ? 'buy' : items[0].reason;
    const first = items[0].tx;
    const firstAmount = txAmountUsd(first);
    const title =
      `${REASON_ZH[reason]}${action ? `【${action}】` : ''}｜${symbol} ` +
      (items.length === 1
        ? `${first.transactionCode === 'P' ? '增持' : '减持'}${firstAmount !== null ? ' ' + formatUsdCompact(firstAmount) : ''}`
        : `${items.length} 笔交易`);
    const body =
      `${fmtDipLine(symbol, stats)}\n` +
      items.map(({ tx }) => fmtTx(tx)).join('\n') + '\n' +
      `${fmtSummary(summary)}\n` +
      (analysis ? `AI 分析: ${analysis}\n` : '') +
      '数据源 SEC Form 4（T+2 申报延迟），不构成投资建议';

    const delivered = await pushMessage(config.env, {
      title,
      body,
      urgent: false,
      url: siteUrl ? `${siteUrl}/ai-dips` : undefined,
    });
    if (delivered) {
      await InsiderTrade.updateMany({ _id: { $in: items.map((i) => i.id) } }, { $set: { notified: true } });
      if (items.some((i) => i.reason === 'clusterSell')) {
        await setKv(`insider_cluster_notified:${symbol}`, today);
      }
    }
    log('insider', `${symbol} 触发 ${items.length} 笔（${reason}，推送${delivered ? '成功' : '未送达'}）`);
  }

  return [];
}
