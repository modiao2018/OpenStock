import { describe, expect, it } from 'vitest';
import { aggregateFocusInsider, compareFocus, excessDeclineOverStreak, scoreFocus, type FocusInput, type FocusInsiderTrade, type FocusScore } from '@/lib/focus-math';

const NOW = Date.parse('2026-09-03T18:00:00Z');
const base = (over: Partial<FocusInput> = {}): FocusInput => ({
    symbol: 'TEST',
    today: '2026-09-03',
    nowMs: NOW,
    dip: null,
    insider: null,
    aiAction: null,
    recentSignals: [],
    urgentEventsAt: [],
    nextCatalystDays: null,
    ...over,
});
const ids = (r: ReturnType<typeof scoreFocus>) => r.factors.map((f) => f.id);

describe('scoreFocus', () => {
    it('scores nothing for an empty input', () => {
        const r = scoreFocus(base());
        expect(r.score).toBe(0);
        expect(r.stance).toBe('watch');
        expect(r.factors).toEqual([]);
    });

    it('rewards depth and streak as bullish setup', () => {
        const r = scoreFocus(base({ dip: { streakDays: 7, streakDeclinePct: -12, drawdownFromHighPct: -18, excessDeclinePct: -2 } }));
        expect(ids(r)).toEqual(['drawdownMid', 'streak7']);
        expect(r.score).toBe(30);
        expect(r.stance).toBe('bullish');
    });

    it('flags idiosyncratic weakness without a lean', () => {
        const r = scoreFocus(base({ dip: { streakDays: 4, streakDeclinePct: -9, drawdownFromHighPct: -9, excessDeclinePct: -6.5 } }));
        expect(ids(r)).toContain('underperformsBench');
        expect(r.factors.find((f) => f.id === 'underperformsBench')?.lean).toBe('neutral');
    });

    it('insider buying confirms, cluster selling opposes', () => {
        const buy = scoreFocus(base({
            insider: { buyCount: 2, buyUsd: 2e6, sellUsd: 0, distinctBuyers: 2, lastBuyDate: '2026-08-28', clusterSell: false },
        }));
        expect(ids(buy)).toEqual(['insiderBuy', 'insiderBuyers', 'insiderBuyRecent']);
        expect(buy.factors[0].detail).toBe('2 08-28');
        expect(buy.bullPoints).toBe(35);

        const sell = scoreFocus(base({
            insider: { buyCount: 0, buyUsd: 0, sellUsd: 8e7, distinctBuyers: 0, lastBuyDate: null, clusterSell: true },
        }));
        expect(ids(sell)).toEqual(['insiderClusterSell']);
        expect(sell.stance).toBe('bearish');
    });

    it('routine selling only counts without any buys', () => {
        const r = scoreFocus(base({
            insider: { buyCount: 1, buyUsd: 1e5, sellUsd: 6e7, distinctBuyers: 1, lastBuyDate: '2026-05-01', clusterSell: false },
        }));
        expect(ids(r)).toEqual(['insiderBuy']);
    });

    it('uses the AI action only when fresh', () => {
        expect(ids(scoreFocus(base({ aiAction: { action: '买入', atMs: NOW - 2 * 86_400_000 } })))).toEqual(['aiBullish']);
        expect(ids(scoreFocus(base({ aiAction: { action: '卖出', atMs: NOW - 20 * 86_400_000 } })))).toEqual([]);
        expect(ids(scoreFocus(base({ aiAction: { action: '观望', atMs: NOW } })))).toEqual([]);
    });

    it('counts signal families for convergence and the 24h recency bonus', () => {
        const r = scoreFocus(base({
            recentSignals: [
                { kind: 'aidips.streak5', firedAt: NOW - 5 * 86_400_000 },
                { kind: 'insider.buy', firedAt: NOW - 3 * 86_400_000 },
                { kind: 'insider.largeSell', firedAt: NOW - 3 * 86_400_000 },
                { kind: 'event.edgar', firedAt: NOW - 3600_000 },
            ],
        }));
        expect(ids(r)).toEqual(['convergence3', 'signal24h']);
        expect(r.score).toBe(30);
    });

    it('urgency from catalyst proximity and urgent events', () => {
        expect(ids(scoreFocus(base({ nextCatalystDays: 2 })))).toEqual(['catalyst3d']);
        expect(ids(scoreFocus(base({ nextCatalystDays: 15 })))).toEqual(['catalyst21d']);
        expect(ids(scoreFocus(base({ nextCatalystDays: 40 })))).toEqual([]);
        const ev = scoreFocus(base({ urgentEventsAt: [NOW - 2 * 3600_000, NOW - 10 * 86_400_000] }));
        expect(ev.factors[0]).toMatchObject({ id: 'urgentEvent', points: 30, detail: '1' });
    });

    it('caps the score at 100', () => {
        const r = scoreFocus(base({
            dip: { streakDays: 10, streakDeclinePct: -30, drawdownFromHighPct: -30, excessDeclinePct: -10 },
            insider: { buyCount: 3, buyUsd: 1e6, sellUsd: 0, distinctBuyers: 3, lastBuyDate: '2026-09-01', clusterSell: false },
            nextCatalystDays: 1,
            urgentEventsAt: [NOW],
        }));
        expect(r.score).toBe(100);
        expect(r.stance).toBe('bullish');
    });

    it('downgrades a bullish stance when the price has not pulled back', () => {
        const r = scoreFocus(base({
            dip: { streakDays: 1, streakDeclinePct: -0.5, drawdownFromHighPct: -1.2, excessDeclinePct: 0 },
            insider: { buyCount: 2, buyUsd: 5e6, sellUsd: 0, distinctBuyers: 2, lastBuyDate: '2026-09-02', clusterSell: false },
        }));
        expect(r.caution).toBe('notPulledBack');
        expect(r.stance).toBe('watch');
        expect(r.bullPoints).toBe(35);
    });

    it('mixed when both sides have evidence inside the margin', () => {
        const r = scoreFocus(base({
            dip: { streakDays: 5, streakDeclinePct: -6, drawdownFromHighPct: -9, excessDeclinePct: 0 },
            insider: { buyCount: 0, buyUsd: 0, sellUsd: 1e8, distinctBuyers: 0, lastBuyDate: null, clusterSell: false },
        }));
        // bull 15 (drawdownLight 10 + streak5 5) vs bear 12
        expect(r.stance).toBe('mixed');
    });
});

describe('aggregateFocusInsider', () => {
    const trade = (over: Partial<FocusInsiderTrade> = {}): FocusInsiderTrade => ({
        name: 'A', transactionCode: 'P', transactionDate: '2026-08-25', amountUsd: 50_000, ...over,
    });

    it('returns null without trades', () => {
        expect(aggregateFocusInsider([], '2026-09-03')).toBeNull();
    });

    it('ignores token buys and buys older than 30 days — the TSM case', () => {
        const scripted = Array.from({ length: 30 }, (_, i) =>
            trade({ name: `Exec ${i}`, transactionDate: '2026-07-07', amountUsd: 3_800 }));
        const staleReal = trade({ name: 'Tien', transactionDate: '2026-08-03', amountUsd: 73_060 });
        const r = aggregateFocusInsider([...scripted, staleReal], '2026-09-03')!;
        expect(r.buyCount).toBe(0);
        expect(r.distinctBuyers).toBe(0);
        expect(r.lastBuyDate).toBeNull();
        expect(ids(scoreFocus(base({ insider: r })))).toEqual([]);
    });

    it('counts recent meaningful buys and keeps sells on the 90-day window', () => {
        const r = aggregateFocusInsider([
            trade({ name: 'A', transactionDate: '2026-08-25', amountUsd: 50_000 }),
            trade({ name: 'A', transactionDate: '2026-08-26', amountUsd: 9_999 }),      // token, skipped
            trade({ name: 'B', transactionDate: '2026-08-04', amountUsd: 500_000 }),    // 30 days back, counted
            trade({ name: 'C', transactionDate: '2026-08-03', amountUsd: 500_000 }),    // 31 days back, skipped
            trade({ name: 'D', transactionCode: 'S', transactionDate: '2026-06-10', amountUsd: 20_000_000 }),
            trade({ name: 'E', transactionCode: 'S', transactionDate: '2026-09-04', amountUsd: 1 }), // future, skipped
        ], '2026-09-03')!;
        expect(r).toEqual({ buyCount: 2, buyUsd: 550_000, sellUsd: 20_000_000, distinctBuyers: 2, lastBuyDate: '2026-08-25', clusterSell: false });
    });

    it('detects a seller cluster inside 7 days', () => {
        const r = aggregateFocusInsider([
            trade({ name: 'A', transactionCode: 'S', transactionDate: '2026-08-28', amountUsd: 1 }),
            trade({ name: 'B', transactionCode: 'S', transactionDate: '2026-08-30', amountUsd: 1 }),
            trade({ name: 'C', transactionCode: 'S', transactionDate: '2026-09-02', amountUsd: 1 }),
            trade({ name: 'C', transactionCode: 'S', transactionDate: '2026-09-03', amountUsd: 1 }),
        ], '2026-09-03')!;
        expect(r.clusterSell).toBe(true);
        expect(aggregateFocusInsider([
            trade({ name: 'A', transactionCode: 'S', transactionDate: '2026-08-26', amountUsd: 1 }), // 8 days back
            trade({ name: 'B', transactionCode: 'S', transactionDate: '2026-08-30', amountUsd: 1 }),
            trade({ name: 'C', transactionCode: 'S', transactionDate: '2026-09-02', amountUsd: 1 }),
        ], '2026-09-03')!.clusterSell).toBe(false);
    });
});

describe('excessDeclineOverStreak', () => {
    it('subtracts the benchmark move over the same sessions', () => {
        expect(excessDeclineOverStreak([100, 95, 90], [50, 49, 49], 2)).toBeCloseTo(-10 - -2, 6);
    });
    it('needs streak+1 closes on both sides', () => {
        expect(excessDeclineOverStreak([100, 90], [50, 49, 48], 2)).toBeNull();
        expect(excessDeclineOverStreak([100, 90], [50, 49], 0)).toBeNull();
    });
});

describe('compareFocus', () => {
    it('orders by score, then stance, then symbol', () => {
        const mk = (symbol: string, score: number, stance: 'bullish' | 'watch'): FocusScore =>
            ({ symbol, score, stance, bullPoints: 0, bearPoints: 0, factors: [], caution: null });
        const sorted = [mk('B', 50, 'watch'), mk('A', 50, 'bullish'), mk('C', 70, 'watch'), mk('D', 50, 'watch')].sort(compareFocus);
        expect(sorted.map((s) => s.symbol)).toEqual(['C', 'A', 'B', 'D']);
    });
});
