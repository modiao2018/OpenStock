// Pure math for the AI dips module: consecutive down-day streaks over
// completed daily sessions. No I/O — unit-tested in __tests__/ai-dips-math.test.ts.

export interface DailyBar {
    // Trading session date, YYYY-MM-DD (US/Eastern)
    date: string;
    // Session close
    c: number;
}

// Number of trailing sessions considered for the drawdown high and sparkline
export const DIP_WINDOW = 30;

// Drops a trailing bar dated `excludeDate` — today's still-forming session.
// Only the last bar is checked: historical bars are complete by definition.
export function completedBars(bars: DailyBar[], excludeDate?: string): DailyBar[] {
    if (!excludeDate || bars.length === 0) return bars;
    return bars[bars.length - 1].date === excludeDate ? bars.slice(0, -1) : bars;
}

export interface DipStats {
    // Consecutive sessions with close < previous close, counted back from the
    // latest completed bar
    streakDays: number;
    // The streak ran off the start of the window — display as "≥N days"
    streakCapped: boolean;
    // Cumulative % change over the streak (vs the close before it started);
    // when capped, measured against the earliest available close
    streakDeclinePct: number | null;
    // % below the highest close of the trailing DIP_WINDOW sessions
    drawdownFromHighPct: number;
    lastClose: number;
    // Trailing ≤DIP_WINDOW closes ascending, for the sparkline
    closes: number[];
}

// `bars` must be ascending by date. Returns null when there's too little
// history to say anything (fresh IPOs, symbols Alpaca doesn't cover).
export function computeDipStats(bars: DailyBar[]): DipStats | null {
    if (bars.length < 2) return null;

    let streakDays = 0;
    let i = bars.length - 1;
    // A flat close (equal) breaks the streak just like an up day
    while (i > 0 && bars[i].c < bars[i - 1].c) {
        streakDays++;
        i--;
    }
    const streakCapped = streakDays > 0 && i === 0;

    const lastClose = bars[bars.length - 1].c;
    const baseClose = bars[i].c;
    const streakDeclinePct = streakDays > 0 && baseClose > 0
        ? (lastClose / baseClose - 1) * 100
        : null;

    const window = bars.slice(-DIP_WINDOW);
    const high = Math.max(...window.map((b) => b.c));
    const drawdownFromHighPct = high > 0 ? (lastClose / high - 1) * 100 : 0;

    return {
        streakDays,
        streakCapped,
        streakDeclinePct,
        drawdownFromHighPct,
        lastClose,
        closes: window.map((b) => b.c),
    };
}
