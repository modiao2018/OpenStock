import { describe, expect, it } from 'vitest';
import {
    buildScorecard,
    daysBetween,
    directionOfAction,
    entryTargetDate,
    resolveOutcomes,
    type ScoreSample,
} from '@/lib/signal-math';

const bars = (closes: number[], start = 1) =>
    closes.map((c, i) => ({ date: `2026-09-${String(start + i).padStart(2, '0')}`, c }));

describe('entryTargetDate', () => {
    it('uses the same session when fired before the close', () => {
        // 14:00 ET = 18:00 UTC on 2026-09-02 (EDT)
        expect(entryTargetDate(new Date('2026-09-02T18:00:00Z'))).toBe('2026-09-02');
    });
    it('rolls to the next day when fired after the close', () => {
        // 17:30 ET = 21:30 UTC
        expect(entryTargetDate(new Date('2026-09-02T21:30:00Z'))).toBe('2026-09-03');
    });
    it('treats a late-evening Beijing push (early ET morning) as same day', () => {
        // 09:00 ET = 13:00 UTC
        expect(entryTargetDate(new Date('2026-09-02T13:00:00Z'))).toBe('2026-09-02');
    });
});

describe('resolveOutcomes', () => {
    const stock = bars([100, 102, 101, 103, 104, 105, 106]); // 09-01 .. 09-07
    const bench = bars([50, 50.5, 50.5, 51, 51, 51.5, 52]);

    it('snaps the entry forward to the next available session', () => {
        const r = resolveOutcomes(stock, bench, '2026-09-02')!;
        expect(r.entryDate).toBe('2026-09-02');
        expect(r.entryClose).toBe(102);
        const r2 = resolveOutcomes(bars([100, 101], 1).concat(bars([103], 5)), bench, '2026-09-03')!;
        expect(r2.entryDate).toBe('2026-09-05');
    });

    it('returns null when the entry session has not completed', () => {
        expect(resolveOutcomes(stock, bench, '2026-09-08')).toBeNull();
    });

    it('refuses to snap forward across a gap larger than the grace window', () => {
        expect(resolveOutcomes(bars([100, 101], 20), bench, '2026-09-01')).toBeNull();
        expect(resolveOutcomes(bars([100, 101], 20), bench, '2026-09-01', 30)?.entryDate).toBe('2026-09-20');
    });

    it('computes t1/t5 returns and excess vs benchmark, marks incomplete without t20', () => {
        const r = resolveOutcomes(stock, bench, '2026-09-01')!;
        expect(r.horizons.t1?.returnPct).toBeCloseTo(2, 6);
        expect(r.horizons.t1?.excessPct).toBeCloseTo(2 - 1, 6);
        expect(r.horizons.t5?.date).toBe('2026-09-06');
        expect(r.horizons.t5?.returnPct).toBeCloseTo(5, 6);
        expect(r.horizons.t5?.excessPct).toBeCloseTo(5 - 3, 6);
        expect(r.horizons.t20).toBeUndefined();
        expect(r.complete).toBe(false);
    });

    it('leaves excess null when the benchmark lacks the bar', () => {
        const r = resolveOutcomes(stock, [], '2026-09-01')!;
        expect(r.benchmarkEntryClose).toBeNull();
        expect(r.horizons.t1?.excessPct).toBeNull();
    });
});

describe('buildScorecard', () => {
    const sample = (direction: ScoreSample['direction'], t1: number, kind = 'k'): ScoreSample & { kind: string } => ({
        kind,
        direction,
        horizons: { t1: { returnPct: t1, excessPct: t1 } },
    });

    it('withholds the hit rate below the sample floor', () => {
        const rows = buildScorecard([sample('up', 1), sample('up', 2), sample('up', -1)], (s) => s.kind);
        expect(rows[0].horizons.t1.n).toBe(3);
        expect(rows[0].horizons.t1.hitRate).toBeNull();
        expect(rows[0].horizons.t1.avgExcessPct).toBeCloseTo(2 / 3, 6);
        expect(rows[0].horizons.t5.n).toBe(0);
    });

    it('scores hits by direction: down signals win when excess is negative', () => {
        const rows = buildScorecard(
            [sample('down', -1), sample('down', -2), sample('down', 0.5), sample('down', -3), sample('down', -0.1)],
            (s) => s.kind
        );
        expect(rows[0].horizons.t1.hitRate).toBeCloseTo(0.8, 6);
        expect(rows[0].horizons.t1.medianExcessPct).toBe(-1);
    });

    it('excludes direction-less signals from the hit rate but keeps their magnitude', () => {
        const list = [
            ...Array.from({ length: 5 }, () => sample('up', 1)),
            sample('none', -9),
        ];
        const rows = buildScorecard(list, (s) => s.kind);
        expect(rows[0].horizons.t1.hitRate).toBe(1);
        expect(rows[0].horizons.t1.n).toBe(6);
        expect(rows[0].directions.none).toBe(1);
        expect(rows[0].horizons.t1.avgAbsExcessPct).toBeCloseTo((5 + 9) / 6, 6);
    });

    it('groups by key and orders larger groups first', () => {
        const rows = buildScorecard([sample('up', 1, 'a'), sample('up', 1, 'b'), sample('up', 1, 'b')], (s) => s.kind);
        expect(rows.map((r) => r.key)).toEqual(['b', 'a']);
    });
});

describe('helpers', () => {
    it('daysBetween', () => expect(daysBetween('2026-09-01', '2026-09-11')).toBe(10));
    it('directionOfAction', () => {
        expect(directionOfAction('买入')).toBe('up');
        expect(directionOfAction('减仓')).toBe('down');
        expect(directionOfAction('观望')).toBeNull();
        expect(directionOfAction(null)).toBeNull();
    });
});
