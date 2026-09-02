import { describe, expect, it } from 'vitest';
import { completedBars, computeDipStats, DIP_WINDOW, type DailyBar } from '@/lib/ai-dips-math';
import { AI_DIP_CATALOG, AI_SUB_SECTORS } from '@/lib/ai-dips-catalog';

const bars = (...closes: number[]): DailyBar[] =>
    closes.map((c, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, c }));

describe('completedBars', () => {
    it('drops a trailing bar matching excludeDate', () => {
        const input = bars(10, 9, 8);
        expect(completedBars(input, '2026-08-03')).toEqual(input.slice(0, 2));
    });

    it('keeps everything when the trailing date differs', () => {
        const input = bars(10, 9, 8);
        expect(completedBars(input, '2026-08-04')).toEqual(input);
    });

    it('never drops non-trailing bars and tolerates empty input', () => {
        const input = bars(10, 9, 8);
        expect(completedBars(input, '2026-08-01')).toEqual(input);
        expect(completedBars([], '2026-08-01')).toEqual([]);
        expect(completedBars(input)).toEqual(input);
    });
});

describe('computeDipStats', () => {
    it('counts a basic 3-day decline', () => {
        const s = computeDipStats(bars(100, 102, 99, 97, 94))!;
        expect(s.streakDays).toBe(3);
        expect(s.streakCapped).toBe(false);
        expect(s.streakDeclinePct).toBeCloseTo((94 / 102 - 1) * 100, 6);
        expect(s.lastClose).toBe(94);
    });

    it('a flat close breaks the streak', () => {
        const s = computeDipStats(bars(100, 98, 98, 96))!;
        expect(s.streakDays).toBe(1);
        expect(s.streakDeclinePct).toBeCloseTo((96 / 98 - 1) * 100, 6);
    });

    it('an up day resets the streak to zero', () => {
        const s = computeDipStats(bars(100, 95, 97))!;
        expect(s.streakDays).toBe(0);
        expect(s.streakDeclinePct).toBeNull();
    });

    it('flags capped when the streak spans the whole window', () => {
        const s = computeDipStats(bars(100, 99, 98, 97))!;
        expect(s.streakDays).toBe(3);
        expect(s.streakCapped).toBe(true);
        expect(s.streakDeclinePct).toBeCloseTo((97 / 100 - 1) * 100, 6);
    });

    it('returns null with fewer than 2 bars', () => {
        expect(computeDipStats([])).toBeNull();
        expect(computeDipStats(bars(100))).toBeNull();
    });

    it('computes drawdown against the trailing-window high close', () => {
        const s = computeDipStats(bars(100, 120, 110, 105))!;
        expect(s.drawdownFromHighPct).toBeCloseTo((105 / 120 - 1) * 100, 6);
    });

    it('limits sparkline closes and the drawdown window to DIP_WINDOW sessions', () => {
        // An old spike outside the window must not affect the drawdown
        const closes = [500, ...Array.from({ length: DIP_WINDOW }, (_, i) => 100 + i)];
        const s = computeDipStats(bars(...closes))!;
        expect(s.closes).toHaveLength(DIP_WINDOW);
        expect(s.closes[0]).toBe(100);
        expect(s.drawdownFromHighPct).toBeCloseTo(0, 6);
    });
});

describe('AI dip catalog', () => {
    it('symbols are unique, valid, and sub-sectors are known', () => {
        const symbols = AI_DIP_CATALOG.map((s) => s.symbol);
        expect(new Set(symbols).size).toBe(symbols.length);
        for (const entry of AI_DIP_CATALOG) {
            expect(entry.symbol).toMatch(/^[A-Z0-9.\-]{1,12}$/);
            expect(AI_SUB_SECTORS).toContain(entry.subSector);
            expect(entry.name.length).toBeGreaterThan(0);
        }
        // Alpaca batching + Finnhub rate-limit budget (60 req/min free tier,
        // quotes poll every 60s + insider fetch at 1.1s spacing) assume ~50
        expect(symbols.length).toBeLessThanOrEqual(55);
    });
});
