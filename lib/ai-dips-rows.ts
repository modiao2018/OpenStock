// Row assembly for the AI dips board, shared by the web action
// (lib/actions/ai-dips.actions.ts) and the monitor's quote sweep
// (catalyst-monitor/src/collectors/quotes.ts). Pure: no I/O, no 'use server'.

import type { AiDipMeta, AiSubSector } from '@/lib/ai-dips-catalog';
import { completedBars, computeDipStats, type DailyBar } from '@/lib/ai-dips-math';

// Fixed snapshot key: the pool is a global, editable set — hashing the symbol
// list (snapshotKey) would orphan the snapshot on every pool edit
export const AI_DIPS_SNAPSHOT_KEY = 'ai-dips:pool';

export interface AiDipStock {
    symbol: string;
    name: string;
    subSector: AiSubSector;
    // Finnhub live quote; 0 when unavailable
    price: number;
    todayChangePct: number;
    // Epoch ms when the price was last fetched from Finnhub, 0 when never
    fetchedAt: number;
    streakDays: number;
    streakCapped: boolean;
    streakDeclinePct: number | null;
    drawdownFromHighPct: number | null;
    // Live price is below the last completed close — today extends the slide
    provisionalToday: boolean;
    // Trailing closes for the sparkline, ascending
    closes: number[];
    // False when Alpaca returned no usable history for the symbol
    barsOk: boolean;
}

export interface AiDipsPayload {
    // ALPACA_API_KEY/SECRET present — streak columns are meaningful
    configured: boolean;
    // Epoch ms of computation
    updatedAt: number;
    rows: AiDipStock[];
    // Alpaca bars fetch threw while configured — streak data is stale/missing
    barsError?: boolean;
    // Finnhub returned no usable quote for any symbol — likely quota/outage
    quotesError?: boolean;
    // Symbols whose quote could not be refreshed this round (gate budget or
    // upstream failure) and show the previous snapshot's price instead
    quotesStale?: number;
}

/** Fields of Finnhub's /quote response the board reads */
export type AiDipQuote = { c?: number; dp?: number };

export interface AiDipsRowsInput {
    pool: AiDipMeta[];
    barsBySymbol: Record<string, DailyBar[]>;
    // Today's still-forming session, dropped from the bars (undefined after the close)
    excludeDate?: string;
    // Fresh quotes by symbol — only entries with a positive price
    quotes: Record<string, AiDipQuote>;
    // Symbols a quote was attempted for this round (fetched or refused)
    attempted: Set<string>;
    previousRows: Map<string, AiDipStock>;
    fetchedAt: number;
}

/** Longest streak first, deepest decline breaking ties; symbols without history sink */
export function sortAiDipRows(rows: AiDipStock[]): AiDipStock[] {
    return rows.sort((a, b) => {
        if (a.barsOk !== b.barsOk) return a.barsOk ? -1 : 1;
        if (a.streakDays !== b.streakDays) return b.streakDays - a.streakDays;
        return (a.streakDeclinePct ?? 0) - (b.streakDeclinePct ?? 0);
    });
}

/**
 * Rows for the board. A symbol without a fresh quote keeps the previous
 * snapshot's price rather than a 0 that renders as "—" and then gets persisted.
 */
export function buildAiDipsRows(input: AiDipsRowsInput): { rows: AiDipStock[]; quotesStale: number } {
    const { pool, barsBySymbol, excludeDate, quotes, attempted, previousRows, fetchedAt } = input;
    const rows = pool.map(({ symbol, name, subSector }): AiDipStock => {
        const stats = computeDipStats(completedBars(barsBySymbol[symbol] ?? [], excludeDate));
        const live = quotes[symbol];
        const previous = previousRows.get(symbol);
        const price = live?.c ?? previous?.price ?? 0;
        return {
            symbol,
            name,
            subSector,
            price,
            todayChangePct: live ? live.dp ?? 0 : previous?.todayChangePct ?? 0,
            fetchedAt: live ? fetchedAt : previous?.fetchedAt ?? 0,
            streakDays: stats?.streakDays ?? 0,
            streakCapped: stats?.streakCapped ?? false,
            streakDeclinePct: stats?.streakDeclinePct ?? null,
            drawdownFromHighPct: stats?.drawdownFromHighPct ?? null,
            provisionalToday: Boolean(stats && price > 0 && price < stats.lastClose),
            closes: stats?.closes ?? [],
            barsOk: stats !== null,
        };
    });
    // Rows still showing an earlier price: left out by the budget, or fetched
    // and refused. A symbol Finnhub has never priced (delisted) is not stale.
    const quotesStale = pool.filter(
        ({ symbol }) => !quotes[symbol] && (!attempted.has(symbol) || (previousRows.get(symbol)?.price ?? 0) > 0),
    ).length;
    return { rows: sortAiDipRows(rows), quotesStale };
}

/** True when no symbol got a quote this round and none carries an earlier price either */
export function aiDipsQuotesError(symbols: string[], quotes: Record<string, AiDipQuote>, previousRows: Map<string, AiDipStock>): boolean {
    return symbols.length > 0
        && Object.keys(quotes).length === 0
        && !symbols.some((s) => (previousRows.get(s)?.price ?? 0) > 0);
}
