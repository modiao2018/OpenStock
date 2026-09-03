// Pure math for the signal outcome ledger: entry-session resolution, horizon
// returns and scorecard aggregation. No I/O — unit-tested in
// __tests__/signal-math.test.ts.

import type { DailyBar } from '@/lib/ai-dips-math';

export type SignalDirection = 'up' | 'down' | 'none';

export const HORIZONS = { t1: 1, t5: 5, t20: 20 } as const;
export type HorizonKey = keyof typeof HORIZONS;
export const HORIZON_KEYS = Object.keys(HORIZONS) as HorizonKey[];

// Below this many resolved samples a hit rate is noise, not evidence
export const MIN_SAMPLES = 5;

// A signal whose entry session never shows up within this many calendar
// days is abandoned (delisted, symbol not covered by the bar feed)
export const ENTRY_GRACE_DAYS = 10;

const etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const etClock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
});

/**
 * The earliest session whose close a user could act on after seeing the
 * push: same day when fired before the 16:00 ET close, otherwise the next
 * calendar day (the collector then snaps forward to the next real session).
 */
export function entryTargetDate(firedAt: Date): string {
    const day = etDate.format(firedAt);
    if (etClock.format(firedAt) < '16:00') return day;
    const next = new Date(firedAt.getTime() + 24 * 3600_000);
    return etDate.format(next);
}

export interface HorizonOutcome {
    date: string;
    close: number;
    returnPct: number;
    excessPct: number | null;
}

export interface ResolvedOutcomes {
    entryDate: string;
    entryClose: number;
    benchmarkEntryClose: number | null;
    horizons: Partial<Record<HorizonKey, HorizonOutcome>>;
    complete: boolean;
}

/**
 * Snap the entry to the first completed session on/after `target`, then
 * read closes N sessions later. `bars`/`bench` must be ascending and
 * contain only completed sessions. Returns null when the entry session
 * has not completed yet, or when the nearest bar is more than `maxSnapDays`
 * after the target (the window no longer covers the entry).
 */
export function resolveOutcomes(
    bars: DailyBar[],
    bench: DailyBar[],
    target: string,
    maxSnapDays = ENTRY_GRACE_DAYS
): ResolvedOutcomes | null {
    const entryIdx = bars.findIndex((b) => b.date >= target);
    if (entryIdx < 0) return null;
    const entry = bars[entryIdx];
    // The bar window starts after the target: history rolled past the entry
    // before we ever resolved it. Snapping forward would fabricate an entry.
    if (daysBetween(target, entry.date) > maxSnapDays) return null;
    const benchByDate = new Map(bench.map((b) => [b.date, b.c]));
    const benchEntry = benchByDate.get(entry.date) ?? null;

    const horizons: Partial<Record<HorizonKey, HorizonOutcome>> = {};
    let complete = true;
    for (const key of HORIZON_KEYS) {
        const bar = bars[entryIdx + HORIZONS[key]];
        if (!bar) {
            complete = false;
            continue;
        }
        const returnPct = (bar.c / entry.c - 1) * 100;
        const benchClose = benchByDate.get(bar.date);
        const excessPct =
            benchEntry && benchClose ? returnPct - (benchClose / benchEntry - 1) * 100 : null;
        horizons[key] = { date: bar.date, close: bar.c, returnPct, excessPct };
    }
    return { entryDate: entry.date, entryClose: entry.c, benchmarkEntryClose: benchEntry, horizons, complete };
}

/** Days between two YYYY-MM-DD dates (b - a) */
export function daysBetween(a: string, b: string): number {
    return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

// ---- Scorecard aggregation ------------------------------------------------

export interface ScoreSample {
    direction: SignalDirection;
    horizons: Partial<Record<HorizonKey, { returnPct: number; excessPct: number | null }>>;
}

export interface HorizonStats {
    n: number;
    /** Share of samples whose excess return agreed with the signal direction; null below MIN_SAMPLES or for 'none' */
    hitRate: number | null;
    avgExcessPct: number | null;
    medianExcessPct: number | null;
    avgReturnPct: number | null;
    /** Mean |excess| — the only meaningful number for direction-less signals */
    avgAbsExcessPct: number | null;
}

export interface ScoreRow {
    key: string;
    total: number;
    directions: Record<SignalDirection, number>;
    horizons: Record<HorizonKey, HorizonStats>;
}

function median(values: number[]): number {
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

function horizonStats(samples: ScoreSample[], key: HorizonKey): HorizonStats {
    const resolved = samples.filter((s) => s.horizons[key]);
    const n = resolved.length;
    const empty: HorizonStats = { n, hitRate: null, avgExcessPct: null, medianExcessPct: null, avgReturnPct: null, avgAbsExcessPct: null };
    if (n === 0) return empty;

    const returns = resolved.map((s) => s.horizons[key]!.returnPct);
    // Excess falls back to raw return when the benchmark had no bar that day
    const excess = resolved.map((s) => s.horizons[key]!.excessPct ?? s.horizons[key]!.returnPct);
    const directional = resolved.filter((s) => s.direction !== 'none');
    const hits = directional.filter((s) => {
        const e = s.horizons[key]!.excessPct ?? s.horizons[key]!.returnPct;
        return s.direction === 'up' ? e > 0 : e < 0;
    }).length;

    return {
        n,
        hitRate: directional.length >= MIN_SAMPLES ? hits / directional.length : null,
        avgExcessPct: mean(excess),
        medianExcessPct: median(excess),
        avgReturnPct: mean(returns),
        avgAbsExcessPct: mean(excess.map(Math.abs)),
    };
}

/** Group samples by `keyOf` and compute per-horizon stats for each group */
export function buildScorecard<T extends ScoreSample>(samples: T[], keyOf: (s: T) => string): ScoreRow[] {
    const groups = new Map<string, T[]>();
    for (const s of samples) {
        const k = keyOf(s);
        (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
    }
    const rows: ScoreRow[] = [];
    for (const [key, list] of groups) {
        const directions: Record<SignalDirection, number> = { up: 0, down: 0, none: 0 };
        for (const s of list) directions[s.direction]++;
        rows.push({
            key,
            total: list.length,
            directions,
            horizons: {
                t1: horizonStats(list, 't1'),
                t5: horizonStats(list, 't5'),
                t20: horizonStats(list, 't20'),
            },
        });
    }
    return rows.sort((a, b) => b.total - a.total);
}

/** Map the LLM action word to the direction it implies; null when it implies none */
export function directionOfAction(action: string | null | undefined): SignalDirection | null {
    if (!action) return null;
    if (action === '买入' || action === '加仓') return 'up';
    if (action === '卖出' || action === '减仓') return 'down';
    return null;
}
