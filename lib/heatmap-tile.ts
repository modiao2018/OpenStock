// Heatmap tile shape and the pure pieces shared by the web action
// (lib/actions/heatmap.actions.ts) and the monitor's quote sweep
// (catalyst-monitor/src/collectors/quotes.ts). No I/O, no 'use server',
// no Next imports — the monitor image ships without Next.

import type { StoredCompanyProfile } from '@/lib/company-profiles';
import { isExtendedSession, lastSessionCloseMs } from '@/lib/market-hours';

export interface HeatmapStock {
    symbol: string;
    name: string;
    price: number;
    changePercent: number;
    // Absolute change in USD
    change: number;
    open: number;
    high: number;
    low: number;
    prevClose: number;
    // USD (converted from Finnhub's millions)
    marketCap: number;
    // Raw finnhubIndustry value; translated at render time, '' when unknown
    industry: string;
    // Unix seconds of the quote's last trade, 0 when the upstream omits it
    quoteTime: number;
    // Epoch ms when this tile was last fetched from Finnhub (drives staleness;
    // absent on snapshots written before this field existed)
    fetchedAt?: number;
}

/** Fields of Finnhub's /quote response the heatmap reads */
export type FinnhubQuote = { c?: number; d?: number; dp?: number; o?: number; h?: number; l?: number; pc?: number; t?: number };

// Caller-provided lists (watchlist / dashboard config) are capped so one
// sweep stays inside Finnhub's free budget
export const MAX_HEATMAP_SYMBOLS = 40;
const SYMBOL_PATTERN = /^[A-Z0-9.\-]{1,12}$/;

/**
 * Upper-cased, de-duplicated, pattern-checked, capped list — or `fallback`
 * when nothing was provided. Both the page and the monitor must normalise
 * identically or they would key different snapshots for the same list.
 */
export function normalizeHeatmapSymbols(symbols: string[] | undefined, fallback: string[]): string[] {
    return symbols && symbols.length > 0
        ? [...new Set(symbols.map((s) => s.trim().toUpperCase()))]
              .filter((s) => SYMBOL_PATTERN.test(s))
              .slice(0, MAX_HEATMAP_SYMBOLS)
        : fallback;
}

/** One tile from a quote + profile; null for delisted/renamed tickers (zeroed data) */
export function buildHeatmapTile(
    symbol: string,
    quote: FinnhubQuote,
    profile: Pick<StoredCompanyProfile, 'name' | 'finnhubIndustry'>,
    marketCapUsdMillions: number,
    fetchedAt: number,
): HeatmapStock | null {
    const price = quote.c ?? 0;
    if (price <= 0 || marketCapUsdMillions <= 0) return null;
    return {
        symbol,
        name: profile.name || symbol,
        price,
        changePercent: quote.dp ?? 0,
        change: quote.d ?? 0,
        open: quote.o ?? 0,
        high: quote.h ?? 0,
        low: quote.l ?? 0,
        prevClose: quote.pc ?? 0,
        marketCap: marketCapUsdMillions * 1e6,
        industry: profile.finnhubIndustry,
        quoteTime: quote.t ?? 0,
        fetchedAt,
    };
}

/**
 * `fresh` tiles laid over `previous`, restricted to `list`, biggest market cap
 * first. A symbol that failed this round keeps its last-known tile instead of
 * vanishing from the heatmap.
 */
export function mergeHeatmapTiles(list: string[], previous: HeatmapStock[] | null, fresh: HeatmapStock[]): HeatmapStock[] {
    const bySymbol = new Map((previous ?? []).map((s) => [s.symbol, s]));
    for (const s of fresh) bySymbol.set(s.symbol, s);
    return list
        .map((symbol) => bySymbol.get(symbol))
        .filter((s): s is HeatmapStock => s !== undefined)
        .sort((a, b) => b.marketCap - a.marketCap);
}

// A snapshot written this recently means a viewer's 60s poll is refreshing it;
// the monitor stays out of the way so the two do not double-spend the budget
export const HEATMAP_VIEWER_ACTIVE_MS = 3 * 60_000;
// How old an in-session snapshot may get with nobody watching before the
// monitor refreshes it (bounds the age of the SSR paint on the next visit)
export const HEATMAP_SESSION_REFRESH_MS = 5 * 60_000;

/**
 * Whether the monitor should refresh a quote snapshot now. `data` is whatever
 * the snapshot holds per symbol, as long as each entry records when its quote
 * was fetched (heatmap tiles, AI-dips rows).
 *
 * Pull-on-view left snapshots frozen at whatever close the last visitor saw —
 * opening the dashboard on a Wednesday painted Friday's close. The monitor
 * fills the gap: every few minutes during the extended session when no viewer
 * is polling, and once after the latest close so the snapshot always carries
 * it. Outside the session quotes cannot move, so a snapshot fully fetched
 * after the close is never re-swept (holidays included).
 */
export function quoteSnapshotSweepDue(
    snapshot: { data: Array<{ fetchedAt?: number }>; updatedAt: Date } | null,
    now: Date = new Date(),
): boolean {
    if (!snapshot || snapshot.data.length === 0) return true;
    const nowMs = now.getTime();
    const updatedAt = snapshot.updatedAt.getTime();
    if (nowMs - updatedAt < HEATMAP_VIEWER_ACTIVE_MS) return false;
    if (isExtendedSession(now)) return nowMs - updatedAt >= HEATMAP_SESSION_REFRESH_MS;
    const close = lastSessionCloseMs(now);
    return updatedAt < close || snapshot.data.some((s) => (s.fetchedAt ?? 0) < close);
}
