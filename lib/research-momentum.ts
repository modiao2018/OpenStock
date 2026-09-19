// Pure momentum math for research themes: trailing-window return, max
// drawdown, moving-average state and window-high proximity from daily
// closes. Shared by the daemon (daily recompute) and tests. No IO.

import type { MomentumRow, ResearchMomentum } from '@/database/models/research-theme.model';
import type { DailyBar } from '@/lib/ai-dips-math';

export const DEFAULT_SESSIONS = 45;
/** Bars needed for a full recompute: window + 1 start close, or MA50, whichever is larger */
export const MIN_BARS_FOR_MA50 = 50;
const NEAR_HIGH_RATIO = 0.97;

export interface MomentumNumbers {
    returnPct: number | null;
    maxDrawdownPct: number | null;
    aboveMa20: boolean | null;
    aboveMa50: boolean | null;
    nearHigh: boolean;
    newHigh: boolean;
    windowStart: string;
    windowEnd: string;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function sma(closes: number[], n: number): number | null {
    if (closes.length < n) return null;
    const tail = closes.slice(-n);
    return tail.reduce((a, b) => a + b, 0) / n;
}

/**
 * Numbers for one symbol from ascending completed bars. The window covers the
 * last `sessions` sessions: the start close is the bar `sessions` before the
 * last one, so 45 sessions compare 46 closes. Returns null when there are
 * not even two bars.
 */
export function computeMomentumNumbers(bars: DailyBar[], sessions = DEFAULT_SESSIONS): MomentumNumbers | null {
    if (bars.length < 2) return null;
    const closes = bars.map((b) => b.c);
    const startIdx = Math.max(0, bars.length - 1 - sessions);
    const window = bars.slice(startIdx);
    const start = window[0].c;
    const last = window[window.length - 1].c;
    const returnPct = start > 0 ? round1(((last - start) / start) * 100) : null;

    let peak = -Infinity;
    let worst = 0;
    for (const b of window) {
        if (b.c > peak) peak = b.c;
        if (peak > 0) worst = Math.min(worst, ((b.c - peak) / peak) * 100);
    }
    const high = Math.max(...window.map((b) => b.c));
    const ma20 = sma(closes, 20);
    const ma50 = sma(closes, MIN_BARS_FOR_MA50);
    return {
        returnPct,
        maxDrawdownPct: round1(worst),
        aboveMa20: ma20 === null ? null : last > ma20,
        aboveMa50: ma50 === null ? null : last > ma50,
        nearHigh: last >= high * NEAR_HIGH_RATIO,
        newHigh: last >= high,
        windowStart: window[0].date,
        windowEnd: window[window.length - 1].date,
    };
}

/** Technical state in words, derived from the flags (so the text never drifts from the numbers) */
export function describeTechnical(n: Pick<MomentumNumbers, 'aboveMa20' | 'aboveMa50' | 'nearHigh' | 'newHigh'>, lang: string): string {
    const zh = lang === 'zh-CN';
    const parts: string[] = [];
    if (n.aboveMa20 === true && n.aboveMa50 === true) parts.push(zh ? '站上20日、50日均线' : 'above the 20- and 50-day MAs');
    else if (n.aboveMa20 === true && n.aboveMa50 === false) parts.push(zh ? '高于20日均线、低于50日均线' : 'above the 20-day MA, below the 50-day');
    else if (n.aboveMa20 === false && n.aboveMa50 === true) parts.push(zh ? '跌破20日均线，仍在50日均线上方' : 'below the 20-day MA, still above the 50-day');
    else if (n.aboveMa20 === false && n.aboveMa50 === false) parts.push(zh ? '跌破20日、50日均线' : 'below the 20- and 50-day MAs');
    else if (n.aboveMa20 === true) parts.push(zh ? '高于20日均线' : 'above the 20-day MA');
    else if (n.aboveMa20 === false) parts.push(zh ? '低于20日均线' : 'below the 20-day MA');
    if (n.newHigh) parts.push(zh ? '创阶段新高' : 'at a new window high');
    else if (n.nearHigh) parts.push(zh ? '接近阶段高点' : 'near the window high');
    return parts.join(zh ? '，' : ', ');
}

export interface RecomputeInput {
    current: ResearchMomentum;
    barsBySymbol: Record<string, DailyBar[]>;
    benchmarkBars: DailyBar[];
    lang: string;
    now?: Date;
}

/**
 * Fresh numbers on top of the current block: every row keeps its verdict,
 * gets new numbers and a derived technical line, and rows are re-sorted by
 * return. Rows without bars keep their old numbers. Groups, ranking and the
 * spotlight are the analyst layer and are untouched here.
 */
export function recomputeMomentum(i: RecomputeInput): ResearchMomentum {
    const sessions = i.current.sessions || DEFAULT_SESSIONS;
    const rows: MomentumRow[] = i.current.rows.map((row) => {
        const n = computeMomentumNumbers(i.barsBySymbol[row.symbol] ?? [], sessions);
        if (!n) return row;
        return {
            ...row,
            returnPct: n.returnPct,
            maxDrawdownPct: n.maxDrawdownPct,
            aboveMa20: n.aboveMa20,
            aboveMa50: n.aboveMa50,
            nearHigh: n.nearHigh,
            technical: describeTechnical(n, i.lang),
        };
    });
    rows.sort((a, b) => (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity));

    const bench = computeMomentumNumbers(i.benchmarkBars, sessions);
    const any = Object.values(i.barsBySymbol).find((b) => b.length >= 2);
    const anyN = any ? computeMomentumNumbers(any, sessions) : null;
    const windowStart = bench?.windowStart ?? anyN?.windowStart ?? i.current.windowStart;
    const windowEnd = bench?.windowEnd ?? anyN?.windowEnd ?? i.current.windowEnd;
    const zh = i.lang === 'zh-CN';
    return {
        ...i.current,
        rows,
        windowStart,
        windowEnd,
        benchmarkReturnPct: bench?.returnPct ?? i.current.benchmarkReturnPct,
        note: zh
            ? `数据来源：Alpaca 日线（IEX，拆股复权收盘价），窗口 ${windowStart} 至 ${windowEnd} 共 ${sessions} 个交易日。以上是筛选和比较，不构成买卖建议。`
            : `Source: Alpaca daily bars (IEX, split-adjusted closes), ${sessions} sessions from ${windowStart} to ${windowEnd}. Screening and comparison only, not investment advice.`,
        computedAt: i.now ?? new Date(),
    };
}
