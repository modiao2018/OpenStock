import { log, logError } from '../config';
import { fetchWithRetry } from '../http';
import { sha256 } from '../store';
import { etToday } from '../alpaca-daily';
import { connectToDatabase } from '@/database/mongoose';
import { InsiderTrade } from '@/database/models/insider.model';
import {
  CLUSTER_DAYS,
  CLUSTER_MIN_SELLERS,
  WINDOW_DAYS,
  notifyInsiderTriggers,
  recentSellsFromDb,
  type InsiderAlertItem,
} from '../insider-alert';
import { getAiDipPool } from '../../../lib/ai-dips-pool';
import {
  DEFAULT_MAX_FILING_LAG_DAYS,
  decideNotify,
  filterOpenMarketTxs,
  isLateFiling,
  shiftDate,
  txAmountUsd,
  txExternalKey,
  type InsiderTx,
  type RawInsiderTx,
} from '../../../lib/insider-math';
import type { MonitorConfig, NewEvent } from '../types';

const FINNHUB_URL = 'https://finnhub.io/api/v1/stock/insider-transactions';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 与 web/Finnhub 共用一个 key，免费档 60 req/min，串行 + 1.1s 间隔留足余量 */
async function fetchSymbolTxs(key: string, symbol: string, from: string, to: string): Promise<InsiderTx[]> {
  const url = `${FINNHUB_URL}?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${key}`;
  const res = await fetchWithRetry(url, {}, { timeoutMs: 15_000 });
  if (!res.ok) throw new Error(`Finnhub insider-transactions HTTP ${res.status}`);
  const data = (await res.json()) as { data?: RawInsiderTx[] };
  return filterOpenMarketTxs(symbol, data.data ?? []);
}

/**
 * 内部人买卖监控（AI 低吸股票池，Finnhub 轮询链路）：拉取 Form 3/4/5 数据，
 * 新交易按「买入必报 / 卖出仅大额或集中时报」经共享管线推 Bark + AI 分析。
 * EDGAR 即时链路（insider-edgar）可能已抢先报过——共享管线按申报日去重。
 * 不产生时间线事件。
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
  // ≥1/3 标的拉取失败 = 疑似限流/故障。处理完成功部分后抛错，让 runCollector
  // 的心跳计数（连续 3 次 → Bark「监控异常」）和网页端健康横幅感知到
  const fetchDegraded = fetchErrors > 0 && fetchErrors * 3 >= pool.length;
  const degradedError = () =>
    new Error(`Finnhub insider 拉取失败 ${fetchErrors}/${pool.length} 只（疑似限流或故障）`);

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
    if (fetchDegraded) throw degradedError();
    return [];
  }
  log('insider', `新增 ${newTxs.length} 笔内部人交易`);

  // 逐笔判定是否提醒，按 symbol 聚合（去重/冷却在共享管线里做）
  const opts = { sellMinUsd: config.env.insiderSellMinUsd, clusterDays: CLUSTER_DAYS, clusterMinSellers: CLUSTER_MIN_SELLERS };
  const triggers = new Map<string, InsiderAlertItem[]>();
  const idsBySymbol = new Map<string, string[]>();
  let lateCount = 0;
  for (const { id, tx } of newTxs) {
    if (isLateFiling(tx)) { lateCount++; continue; }
    const recentSells = tx.transactionCode === 'S'
      ? await recentSellsFromDb(tx.symbol, shiftDate(tx.transactionDate, -CLUSTER_DAYS))
      : [];
    const decision = decideNotify(tx, recentSells, opts);
    if (!decision.notify || !decision.reason) continue;
    const list = triggers.get(tx.symbol) ?? [];
    list.push({ tx, reason: decision.reason });
    triggers.set(tx.symbol, list);
    idsBySymbol.set(tx.symbol, [...(idsBySymbol.get(tx.symbol) ?? []), id]);
  }

  if (lateCount > 0) log('insider', `跳过 ${lateCount} 笔迟报（交易日距申报日 > ${DEFAULT_MAX_FILING_LAG_DAYS} 天，仅入库）`);
  const delivered = await notifyInsiderTriggers('insider', config, pool, triggers);
  for (const symbol of delivered) {
    const ids = idsBySymbol.get(symbol) ?? [];
    if (ids.length > 0) {
      await InsiderTrade.updateMany({ _id: { $in: ids } }, { $set: { notified: true } });
    }
  }

  if (fetchDegraded) throw degradedError();
  return [];
}
