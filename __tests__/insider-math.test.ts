import { describe, expect, it } from 'vitest';
import {
    decideNotify,
    filterOpenMarketTxs,
    formatUsdCompact,
    shiftDate,
    summarizeInsiderTxs,
    txAmountUsd,
    txExternalKey,
    type InsiderTx,
    type NotifyOpts,
} from '@/lib/insider-math';

const tx = (overrides: Partial<InsiderTx> = {}): InsiderTx => ({
    symbol: 'NVDA',
    name: 'Jane Doe',
    change: 1000,
    transactionPrice: 100,
    transactionCode: 'P',
    transactionDate: '2026-08-20',
    filingDate: '2026-08-22',
    ...overrides,
});

const OPTS: NotifyOpts = { sellMinUsd: 1_000_000, clusterDays: 7, clusterMinSellers: 3 };

describe('filterOpenMarketTxs', () => {
    it('keeps only P and S codes', () => {
        const raw = [
            { transactionCode: 'P', change: 100, transactionDate: '2026-08-01', name: 'A' },
            { transactionCode: 'S', change: -100, transactionDate: '2026-08-02', name: 'B' },
            { transactionCode: 'A', change: 5000, transactionDate: '2026-08-03', name: 'C' },
            { transactionCode: 'M', change: 5000, transactionDate: '2026-08-03', name: 'C' },
            { transactionCode: 'F', change: -300, transactionDate: '2026-08-03', name: 'C' },
            { transactionCode: 'G', change: -300, transactionDate: '2026-08-03', name: 'C' },
        ];
        const out = filterOpenMarketTxs('NVDA', raw);
        expect(out.map((t) => t.transactionCode)).toEqual(['P', 'S']);
        expect(out.every((t) => t.symbol === 'NVDA')).toBe(true);
    });

    it('drops zero-change records', () => {
        expect(filterOpenMarketTxs('X', [{ transactionCode: 'P', change: 0, transactionDate: '2026-08-01' }])).toEqual([]);
    });

    it('falls back to filingDate when transactionDate is empty, drops when both missing', () => {
        const out = filterOpenMarketTxs('X', [
            { transactionCode: 'P', change: 10, transactionDate: '', filingDate: '2026-08-05' },
            { transactionCode: 'P', change: 10, transactionDate: '', filingDate: '' },
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].transactionDate).toBe('2026-08-05');
    });

    it('defaults a missing price to 0 (unknown)', () => {
        const out = filterOpenMarketTxs('X', [{ transactionCode: 'S', change: -10, transactionDate: '2026-08-01' }]);
        expect(out[0].transactionPrice).toBe(0);
    });
});

describe('txAmountUsd', () => {
    it('computes |change| * price', () => {
        expect(txAmountUsd(tx({ change: -2000, transactionPrice: 50 }))).toBe(100_000);
    });

    it('returns null when the price is unknown', () => {
        expect(txAmountUsd(tx({ transactionPrice: 0 }))).toBeNull();
    });
});

describe('txExternalKey', () => {
    it('is stable for identical fields and changes with any field', () => {
        expect(txExternalKey(tx())).toBe(txExternalKey(tx()));
        expect(txExternalKey(tx({ change: 999 }))).not.toBe(txExternalKey(tx()));
        expect(txExternalKey(tx({ filingDate: '2026-08-23' }))).not.toBe(txExternalKey(tx()));
        expect(txExternalKey(tx({ name: 'Other' }))).not.toBe(txExternalKey(tx()));
    });
});

describe('summarizeInsiderTxs', () => {
    it('aggregates buys and sells with net totals', () => {
        const s = summarizeInsiderTxs(
            [
                tx({ change: 1000, transactionPrice: 100 }),
                tx({ transactionCode: 'S', change: -500, transactionPrice: 100, name: 'B' }),
            ],
            '2026-08-30',
        );
        expect(s.buyCount).toBe(1);
        expect(s.sellCount).toBe(1);
        expect(s.buyUsd).toBe(100_000);
        expect(s.sellUsd).toBe(50_000);
        expect(s.netUsd).toBe(50_000);
        expect(s.netShares).toBe(500);
        expect(s.lastTxDate).toBe('2026-08-20');
    });

    it('respects the trailing window boundary', () => {
        const inWindow = tx({ transactionDate: '2026-06-02' });   // exactly 90 days before
        const outOfWindow = tx({ transactionDate: '2026-06-01' });
        const s = summarizeInsiderTxs([inWindow, outOfWindow], '2026-08-31');
        expect(s.buyCount).toBe(1);
    });

    it('counts unknown-price transactions but excludes them from dollar totals', () => {
        const s = summarizeInsiderTxs(
            [tx({ transactionPrice: 0 }), tx({ transactionPrice: 100 })],
            '2026-08-30',
        );
        expect(s.buyCount).toBe(2);
        expect(s.buyUsd).toBe(100_000);
        expect(s.unknownPriceCount).toBe(1);
    });

    it('handles empty input', () => {
        const s = summarizeInsiderTxs([], '2026-08-30');
        expect(s).toMatchObject({ buyCount: 0, sellCount: 0, netUsd: 0, lastTxDate: null });
    });
});

describe('decideNotify', () => {
    it('always alerts on a buy', () => {
        expect(decideNotify(tx(), [], OPTS)).toEqual({ notify: true, reason: 'buy' });
    });

    it('alerts on a sell strictly above the threshold, not below', () => {
        const small = tx({ transactionCode: 'S', change: -9_900, transactionPrice: 100 });   // $990K
        const large = tx({ transactionCode: 'S', change: -10_100, transactionPrice: 100 }); // $1.01M
        expect(decideNotify(small, [], OPTS).notify).toBe(false);
        expect(decideNotify(large, [], OPTS)).toEqual({ notify: true, reason: 'largeSell' });
    });

    it('does not treat an unknown-price sell as large', () => {
        const unknown = tx({ transactionCode: 'S', change: -1_000_000, transactionPrice: 0 });
        expect(decideNotify(unknown, [], OPTS).notify).toBe(false);
    });

    it('alerts when enough distinct insiders sell a combined amount above the threshold', () => {
        const newSell = tx({ transactionCode: 'S', change: -4000, transactionPrice: 100, name: 'A' });   // $400K
        const others = [
            tx({ transactionCode: 'S', change: -4000, transactionPrice: 100, name: 'B', transactionDate: '2026-08-16' }),
            tx({ transactionCode: 'S', change: -4000, transactionPrice: 100, name: 'C', transactionDate: '2026-08-18' }),
        ];
        expect(decideNotify(newSell, others, OPTS)).toEqual({ notify: true, reason: 'clusterSell' });
    });

    it('a cluster of small routine sells stays quiet despite the headcount', () => {
        const newSell = tx({ transactionCode: 'S', change: -100, transactionPrice: 100, name: 'A' });    // $10K each
        const others = [
            tx({ transactionCode: 'S', change: -100, name: 'B', transactionDate: '2026-08-16' }),
            tx({ transactionCode: 'S', change: -100, name: 'C', transactionDate: '2026-08-18' }),
        ];
        expect(decideNotify(newSell, others, OPTS).notify).toBe(false);
    });

    it('repeat sells by the same insider are not a cluster', () => {
        const newSell = tx({ transactionCode: 'S', change: -4000, transactionPrice: 100, name: 'A' });
        const others = [
            tx({ transactionCode: 'S', change: -4000, transactionPrice: 100, name: 'A', transactionDate: '2026-08-16' }),
            tx({ transactionCode: 'S', change: -4000, transactionPrice: 100, name: 'A', transactionDate: '2026-08-18' }),
        ];
        expect(decideNotify(newSell, others, OPTS).notify).toBe(false);
    });

    it('sells outside the cluster window do not count', () => {
        const newSell = tx({ transactionCode: 'S', change: -4000, transactionPrice: 100, name: 'A' });
        const others = [
            tx({ transactionCode: 'S', change: -4000, transactionPrice: 100, name: 'B', transactionDate: '2026-08-12' }), // 8 days back
            tx({ transactionCode: 'S', change: -4000, transactionPrice: 100, name: 'C', transactionDate: '2026-08-25' }), // after newTx
        ];
        expect(decideNotify(newSell, others, OPTS).notify).toBe(false);
    });
});

describe('formatUsdCompact', () => {
    it('formats magnitudes', () => {
        expect(formatUsdCompact(2_100_000)).toBe('$2.1M');
        expect(formatUsdCompact(530_000)).toBe('$530K');
        expect(formatUsdCompact(980)).toBe('$980');
        expect(formatUsdCompact(1_500_000_000)).toBe('$1.5B');
        expect(formatUsdCompact(-2_100_000)).toBe('-$2.1M');
    });
});

describe('shiftDate', () => {
    it('shifts across month boundaries', () => {
        expect(shiftDate('2026-08-20', -7)).toBe('2026-08-13');
        expect(shiftDate('2026-09-01', -1)).toBe('2026-08-31');
        expect(shiftDate('2026-08-31', -90)).toBe('2026-06-02');
    });
});
