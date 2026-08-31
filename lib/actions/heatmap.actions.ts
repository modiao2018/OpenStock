'use server';

import { fetchJSON } from '@/lib/actions/finnhub.actions';
import { marketCapToUsdMillions } from '@/lib/market-cap';
import { readSnapshot, snapshotKey, writeSnapshot } from '@/lib/snapshot';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const NEXT_PUBLIC_FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';

// Kept below ~30 symbols so a cold load (quote + profile each) stays inside
// Finnhub's free-tier 60 requests/minute limit
const HEATMAP_SYMBOLS = [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'NFLX', 'ORCL', 'CRM',
    'ADBE', 'INTC', 'AMD', 'PYPL', 'UBER', 'SPOT', 'SHOP', 'SNOW', 'PLTR', 'COIN',
    'RBLX', 'DDOG', 'CRWD', 'NET', 'ABNB', 'DASH', 'BABA', 'JD', 'PDD', 'SE',
];

// Same rate-limit reasoning for caller-provided lists (watchlist / dashboard config)
const MAX_CUSTOM_SYMBOLS = 40;
const SYMBOL_PATTERN = /^[A-Z0-9.\-]{1,12}$/;

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
}

type Quote = { c?: number; d?: number; dp?: number; o?: number; h?: number; l?: number; pc?: number; t?: number };
type Profile = { name?: string; currency?: string; marketCapitalization?: number; finnhubIndustry?: string };

function normalizeSymbols(symbols?: string[]): string[] {
    return symbols && symbols.length > 0
        ? [...new Set(symbols.map((s) => s.trim().toUpperCase()))]
              .filter((s) => SYMBOL_PATTERN.test(s))
              .slice(0, MAX_CUSTOM_SYMBOLS)
        : HEATMAP_SYMBOLS;
}

// Last successful getHeatmapData payload; lets SSR paint instantly (≤~60s
// stale) while the client's mount refresh + poll fetches live data
export async function getHeatmapSnapshot(symbols?: string[]): Promise<HeatmapStock[]> {
    const list = normalizeSymbols(symbols);
    const snapshot = await readSnapshot<HeatmapStock[]>(snapshotKey('heatmap', list));
    return snapshot?.data ?? [];
}

export async function getHeatmapData(symbols?: string[]): Promise<HeatmapStock[]> {
    const token = NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!token) return [];

    const list = normalizeSymbols(symbols);

    const results = await Promise.all(
        list.map(async (symbol) => {
            try {
                const [quote, profile] = await Promise.all([
                    // Short cache: Next serves stale-while-revalidate, so a longer
                    // TTL means infrequent visits keep seeing the previous visit's
                    // data. 60s still dedupes concurrent renders and client polls.
                    fetchJSON<Quote>(
                        `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`,
                        60,
                    ),
                    fetchJSON<Profile>(
                        `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`,
                        86400,
                    ),
                ]);

                const price = quote?.c ?? 0;
                const marketCapMillions = await marketCapToUsdMillions(
                    profile?.marketCapitalization ?? 0,
                    profile?.currency,
                );
                // Delisted/renamed tickers come back with zeroed data — drop them
                if (price <= 0 || marketCapMillions <= 0) return null;

                return {
                    symbol,
                    name: profile?.name || symbol,
                    price,
                    changePercent: quote?.dp ?? 0,
                    change: quote?.d ?? 0,
                    open: quote?.o ?? 0,
                    high: quote?.h ?? 0,
                    low: quote?.l ?? 0,
                    prevClose: quote?.pc ?? 0,
                    marketCap: marketCapMillions * 1e6,
                    industry: profile?.finnhubIndustry ?? '',
                    quoteTime: quote?.t ?? 0,
                } satisfies HeatmapStock;
            } catch (e) {
                console.error('Heatmap fetch failed for', symbol, e);
                return null;
            }
        }),
    );

    const data = results
        .filter((s): s is HeatmapStock => s !== null)
        .sort((a, b) => b.marketCap - a.marketCap);

    // Every fetch (SSR or the client's 60s poll) refreshes the snapshot,
    // so the next SSR serves it instantly instead of re-fanning out
    if (data.length > 0) {
        void writeSnapshot(snapshotKey('heatmap', list), data);
    }

    return data;
}
