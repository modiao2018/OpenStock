import { log, logError } from '../config';
import { etToday, fetchDailyBars, formingSessionDate } from '../alpaca-daily';
import { getKv, setKv } from '../store';
import { pushMessage } from '../notify';
import { extractAction } from '../analyze';
import { connectToDatabase } from '@/database/mongoose';
import { FocusEntry } from '@/database/models/focus.model';
import { InsiderInsight, InsiderTrade } from '@/database/models/insider.model';
import { Signal } from '@/database/models/signal.model';
import { CatalystCustomEvent, CatalystEvent, CatalystTrial } from '@/database/models/catalyst.model';
import { getAiDipPool } from '../../../lib/ai-dips-pool';
import { completedBars, computeDipStats, type DailyBar } from '../../../lib/ai-dips-math';
import { shiftDate } from '../../../lib/insider-math';
import {
  compareFocus,
  excessDeclineOverStreak,
  scoreFocus,
  type FocusInsider,
  type FocusScore,
} from '../../../lib/focus-math';
import { AI_BENCHMARK } from '../signals';
import type { MonitorConfig, NewEvent } from '../types';

const BATCH = 50;
const INSIDER_WINDOW_DAYS = 90;
const CLUSTER_DAYS = 7;
const CLUSTER_MIN_SELLERS = 3;
// 进入关注队列提醒的回落带：跌到阈值以下 10 分才复位，避免在阈值附近反复提醒
const HYSTERESIS = 10;

interface Universe {
  symbol: string;
  name: string;
  universe: 'ai' | 'catalyst' | 'both';
  benchmark: string;
}

function buildUniverse(config: MonitorConfig, pool: Array<{ symbol: string; name: string }>): Universe[] {
  const map = new Map<string, Universe>();
  for (const p of pool) map.set(p.symbol, { symbol: p.symbol, name: p.name, universe: 'ai', benchmark: AI_BENCHMARK });
  for (const w of config.watchlist) {
    const prev = map.get(w.symbol);
    if (prev) prev.universe = 'both';
    else map.set(w.symbol, { symbol: w.symbol, name: w.company, universe: 'catalyst', benchmark: config.market.benchmark });
  }
  return [...map.values()];
}

async function loadBars(config: MonitorConfig, symbols: string[]): Promise<Record<string, DailyBar[]>> {
  const excludeDate = formingSessionDate();
  const out: Record<string, DailyBar[]> = {};
  for (let i = 0; i < symbols.length; i += BATCH) {
    const chunk = symbols.slice(i, i + BATCH);
    try {
      const raw = await fetchDailyBars(config, chunk);
      for (const s of chunk) out[s] = completedBars(raw[s] ?? [], excludeDate);
    } catch (err) {
      logError('focus:bars', err);
    }
  }
  return out;
}

async function loadInsider(symbols: string[], today: string): Promise<Map<string, FocusInsider>> {
  const from = shiftDate(today, -INSIDER_WINDOW_DAYS);
  const clusterFrom = shiftDate(today, -CLUSTER_DAYS);
  const docs = await InsiderTrade.find({ symbol: { $in: symbols }, transactionDate: { $gte: from, $lte: today } }).lean();
  const acc = new Map<string, FocusInsider & { buyers: Set<string>; recentSellers: Set<string> }>();
  for (const d of docs) {
    const a =
      acc.get(d.symbol) ??
      acc.set(d.symbol, { buyCount: 0, buyUsd: 0, sellUsd: 0, distinctBuyers: 0, lastBuyDate: null, clusterSell: false, buyers: new Set(), recentSellers: new Set() }).get(d.symbol)!;
    if (d.transactionCode === 'P') {
      a.buyCount++;
      a.buyUsd += d.amountUsd ?? 0;
      a.buyers.add(d.name);
      if (!a.lastBuyDate || d.transactionDate > a.lastBuyDate) a.lastBuyDate = d.transactionDate;
    } else {
      a.sellUsd += d.amountUsd ?? 0;
      if (d.transactionDate >= clusterFrom) a.recentSellers.add(d.name);
    }
  }
  const out = new Map<string, FocusInsider>();
  for (const [symbol, a] of acc) {
    out.set(symbol, {
      buyCount: a.buyCount, buyUsd: a.buyUsd, sellUsd: a.sellUsd,
      distinctBuyers: a.buyers.size, lastBuyDate: a.lastBuyDate,
      clusterSell: a.recentSellers.size >= CLUSTER_MIN_SELLERS,
    });
  }
  return out;
}

/** 最近一次 AI 操作建议：内部人洞察或时间线事件分析，取更新的那个 */
async function loadAiActions(symbols: string[], sinceMs: number): Promise<Map<string, { action: string; atMs: number }>> {
  const out = new Map<string, { action: string; atMs: number }>();
  const insights = await InsiderInsight.find({ symbol: { $in: symbols }, updatedAt: { $gte: new Date(sinceMs) } }).lean();
  for (const d of insights) {
    if (d.action) out.set(d.symbol, { action: d.action, atMs: new Date(d.updatedAt).getTime() });
  }
  const events = await CatalystEvent.find({ symbol: { $in: symbols }, fetchedAt: { $gte: new Date(sinceMs) }, analysis: { $exists: true } })
    .sort({ fetchedAt: -1 })
    .lean();
  for (const e of events) {
    if (!e.symbol) continue;
    const action = extractAction(e.analysis);
    if (!action) continue;
    const atMs = new Date(e.fetchedAt).getTime();
    const prev = out.get(e.symbol);
    if (!prev || atMs > prev.atMs) out.set(e.symbol, { action, atMs });
  }
  return out;
}

async function loadNextCatalysts(symbols: string[], today: string): Promise<Map<string, { title: string; date: string; days: number }>> {
  const in90 = shiftDate(today, 90);
  const out = new Map<string, { title: string; date: string; days: number }>();
  const consider = (symbol: string, title: string, date: string) => {
    const iso = /^\d{4}-\d{2}$/.test(date) ? `${date}-01` : date;
    if (iso < today || iso > in90) return;
    const prev = out.get(symbol);
    if (!prev || iso < prev.date) {
      out.set(symbol, { title, date: iso, days: Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000) });
    }
  };
  for (const c of await CatalystCustomEvent.find({ symbol: { $in: symbols }, date: { $gte: today, $lte: in90 } }).lean()) {
    consider(c.symbol, c.title, c.date);
  }
  for (const t of await CatalystTrial.find({ symbol: { $in: symbols } }).lean()) {
    if (t.primaryCompletionDate) consider(t.symbol, `${t.nctId} 主要完成`, t.primaryCompletionDate);
  }
  return out;
}

/** 分数首次越过阈值时提醒一次；跌回阈值 − 回落带以下后复位 */
async function notifyEntrants(config: MonitorConfig, scored: Array<FocusScore & { name: string }>, ctx: Map<string, string>): Promise<void> {
  const entrants: Array<FocusScore & { name: string }> = [];
  for (const s of scored) {
    const key = `focus_above:${s.symbol}`;
    const wasAbove = (await getKv(key)) === '1';
    if (s.score >= config.focus.threshold && !wasAbove) {
      entrants.push(s);
      await setKv(key, '1');
    } else if (s.score < config.focus.threshold - HYSTERESIS && wasAbove) {
      await setKv(key, '0');
    }
  }
  if (entrants.length === 0) return;
  entrants.sort(compareFocus);
  const siteUrl = process.env.BETTER_AUTH_URL;
  const STANCE_ZH = { bullish: '偏多', bearish: '偏空', mixed: '多空交织', watch: '观察' } as const;
  const lines = entrants.map((s) => {
    const top = s.factors.slice().sort((a, b) => b.points - a.points).slice(0, 3).map((f) => `${f.id}${f.detail ? ' ' + f.detail : ''}`).join('、');
    const caution = s.caution === 'notPulledBack' ? '；⚠ 未充分回撤，勿追高' : '';
    return `${s.symbol} ${s.score} 分（${STANCE_ZH[s.stance]}）${ctx.get(s.symbol) ?? ''}\n  ${top}${caution}`;
  });
  const title = entrants.length === 1
    ? `进入关注队列｜${entrants[0].symbol} ${entrants[0].score} 分`
    : `进入关注队列｜${entrants.length} 只标的达标`;
  const delivered = await pushMessage(config.env, {
    title,
    body: lines.join('\n') + '\n关注分只表示值得看，不是买卖评级；详情见关注队列页',
    urgent: false,
    url: siteUrl ? `${siteUrl}/focus` : undefined,
  });
  log('focus', `${entrants.length} 只进入关注队列（推送${delivered ? '成功' : '未送达'}）`);
}

/**
 * 关注队列：对 AI 池 ∪ 催化剂清单每只标的算关注分并整表覆盖。
 * 不产生时间线事件。
 */
export async function collectFocus(config: MonitorConfig): Promise<NewEvent[]> {
  await connectToDatabase();
  const pool = await getAiDipPool();
  const universe = buildUniverse(config, pool);
  if (universe.length === 0) {
    log('focus', '股票池与监控清单均为空，跳过');
    return [];
  }
  const symbols = universe.map((u) => u.symbol);
  const benchmarks = [...new Set(universe.map((u) => u.benchmark))];
  const today = etToday();
  const nowMs = Date.now();

  const hasAlpaca = Boolean(config.env.alpacaKey && config.env.alpacaSecret);
  const bars = hasAlpaca ? await loadBars(config, [...symbols, ...benchmarks]) : {};
  const [insider, aiActions, nextCatalysts] = await Promise.all([
    loadInsider(symbols, today),
    loadAiActions(symbols, nowMs - 14 * 86_400_000),
    loadNextCatalysts(symbols, today),
  ]);
  const signals = await Signal.find({ symbol: { $in: symbols }, firedAt: { $gte: new Date(nowMs - 7 * 86_400_000) } }).lean();
  const urgent = await CatalystEvent.find({
    symbol: { $in: symbols }, severity: 'urgent', firstSnapshot: { $ne: true },
    fetchedAt: { $gte: new Date(nowMs - 3 * 86_400_000) },
  }).lean();
  const signalsBy = new Map<string, Array<{ kind: string; firedAt: number }>>();
  for (const s of signals) (signalsBy.get(s.symbol) ?? signalsBy.set(s.symbol, []).get(s.symbol)!).push({ kind: s.kind, firedAt: new Date(s.firedAt).getTime() });
  const urgentBy = new Map<string, number[]>();
  for (const e of urgent) if (e.symbol) (urgentBy.get(e.symbol) ?? urgentBy.set(e.symbol, []).get(e.symbol)!).push(new Date(e.fetchedAt).getTime());

  let sessionDate = '';
  const scored: Array<FocusScore & { name: string }> = [];
  const ctx = new Map<string, string>();
  const computedAt = new Date();
  for (const u of universe) {
    const sym = bars[u.symbol] ?? [];
    const stats = computeDipStats(sym);
    const last = sym[sym.length - 1]?.date ?? '';
    if (last > sessionDate) sessionDate = last;
    const bench = bars[u.benchmark] ?? [];
    const dip = stats
      ? {
          streakDays: stats.streakDays,
          streakDeclinePct: stats.streakDeclinePct,
          drawdownFromHighPct: stats.drawdownFromHighPct,
          excessDeclinePct: excessDeclineOverStreak(sym.map((b) => b.c), bench.map((b) => b.c), stats.streakDays),
        }
      : null;
    const next = nextCatalysts.get(u.symbol) ?? null;
    const score = scoreFocus({
      symbol: u.symbol,
      today,
      nowMs,
      dip,
      insider: insider.get(u.symbol) ?? null,
      aiAction: aiActions.get(u.symbol) ?? null,
      recentSignals: signalsBy.get(u.symbol) ?? [],
      urgentEventsAt: urgentBy.get(u.symbol) ?? [],
      nextCatalystDays: next?.days ?? null,
    });
    scored.push({ ...score, name: u.name });
    if (stats) ctx.set(u.symbol, `收 $${stats.lastClose.toFixed(2)} 连跌 ${stats.streakDays} 天 回撤 ${stats.drawdownFromHighPct.toFixed(1)}%`);

    await FocusEntry.updateOne(
      { symbol: u.symbol },
      {
        $set: {
          name: u.name,
          universe: u.universe,
          score: score.score,
          stance: score.stance,
          bullPoints: score.bullPoints,
          bearPoints: score.bearPoints,
          factors: score.factors,
          caution: score.caution,
          lastClose: stats?.lastClose ?? null,
          streakDays: stats?.streakDays ?? null,
          drawdownFromHighPct: stats?.drawdownFromHighPct ?? null,
          nextCatalyst: next,
          sessionDate: last || today,
          computedAt,
        },
      },
      { upsert: true }
    );
  }
  // 已移出股票池/清单的标的不再保留
  await FocusEntry.deleteMany({ symbol: { $nin: symbols } });
  await setKv('focus_threshold', String(config.focus.threshold));

  await notifyEntrants(config, scored, ctx);
  const above = scored.filter((s) => s.score >= config.focus.threshold).length;
  log('focus', `${universe.length} 只已打分（会话 ${sessionDate || '无行情'}），${above} 只 ≥ ${config.focus.threshold}`);
  return [];
}
