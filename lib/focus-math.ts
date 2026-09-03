// Pure scoring for the cross-module focus queue: one attention score per
// symbol built from factors the other modules already compute. No I/O —
// unit-tested in __tests__/focus-math.test.ts.
//
// Score = attention (how much this symbol deserves a look right now), NOT a
// buy/sell rating. Each factor carries a lean (bull / bear / neutral); the
// stance is derived from the directional balance and the user's discipline
// ("never buy expensive") can downgrade a bullish stance to a caution.

export type Lean = 'bull' | 'bear' | 'neutral';
export type Stance = 'bullish' | 'bearish' | 'mixed' | 'watch';
export type FactorGroup = 'setup' | 'confirm' | 'urgency';

export interface FocusFactor {
    /** Stable id, doubles as the i18n key under focus.factors */
    id: string;
    group: FactorGroup;
    points: number;
    lean: Lean;
    /** Free-form detail rendered after the label (e.g. "-18.2%") */
    detail?: string;
}

export interface FocusDip {
    streakDays: number;
    streakDeclinePct: number | null;
    drawdownFromHighPct: number;
    /** Stock decline minus benchmark decline over the streak (pct points); null without benchmark bars */
    excessDeclinePct: number | null;
}

export interface FocusInsider {
    buyCount: number;
    buyUsd: number;
    sellUsd: number;
    distinctBuyers: number;
    /** YYYY-MM-DD of the latest open-market buy, null if none in window */
    lastBuyDate: string | null;
    /** ≥3 distinct sellers inside the trailing 7 days */
    clusterSell: boolean;
}

export interface FocusSignal {
    kind: string;
    /** Epoch ms */
    firedAt: number;
}

export interface FocusInput {
    symbol: string;
    /** YYYY-MM-DD used as "now" for date math (US/Eastern session date) */
    today: string;
    nowMs: number;
    dip: FocusDip | null;
    insider: FocusInsider | null;
    /** Latest AI action word (买入/观望/…) and when it was produced */
    aiAction: { action: string; atMs: number } | null;
    /** Ledger signals in the trailing 7 days */
    recentSignals: FocusSignal[];
    /** Urgent timeline events (halt / 8-K / anomaly) in the trailing 3 days, epoch ms */
    urgentEventsAt: number[];
    /** Days until the next known catalyst; null when none inside 90 days */
    nextCatalystDays: number | null;
}

export interface FocusScore {
    symbol: string;
    score: number;
    stance: Stance;
    bullPoints: number;
    bearPoints: number;
    factors: FocusFactor[];
    /** Set when the discipline check fires: bullish evidence but price not pulled back */
    caution: 'notPulledBack' | null;
}

export const SCORE_CAP = 100;
/** A symbol at/above this score gets a real-time "entered focus" push and bypasses the digest */
export const DEFAULT_FOCUS_THRESHOLD = 55;
const STANCE_MARGIN = 15;
const DAY_MS = 86_400_000;

const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

function daysBetween(a: string, b: string): number {
    return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

export function scoreFocus(input: FocusInput): FocusScore {
    const f: FocusFactor[] = [];
    const add = (id: string, group: FactorGroup, points: number, lean: Lean, detail?: string) =>
        f.push({ id, group, points, lean, detail });

    // ---- setup: how far the price has come down ----------------------------
    const dip = input.dip;
    if (dip) {
        const dd = dip.drawdownFromHighPct;
        if (dd <= -25) add('drawdownDeep', 'setup', 30, 'bull', pct(dd));
        else if (dd <= -15) add('drawdownMid', 'setup', 20, 'bull', pct(dd));
        else if (dd <= -8) add('drawdownLight', 'setup', 10, 'bull', pct(dd));

        if (dip.streakDays >= 10) add('streak10', 'setup', 15, 'bull', `${dip.streakDays}d`);
        else if (dip.streakDays >= 7) add('streak7', 'setup', 10, 'bull', `${dip.streakDays}d`);
        else if (dip.streakDays >= 5) add('streak5', 'setup', 5, 'bull', `${dip.streakDays}d`);

        // Falling harder than the benchmark = idiosyncratic, worth understanding
        // either way, so it raises attention without a lean
        if (dip.excessDeclinePct !== null && dip.streakDays >= 3 && dip.excessDeclinePct <= -5) {
            add('underperformsBench', 'setup', 10, 'neutral', `${dip.excessDeclinePct.toFixed(1)}pt`);
        }
    }

    // ---- confirmation: who is putting money where ---------------------------
    const ins = input.insider;
    if (ins) {
        if (ins.buyCount > 0) {
            add('insiderBuy', 'confirm', 15, 'bull', `${ins.buyCount}`);
            if (ins.distinctBuyers >= 2) add('insiderBuyers', 'confirm', 10, 'bull', `${ins.distinctBuyers}`);
            if (ins.lastBuyDate && daysBetween(ins.lastBuyDate, input.today) <= 14) {
                add('insiderBuyRecent', 'confirm', 10, 'bull', ins.lastBuyDate);
            }
        }
        if (ins.clusterSell) add('insiderClusterSell', 'confirm', 20, 'bear');
        else if (ins.buyCount === 0 && ins.sellUsd >= 50_000_000) add('insiderHeavySell', 'confirm', 12, 'bear');
        else if (ins.buyCount === 0 && ins.sellUsd >= 10_000_000) add('insiderRoutineSell', 'confirm', 8, 'bear');
    }

    if (input.aiAction && input.nowMs - input.aiAction.atMs <= 14 * DAY_MS) {
        const a = input.aiAction.action;
        if (a === '买入' || a === '加仓') add('aiBullish', 'confirm', 10, 'bull', a);
        else if (a === '卖出' || a === '减仓') add('aiBearish', 'confirm', 10, 'bear', a);
    }

    // Convergence: several independent signal families in one week
    const families = new Set(input.recentSignals.map((s) => s.kind.split('.')[0]));
    if (families.size >= 3) add('convergence3', 'confirm', 20, 'neutral', [...families].join('+'));
    else if (families.size >= 2) add('convergence2', 'confirm', 10, 'neutral', [...families].join('+'));

    // ---- urgency: why now -----------------------------------------------------
    const d = input.nextCatalystDays;
    if (d !== null && d >= 0) {
        if (d <= 3) add('catalyst3d', 'urgency', 30, 'neutral', `${d}d`);
        else if (d <= 10) add('catalyst10d', 'urgency', 20, 'neutral', `${d}d`);
        else if (d <= 21) add('catalyst21d', 'urgency', 10, 'neutral', `${d}d`);
    }
    const recentUrgent = input.urgentEventsAt.filter((t) => input.nowMs - t <= 3 * DAY_MS);
    if (recentUrgent.length > 0) {
        const within24h = recentUrgent.some((t) => input.nowMs - t <= DAY_MS);
        add('urgentEvent', 'urgency', within24h ? 30 : 25, 'neutral', `${recentUrgent.length}`);
    }
    if (input.recentSignals.some((s) => input.nowMs - s.firedAt <= DAY_MS)) {
        add('signal24h', 'urgency', 10, 'neutral');
    }

    // ---- roll up ---------------------------------------------------------------
    const bullPoints = f.filter((x) => x.lean === 'bull').reduce((a, x) => a + x.points, 0);
    const bearPoints = f.filter((x) => x.lean === 'bear').reduce((a, x) => a + x.points, 0);
    const raw = f.reduce((a, x) => a + x.points, 0);
    const score = Math.min(SCORE_CAP, raw);

    let stance: Stance = 'watch';
    if (bullPoints - bearPoints >= STANCE_MARGIN) stance = 'bullish';
    else if (bearPoints - bullPoints >= STANCE_MARGIN) stance = 'bearish';
    else if (bullPoints > 0 && bearPoints > 0) stance = 'mixed';

    // Discipline: bullish confirmation without a real pullback is a trap, not a setup
    let caution: FocusScore['caution'] = null;
    const confirmBull = f.some((x) => x.group === 'confirm' && x.lean === 'bull');
    if (stance === 'bullish' && confirmBull && dip && dip.drawdownFromHighPct > -5) {
        caution = 'notPulledBack';
        stance = 'watch';
    }

    return { symbol: input.symbol, score, stance, bullPoints, bearPoints, factors: f, caution };
}

/**
 * Stock decline minus benchmark decline over the last `streakDays` sessions,
 * in percentage points. Both close arrays ascending; null when either side
 * lacks enough history.
 */
export function excessDeclineOverStreak(stock: number[], bench: number[], streakDays: number): number | null {
    if (streakDays <= 0) return null;
    const n = streakDays + 1;
    if (stock.length < n || bench.length < n) return null;
    const s0 = stock[stock.length - n];
    const b0 = bench[bench.length - n];
    if (s0 <= 0 || b0 <= 0) return null;
    const sPct = (stock[stock.length - 1] / s0 - 1) * 100;
    const bPct = (bench[bench.length - 1] / b0 - 1) * 100;
    return sPct - bPct;
}

/** Ordering for the queue: score desc, then bullish setups first, then symbol */
export function compareFocus(a: FocusScore, b: FocusScore): number {
    if (b.score !== a.score) return b.score - a.score;
    const rank: Record<Stance, number> = { bullish: 0, bearish: 1, mixed: 2, watch: 3 };
    if (rank[a.stance] !== rank[b.stance]) return rank[a.stance] - rank[b.stance];
    return a.symbol.localeCompare(b.symbol);
}
