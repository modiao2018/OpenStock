import { log, logError } from '../config';
import { fetchWithRetry } from '../http';
import { fetchDailyBars, formingSessionDate } from '../alpaca-daily';
import { connectToDatabase } from '@/database/mongoose';
import { DashboardConfig } from '@/database/models/dashboard.model';
import { Watchlist } from '@/database/models/watchlist.model';
import type { DailyBar } from '@/lib/ai-dips-math';
import { getAiDipPool } from '@/lib/ai-dips-pool';
import {
  AI_DIPS_SNAPSHOT_KEY,
  aiDipsQuotesError,
  buildAiDipsRows,
  type AiDipQuote,
  type AiDipStock,
  type AiDipsPayload,
} from '@/lib/ai-dips-rows';
import { readStoredProfiles, resolveProfiles, type RawCompanyProfile } from '@/lib/company-profiles';
import { buildCatalog, DEFAULT_DASHBOARD_SYMBOLS, sanitizeCatalogEdits, sanitizeDashboardSymbols } from '@/lib/dashboard-catalog';
import {
  buildHeatmapTile,
  mergeHeatmapTiles,
  normalizeHeatmapSymbols,
  quoteSnapshotSweepDue,
  type FinnhubQuote,
  type HeatmapStock,
} from '@/lib/heatmap-tile';
import { marketCapToUsdMillions } from '@/lib/market-cap';
import { readSnapshot, snapshotKey, writeSnapshot } from '@/lib/snapshot';
import type { MonitorConfig, NewEvent } from '../types';

/**
 * 报价快照后台刷新：首页热力图 + AI 低吸页现价。
 *
 * 这两处之前完全是"谁打开页面谁触发拉取"：SSR 直接画 Mongo 里上一位访客留下的
 * 快照，客户端挂载后才去 Finnhub 拉实时报价。周一、周二没人打开，周三首屏就是
 * 上周五收盘（issue 0004）。这里由 daemon 兜底：
 *   - 盘中（美东 04:00–20:00）：快照 5 分钟没人刷新就整组重拉；3 分钟内刷过
 *     说明有人开着页面在轮询，让网页端自己刷，避免两边同抢额度；
 *   - 收盘后：只要快照或任一条目的拉取时间早于最近收盘就补一轮，之后不再动
 *     （报价不会变，节假日也只会多补一次）。
 * 热力图组合 = 默认仪表盘 ∪ 每位用户保存的仪表盘 ∪ 每位用户的自选股，与网页端
 * normalize / snapshotKey 算法一致；AI 低吸用固定 key，行的连跌统计同网页端用
 * Alpaca 日线现算。所有 Finnhub 请求走同一条串行队列、间隔 1.2 秒（≤50 次/分钟），
 * 与网页端共用同一把 key。不产生时间线事件。
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

interface Ctx {
  token: string;
  paced: <T>(fn: () => Promise<T>) => Promise<T>;
  calls: number;
}

/** 一批报价，串行节流；失败的不在返回里 */
async function fetchQuotes(ctx: Ctx, symbols: string[]): Promise<Map<string, FinnhubQuote>> {
  const out = new Map<string, FinnhubQuote>();
  for (const symbol of symbols) {
    try {
      ctx.calls++;
      const q = await ctx.paced(() =>
        fetchFinnhub<FinnhubQuote>(`${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${ctx.token}`),
      );
      if (q && (q.c ?? 0) > 0) out.set(symbol, q);
    } catch (err) {
      logError('quotes', err);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 热力图
// ---------------------------------------------------------------------------

interface SymbolSet {
  key: string;
  list: string[];
  label: string;
}

/** 网页端可能读到的所有热力图组合，按快照 key 去重 */
async function loadHeatmapSets(): Promise<SymbolSet[]> {
  await connectToDatabase();
  const sets = new Map<string, SymbolSet>();
  const add = (label: string, raw: string[] | undefined) => {
    const list = normalizeHeatmapSymbols(raw, DEFAULT_DASHBOARD_SYMBOLS);
    if (list.length === 0) return;
    const key = snapshotKey('heatmap', list);
    if (!sets.has(key)) sets.set(key, { key, list, label });
  };

  // 未登录 / 未保存仪表盘的用户看默认组合（与 getDashboardConfig 的回退一致）
  add('默认仪表盘', undefined);

  const dashboards = await DashboardConfig.find().lean();
  for (const d of dashboards) {
    // 选中集合按该用户自己的目录（默认目录 − 移除 + 自行添加）校验，与 getDashboardConfig 一致
    const symbols = sanitizeDashboardSymbols(d.symbols, buildCatalog(sanitizeCatalogEdits(d)));
    add(`仪表盘 ${d.userId.slice(0, 6)}`, symbols.length > 0 ? symbols : undefined);
  }

  // 自选股热力图按 getUserWatchlist 的顺序（addedAt 倒序）截断前 40 只
  const items = await Watchlist.find().sort({ addedAt: -1 }).lean();
  const byUser = new Map<string, string[]>();
  for (const it of items) (byUser.get(it.userId) ?? byUser.set(it.userId, []).get(it.userId)!).push(it.symbol);
  for (const [userId, symbols] of byUser) add(`自选股 ${userId.slice(0, 6)}`, symbols);

  return [...sets.values()];
}

async function sweepHeatmap(ctx: Ctx, now: Date): Promise<string | null> {
  const sets = await loadHeatmapSets();
  const due: Array<SymbolSet & { previous: HeatmapStock[] | null }> = [];
  for (const set of sets) {
    const snapshot = await readSnapshot<HeatmapStock[]>(set.key);
    if (!quoteSnapshotSweepDue(snapshot, now)) continue;
    due.push({ ...set, previous: snapshot && snapshot.data.length > 0 ? snapshot.data : null });
  }
  if (due.length === 0) return null;

  const symbols = [...new Set(due.flatMap((d) => d.list))];

  // 公司档案：Mongo 里一天内的直接用，过期的才去 Finnhub 补（走同一个节流队列）
  const stored = await readStoredProfiles(symbols);
  const profiles = await resolveProfiles(
    symbols,
    (symbol) =>
      ctx.paced(() => {
        ctx.calls++;
        return fetchFinnhub<RawCompanyProfile>(`${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${ctx.token}`);
      }),
    stored,
  );

  const quotes = await fetchQuotes(ctx, symbols.filter((s) => profiles.has(s)));
  const fresh = new Map<string, HeatmapStock>();
  for (const [symbol, quote] of quotes) {
    const profile = profiles.get(symbol)!;
    const capMillions = await marketCapToUsdMillions(profile.marketCapitalization, profile.currency);
    const tile = buildHeatmapTile(symbol, quote, profile, capMillions, Date.now());
    if (tile) fresh.set(symbol, tile);
  }
  if (fresh.size === 0) return `热力图 ${symbols.length} 只报价全部失败，快照未更新`;

  for (const d of due) {
    const tiles = d.list.map((s) => fresh.get(s)).filter((t): t is HeatmapStock => t !== undefined);
    await writeSnapshot(d.key, mergeHeatmapTiles(d.list, d.previous, tiles));
  }
  return `热力图 ${due.length}/${sets.length} 组（${due.map((d) => d.label).join('、')}）${fresh.size}/${symbols.length} 只有价`;
}

// ---------------------------------------------------------------------------
// AI 低吸
// ---------------------------------------------------------------------------

async function sweepAiDips(ctx: Ctx, config: MonitorConfig, now: Date): Promise<string | null> {
  const snapshot = await readSnapshot<AiDipsPayload>(AI_DIPS_SNAPSHOT_KEY);
  const previousRows = new Map<string, AiDipStock>((snapshot?.data.rows ?? []).map((r) => [r.symbol, r]));
  // 从未有过报价的（退市等）不算"待刷新"，否则收盘后会一直重扫
  const priced = snapshot ? { data: snapshot.data.rows.filter((r) => r.price > 0), updatedAt: snapshot.updatedAt } : null;
  if (!quoteSnapshotSweepDue(priced, now)) return null;

  const pool = await getAiDipPool();
  const symbols = pool.map((s) => s.symbol);
  if (symbols.length === 0) return null;

  const configured = Boolean(config.env.alpacaKey && config.env.alpacaSecret);
  let barsBySymbol: Record<string, DailyBar[]> = {};
  let barsError = false;
  if (configured) {
    try {
      barsBySymbol = await fetchDailyBars(config, symbols);
    } catch (err) {
      barsError = true;
      logError('quotes:alpaca', err);
    }
  }

  const quoteMap = await fetchQuotes(ctx, symbols);
  const quotes: Record<string, AiDipQuote> = Object.fromEntries([...quoteMap].map(([s, q]) => [s, { c: q.c, dp: q.dp }]));
  const { rows, quotesStale } = buildAiDipsRows({
    pool,
    barsBySymbol,
    excludeDate: formingSessionDate(),
    quotes,
    attempted: new Set(symbols),
    previousRows,
    fetchedAt: Date.now(),
  });
  const payload: AiDipsPayload = {
    configured,
    updatedAt: Date.now(),
    rows,
    barsError,
    quotesError: aiDipsQuotesError(symbols, quotes, previousRows),
    quotesStale,
  };
  if (!rows.some((r) => r.barsOk || r.price > 0)) return `AI 低吸 ${symbols.length} 只报价与日线均失败，快照未更新`;
  await writeSnapshot(AI_DIPS_SNAPSHOT_KEY, payload);
  return `AI 低吸 ${quoteMap.size}/${symbols.length} 只有价${barsError ? '（日线拉取失败）' : ''}`;
}

export async function collectQuotes(config: MonitorConfig): Promise<NewEvent[]> {
  const token = config.env.finnhubKey;
  if (!token) {
    log('quotes', '未配置 Finnhub key，跳过');
    return [];
  }
  const ctx: Ctx = { token, paced: makePacer(), calls: 0 };
  const now = new Date();
  const started = Date.now();

  const parts: string[] = [];
  const heat = await sweepHeatmap(ctx, now);
  if (heat) parts.push(heat);
  const dips = await sweepAiDips(ctx, config, now);
  if (dips) parts.push(dips);

  if (parts.length > 0) {
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    log('quotes', `${parts.join('；')}；${ctx.calls} 次 Finnhub 请求，${secs}s`);
  }
  return [];
}
