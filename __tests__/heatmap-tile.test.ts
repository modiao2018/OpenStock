import { describe, expect, it } from 'vitest';
import {
    HEATMAP_SESSION_REFRESH_MS,
    HEATMAP_VIEWER_ACTIVE_MS,
    MAX_HEATMAP_SYMBOLS,
    buildHeatmapTile,
    quoteSnapshotSweepDue,
    mergeHeatmapTiles,
    normalizeHeatmapSymbols,
    type HeatmapStock,
} from '@/lib/heatmap-tile';

const profile = { name: 'Apple Inc', finnhubIndustry: 'Technology' };
const quote = { c: 100, d: 1, dp: 1, o: 99, h: 101, l: 98, pc: 99, t: 1_700_000_000 };

function tile(symbol: string, marketCap: number, fetchedAt?: number, quoteTime = 0): HeatmapStock {
    return { symbol, name: symbol, price: 1, changePercent: 0, change: 0, open: 0, high: 0, low: 0, prevClose: 0, marketCap, industry: '', quoteTime, fetchedAt };
}

describe('normalizeHeatmapSymbols', () => {
    it('upper-cases, trims, de-duplicates, drops junk and caps the list', () => {
        const many = Array.from({ length: 50 }, (_, i) => `S${i}`);
        expect(normalizeHeatmapSymbols([' aapl', 'AAPL', 'msft ', 'bad symbol', 'BRK.B'], ['X'])).toEqual(['AAPL', 'MSFT', 'BRK.B']);
        expect(normalizeHeatmapSymbols(many, ['X'])).toHaveLength(MAX_HEATMAP_SYMBOLS);
    });

    it('falls back when nothing is provided', () => {
        expect(normalizeHeatmapSymbols(undefined, ['X'])).toEqual(['X']);
        expect(normalizeHeatmapSymbols([], ['X'])).toEqual(['X']);
    });
});

describe('buildHeatmapTile', () => {
    it('maps quote and profile fields, converting market cap from millions', () => {
        const t = buildHeatmapTile('AAPL', quote, profile, 3_000_000, 123);
        expect(t).toMatchObject({ symbol: 'AAPL', name: 'Apple Inc', price: 100, changePercent: 1, marketCap: 3e12, industry: 'Technology', quoteTime: 1_700_000_000, fetchedAt: 123 });
    });

    it('drops delisted tickers (zero price or market cap) and falls back to the symbol as name', () => {
        expect(buildHeatmapTile('GONE', { c: 0 }, profile, 10, 1)).toBeNull();
        expect(buildHeatmapTile('GONE', quote, profile, 0, 1)).toBeNull();
        expect(buildHeatmapTile('NEW', quote, { name: '', finnhubIndustry: '' }, 10, 1)?.name).toBe('NEW');
    });
});

describe('mergeHeatmapTiles', () => {
    it('lays fresh over previous, keeps only listed symbols, sorts by market cap', () => {
        const previous = [tile('A', 1), tile('B', 5), tile('GONE', 9)];
        const out = mergeHeatmapTiles(['A', 'B', 'C'], previous, [tile('A', 10), tile('C', 2)]);
        expect(out.map((t) => [t.symbol, t.marketCap])).toEqual([['A', 10], ['B', 5], ['C', 2]]);
    });
});

// 2026-09-15 is a Tuesday (EDT, UTC-4)
const TUE_NOON = new Date('2026-09-15T16:00:00Z');          // 12:00 ET, regular session
const TUE_AFTER_HOURS = new Date('2026-09-15T23:00:00Z');   // 19:00 ET, extended session
const TUE_CLOSE = new Date('2026-09-15T20:00:00Z').getTime(); // 16:00 ET
const TUE_NIGHT = new Date('2026-09-16T02:00:00Z');         // 22:00 ET, closed
const SAT = new Date('2026-09-19T15:00:00Z');               // Saturday

const snap = (updatedAt: Date, data: HeatmapStock[]) => ({ data, updatedAt });
const minutesBefore = (d: Date, m: number) => new Date(d.getTime() - m * 60_000);

describe('quoteSnapshotSweepDue', () => {
    it('always sweeps a missing or empty snapshot', () => {
        expect(quoteSnapshotSweepDue(null, TUE_NOON)).toBe(true);
        expect(quoteSnapshotSweepDue(snap(TUE_NOON, []), TUE_NOON)).toBe(true);
    });

    it('stays out of the way while a viewer is polling', () => {
        const recent = minutesBefore(TUE_NOON, HEATMAP_VIEWER_ACTIVE_MS / 60_000 - 1);
        expect(quoteSnapshotSweepDue(snap(recent, [tile('A', 1, recent.getTime())]), TUE_NOON)).toBe(false);
        const recentNight = minutesBefore(TUE_NIGHT, 1);
        expect(quoteSnapshotSweepDue(snap(recentNight, [tile('A', 1, 0)]), TUE_NIGHT)).toBe(false);
    });

    it('refreshes an unwatched snapshot every few minutes during the extended session', () => {
        const old = minutesBefore(TUE_AFTER_HOURS, HEATMAP_SESSION_REFRESH_MS / 60_000);
        expect(quoteSnapshotSweepDue(snap(old, [tile('A', 1, old.getTime())]), TUE_AFTER_HOURS)).toBe(true);
        const between = minutesBefore(TUE_NOON, 4);
        expect(quoteSnapshotSweepDue(snap(between, [tile('A', 1, between.getTime())]), TUE_NOON)).toBe(false);
    });

    it('after the close, sweeps once when the snapshot or any tile predates it, then rests', () => {
        const beforeClose = TUE_CLOSE - 30 * 60_000;
        const afterClose = TUE_CLOSE + 60 * 60_000;
        expect(quoteSnapshotSweepDue(snap(new Date(beforeClose), [tile('A', 1, beforeClose)]), TUE_NIGHT)).toBe(true);
        // Written after the close but one tile the web's partial sweep never reached
        expect(quoteSnapshotSweepDue(snap(new Date(afterClose), [tile('A', 1, afterClose), tile('B', 1, beforeClose)]), TUE_NIGHT)).toBe(true);
        // Legacy tile without fetchedAt counts as never fetched
        expect(quoteSnapshotSweepDue(snap(new Date(afterClose), [tile('A', 1)]), TUE_NIGHT)).toBe(true);
        expect(quoteSnapshotSweepDue(snap(new Date(afterClose), [tile('A', 1, afterClose)]), TUE_NIGHT)).toBe(false);
    });

    it('does not re-sweep over the weekend once Friday\'s close is in', () => {
        const friEvening = new Date('2026-09-18T23:50:00Z').getTime(); // Fri 19:50 ET
        expect(quoteSnapshotSweepDue(snap(new Date(friEvening), [tile('A', 1, friEvening)]), SAT)).toBe(false);
    });
});
