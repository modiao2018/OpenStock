import { describe, expect, it } from 'vitest';
import { aiDipsQuotesError, buildAiDipsRows, type AiDipStock } from '@/lib/ai-dips-rows';
import type { AiDipMeta } from '@/lib/ai-dips-catalog';
import type { DailyBar } from '@/lib/ai-dips-math';

const pool: AiDipMeta[] = [
    { symbol: 'AAA', name: 'A', subSector: 'chips' },
    { symbol: 'BBB', name: 'B', subSector: 'cloud' },
    { symbol: 'CCC', name: 'C', subSector: 'apps' },
];

const bars = (...closes: number[]): DailyBar[] =>
    closes.map((c, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, c }));

const previous = (symbol: string, price: number, fetchedAt: number): [string, AiDipStock] => [
    symbol,
    { symbol, name: symbol, subSector: 'chips', price, todayChangePct: -1, fetchedAt, streakDays: 0, streakCapped: false, streakDeclinePct: null, drawdownFromHighPct: null, provisionalToday: false, closes: [], barsOk: false },
];

describe('buildAiDipsRows', () => {
    it('uses the live quote when present and falls back to the previous price otherwise', () => {
        const { rows, quotesStale } = buildAiDipsRows({
            pool,
            barsBySymbol: { AAA: bars(10, 9, 8), BBB: bars(5, 6) },
            quotes: { AAA: { c: 7.5, dp: -6.25 } },
            attempted: new Set(['AAA', 'BBB']),
            previousRows: new Map([previous('BBB', 6.2, 100)]),
            fetchedAt: 999,
        });
        const a = rows.find((r) => r.symbol === 'AAA')!;
        const b = rows.find((r) => r.symbol === 'BBB')!;
        const c = rows.find((r) => r.symbol === 'CCC')!;
        expect(a).toMatchObject({ price: 7.5, todayChangePct: -6.25, fetchedAt: 999, streakDays: 2, barsOk: true, provisionalToday: true });
        expect(b).toMatchObject({ price: 6.2, todayChangePct: -1, fetchedAt: 100, streakDays: 0, barsOk: true });
        expect(c).toMatchObject({ price: 0, fetchedAt: 0, barsOk: false });
        // BBB attempted but refused with an earlier price -> stale; CCC never attempted -> stale
        expect(quotesStale).toBe(2);
    });

    it('does not count a never-priced symbol that was attempted as stale', () => {
        const { quotesStale } = buildAiDipsRows({
            pool, barsBySymbol: {}, quotes: {}, attempted: new Set(['AAA', 'BBB', 'CCC']), previousRows: new Map(), fetchedAt: 1,
        });
        expect(quotesStale).toBe(0);
    });

    it('sorts longest streak first, deepest decline breaking ties, no-history last', () => {
        const { rows } = buildAiDipsRows({
            pool,
            barsBySymbol: { AAA: bars(10, 9), BBB: bars(10, 9, 8), CCC: [] },
            quotes: {}, attempted: new Set(), previousRows: new Map(), fetchedAt: 1,
        });
        expect(rows.map((r) => r.symbol)).toEqual(['BBB', 'AAA', 'CCC']);
    });
});

describe('aiDipsQuotesError', () => {
    it('flags only when nothing was quoted and nothing carries an earlier price', () => {
        expect(aiDipsQuotesError(['AAA'], {}, new Map())).toBe(true);
        expect(aiDipsQuotesError(['AAA'], { AAA: { c: 1 } }, new Map())).toBe(false);
        expect(aiDipsQuotesError(['AAA'], {}, new Map([previous('AAA', 3, 1)]))).toBe(false);
        expect(aiDipsQuotesError([], {}, new Map())).toBe(false);
    });
});
