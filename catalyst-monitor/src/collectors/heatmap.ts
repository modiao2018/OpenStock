import { log, logError } from '../config';
import { fetchWithRetry } from '../http';
import { connectToDatabase } from '@/database/mongoose';
import { DashboardConfig } from '@/database/models/dashboard.model';
import { Watchlist } from '@/database/models/watchlist.model';
import { readStoredProfiles, resolveProfiles, type RawCompanyProfile } from '@/lib/company-profiles';
import { DEFAULT_DASHBOARD_SYMBOLS, sanitizeDashboardSymbols } from '@/lib/dashboard-catalog';
import {
  buildHeatmapTile,
  heatmapSweepDue,
  mergeHeatmapTiles,
  normalizeHeatmapSymbols,
  type FinnhubQuote,
  type HeatmapStock,
} from '@/lib/heatmap-tile';
import { marketCapToUsdMillions } from '@/lib/market-cap';
import { readSnapshot, snapshotKey, writeSnapshot } from '@/lib/snapshot';
import type { MonitorConfig, NewEvent } from '../types';

/**
 * 热力图快照后台刷新。
 *
 * 首页热力图之前完全是"谁打开页面谁触发拉取"：SSR 直接画 Mongo 里上一位访客
 * 留下的快照，客户端挂载后才去 Finnhub 拉实时报价。周一、周二没人打开，周三
 * 首屏就是上周五收盘（issue 0004）。这里由 daemon 兜底：
 *   - 盘中（美东 04:00–20:00）：快照 5 分钟没人刷新就整组重拉；3 分钟内刷过
 *     说明有人开着页面在轮询，让网页端自己刷，避免两边同抢额度；
 *   - 收盘后：只要快照或任一方块的拉取时间早于最近收盘就补一轮，之后不再动
 *     （报价不会变，节假日也只会多补一次）。
 * 刷新的组合 = 默认仪表盘 ∪ 每位用户保存的仪表盘 ∪ 每位用户的自选股，
 * 与网页端 normalize / snapshotKey 的算法一致，写出去的 key 才对得上。
 * 报价串行、间隔 1.2 秒（≤50 次/分钟），与网页端共用同一把 Finnhub key。
 * 不产生时间线事件。
 */

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const PACE_MS = 1200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 串行节流队列：所有上游调用排队，前后至少间隔 PACE_MS */
function makePacer(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  let last = 0;
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = last + PACE_MS - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run;
  };
}

async function fetchFinnhub<T>(url: string): Promise<T | null> {
  const res = await fetchWithRetry(url, {}, { retries: 1, timeoutMs: 10_000 });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

interface SymbolSet {
  key: string;
  list: string[];
  label: string;
}

/** 网页端可能读到的所有热力图组合，按快照 key 去重 */
async function loadSymbolSets(): Promise<SymbolSet[]> {
  await connectToDatabase();
  const sets = new Map<string, SymbolSet>();
  const add = (label: string, raw: string[] | undefined) => {
    const list = normalizeHeatmapSymbols(raw, DEFAULT_DASHBOARD_SYMBOLS);
    if (list.length === 0) return;
    const key = snapshotKey('heatmap', list);
    if (!sets.has(key)) sets.set(key, { key, list, label });
  };

  // 未登录 / 未保存仪表盘的用户看默认组合（与 getDashboardSymbols 的回退一致）
  add('默认仪表盘', undefined);

  const dashboards = await DashboardConfig.find().lean();
  for (const d of dashboards) {
    const symbols = sanitizeDashboardSymbols(d.symbols);
    add(`仪表盘 ${d.userId.slice(0, 6)}`, symbols.length > 0 ? symbols : undefined);
  }

  // 自选股热力图按 getUserWatchlist 的顺序（addedAt 倒序）截断前 40 只
  const items = await Watchlist.find().sort({ addedAt: -1 }).lean();
  const byUser = new Map<string, string[]>();
  for (const it of items) (byUser.get(it.userId) ?? byUser.set(it.userId, []).get(it.userId)!).push(it.symbol);
  for (const [userId, symbols] of byUser) add(`自选股 ${userId.slice(0, 6)}`, symbols);

  return [...sets.values()];
}

export async function collectHeatmap(config: MonitorConfig): Promise<NewEvent[]> {
  const token = config.env.finnhubKey;
  if (!token) {
    log('heatmap', '未配置 Finnhub key，跳过');
    return [];
  }

  const sets = await loadSymbolSets();
  const now = new Date();
  const due: Array<SymbolSet & { previous: HeatmapStock[] | null }> = [];
  for (const set of sets) {
    const snapshot = await readSnapshot<HeatmapStock[]>(set.key);
    if (!heatmapSweepDue(snapshot, now)) continue;
    due.push({ ...set, previous: snapshot && snapshot.data.length > 0 ? snapshot.data : null });
  }
  if (due.length === 0) return [];

  const symbols = [...new Set(due.flatMap((d) => d.list))];
  const started = Date.now();
  const paced = makePacer();
  let calls = 0;

  // 公司档案：Mongo 里一天内的直接用，过期的才去 Finnhub 补（走同一个节流队列）
  const stored = await readStoredProfiles(symbols);
  const profiles = await resolveProfiles(
    symbols,
    (symbol) =>
      paced(() => {
        calls++;
        return fetchFinnhub<RawCompanyProfile>(`${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`);
      }),
    stored,
  );

  const fresh = new Map<string, HeatmapStock>();
  let failed = 0;
  for (const symbol of symbols) {
    const profile = profiles.get(symbol);
    if (!profile) continue;
    try {
      calls++;
      const quote = await paced(() => fetchFinnhub<FinnhubQuote>(`${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`));
      if (!quote) {
        failed++;
        continue;
      }
      const capMillions = await marketCapToUsdMillions(profile.marketCapitalization, profile.currency);
      const tile = buildHeatmapTile(symbol, quote, profile, capMillions, Date.now());
      if (tile) fresh.set(symbol, tile);
    } catch (err) {
      failed++;
      logError('heatmap:quote', err);
    }
  }

  if (fresh.size === 0) {
    log('heatmap', `${symbols.length} 只报价全部失败，快照未更新`);
    return [];
  }

  for (const d of due) {
    const tiles = d.list.map((s) => fresh.get(s)).filter((t): t is HeatmapStock => t !== undefined);
    await writeSnapshot(d.key, mergeHeatmapTiles(d.list, d.previous, tiles));
  }

  const secs = ((Date.now() - started) / 1000).toFixed(0);
  log(
    'heatmap',
    `刷新 ${due.length}/${sets.length} 组快照（${due.map((d) => d.label).join('、')}）：` +
      `${fresh.size}/${symbols.length} 只有价${failed > 0 ? `，${failed} 只失败` : ''}，${calls} 次请求，${secs}s`,
  );
  return [];
}
