'use server';

import { getDateRange, validateArticle, formatArticle } from '@/lib/utils';
import { marketCapToUsdMillions } from '@/lib/market-cap';
import { POPULAR_STOCK_SYMBOLS } from '@/lib/constants';
import { cache } from 'react';
import { readSnapshot, snapshotKey, writeSnapshot } from '@/lib/snapshot';
import { recordSourceCall } from '@/lib/source-calls';
import { finnhubGate, retryAfterMs, throughFinnhubGate } from '@/lib/finnhub-gate';
import { resolveProfiles } from '@/lib/company-profiles';
import { inferSourceByHost } from '@/lib/sources-registry';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const NEXT_PUBLIC_FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';

type FinnhubQuote = {
    c?: number;
    d?: number;
    dp?: number;
};

type FinnhubCompanyProfile = {
    currency?: string;
    exchange?: string;
    logo?: string;
    marketCapitalization?: number;
    name?: string;
    ticker?: string;
};

type SearchStockCandidate = FinnhubSearchResult & {
    __exchange?: string;
};

const FINNHUB_EXCHANGE_SUFFIXES = new Set([
    'AS', 'AT', 'AX', 'BA', 'BK', 'BO', 'BR', 'CO', 'DE', 'F', 'HE', 'HK',
    'IL', 'IS', 'JK', 'JO', 'KL', 'KQ', 'KS', 'L', 'LS', 'MC', 'MI', 'MX',
    'NS', 'NZ', 'OL', 'PA', 'PR', 'SA', 'SI', 'SS', 'ST', 'SW', 'SZ', 'T',
    'TA', 'TO', 'TW', 'TWO', 'V', 'VI', 'WA',
]);

// Shared upstream fetcher for every Finnhub call in the web app. Requests go
// through the process-wide gate (memo + 50/min pacing + 429 cooldown, see
// lib/finnhub-gate.ts) and every real upstream call lands in the per-source
// ledger for the /status page. `revalidateSeconds` doubles as the memo TTL.
async function fetchJSON<T>(url: string, revalidateSeconds?: number, source?: string): Promise<T> {
    const sourceId = source ?? inferSourceByHost(url) ?? '';
    return throughFinnhubGate<T>(finnhubGate, url, (revalidateSeconds ?? 0) * 1000, async () => {
        const options: RequestInit & { next?: { revalidate?: number } } = revalidateSeconds
            ? { cache: 'force-cache', next: { revalidate: revalidateSeconds } }
            : { cache: 'no-store' };
        const start = Date.now();
        try {
            // Bound every upstream call — a hanging Finnhub connection must not stall SSR
            const res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
            if (!res.ok) {
                if (res.status === 429) finnhubGate.reportRateLimited(retryAfterMs(res.headers.get('retry-after')));
                const text = await res.text().catch(() => '');
                throw new Error(`Fetch failed ${res.status}: ${text}`);
            }
            const data = (await res.json()) as T;
            void recordSourceCall(sourceId, true, Date.now() - start);
            return data;
        } catch (err) {
            void recordSourceCall(sourceId, false, Date.now() - start, err);
            throw err;
        }
    });
}

export { fetchJSON };

function getExchangeLabel(symbol: string, exchange?: string) {
    if (exchange?.trim()) {
        return exchange.trim();
    }

    const parts = symbol.split('.');
    const suffix = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';

    if (!suffix) {
        return 'US';
    }

    return FINNHUB_EXCHANGE_SUFFIXES.has(suffix) ? suffix : 'US';
}

export async function getQuote(symbol: string) {
    try {
        const token = NEXT_PUBLIC_FINNHUB_API_KEY;
        const url = `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`;
        // Short server-side cache so concurrent renders/polls share one Finnhub call per symbol
        return await fetchJSON<FinnhubQuote>(url, 30);
    } catch (e) {
        console.error('Error fetching quote for', symbol, e);
        return null;
    }
}

// Profiles are persisted in Mongo (lib/company-profiles.ts) and refreshed at
// most daily, so cold starts only spend Finnhub budget on quotes
export async function getCompanyProfile(symbol: string): Promise<FinnhubCompanyProfile | null> {
    try {
        const token = NEXT_PUBLIC_FINNHUB_API_KEY;
        const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`;
        const profiles = await resolveProfiles([symbol], () => fetchJSON<FinnhubCompanyProfile>(url, 86400));
        return profiles.get(symbol) ?? null;
    } catch (e) {
        console.error('Error fetching profile for', symbol, e);
        return null;
    }
}

// Serve the last-known table rows instantly at SSR; the table's mount refresh
// fetches live data and writes the snapshot back. Falls back to a live fetch
// on the very first visit (no snapshot yet).
export async function getWatchlistDataCached(symbols: string[]) {
    if (!symbols || symbols.length === 0) return [];
    type Rows = Awaited<ReturnType<typeof getWatchlistData>>;
    const snapshot = await readSnapshot<Rows>(snapshotKey('watchlist', symbols));
    if (snapshot) return snapshot.data;
    return getWatchlistData(symbols);
}

export async function getWatchlistData(symbols: string[]) {
    if (!symbols || symbols.length === 0) return [];

    // Fetch quotes and profiles in parallel
    const promises = symbols.map(async (sym) => {
        const [quote, profile] = await Promise.all([
            getQuote(sym),
            getCompanyProfile(sym)
        ]);

        return {
            symbol: sym,
            // null (not 0) when the fetch failed or Finnhub has no data, so the UI can keep stale values
            price: quote?.c ? quote.c : null,
            change: quote?.d ?? null,
            changePercent: quote?.dp ?? null,
            currency: profile?.currency || 'USD',
            name: profile?.name || sym,
            logo: profile?.logo,
            // Normalized to USD millions — Finnhub reports in the primary listing's currency
            marketCap: profile?.marketCapitalization
                ? await marketCapToUsdMillions(profile.marketCapitalization, profile.currency)
                : null,
            peRatio: 0 // Finnhub 'quote' and 'profile2' don't easily give real-time PE. Might need 'metric' endpoint, but skipping for now to save rate limits.
        };
    });

    const rows = await Promise.all(promises);
    if (rows.some((r) => r.price !== null)) {
        void writeSnapshot(snapshotKey('watchlist', symbols), rows);
    }
    return rows;
}

// Lightweight variant for client-side polling: quotes only, no profile calls
// (name/logo/market cap barely change — refetching them per poll wastes rate limit).
export async function getWatchlistQuotes(symbols: string[]) {
    if (!symbols || symbols.length === 0) return [];

    return await Promise.all(symbols.map(async (sym) => {
        const quote = await getQuote(sym);
        return {
            symbol: sym,
            price: quote?.c ? quote.c : null,
            change: quote?.d ?? null,
            changePercent: quote?.dp ?? null,
        };
    }));
}


export async function getNews(symbols?: string[]): Promise<MarketNewsArticle[]> {
    try {
        const range = getDateRange(5);
        const token = NEXT_PUBLIC_FINNHUB_API_KEY;
        if (!token) {
            throw new Error('FINNHUB API key is not configured');
        }
        const cleanSymbols = (symbols || [])
            .map((s) => s?.trim().toUpperCase())
            .filter((s): s is string => Boolean(s));

        const maxArticles = 6;

        // If we have symbols, try to fetch company news per symbol and round-robin select
        if (cleanSymbols.length > 0) {
            const perSymbolArticles: Record<string, RawNewsArticle[]> = {};

            await Promise.all(
                cleanSymbols.map(async (sym) => {
                    try {
                        const url = `${FINNHUB_BASE_URL}/company-news?symbol=${encodeURIComponent(sym)}&from=${range.from}&to=${range.to}&token=${token}`;
                        const articles = await fetchJSON<RawNewsArticle[]>(url, 300);
                        perSymbolArticles[sym] = (articles || []).filter(validateArticle);
                    } catch (e) {
                        console.error('Error fetching company news for', sym, e);
                        perSymbolArticles[sym] = [];
                    }
                })
            );

            const collected: MarketNewsArticle[] = [];
            // Round-robin up to 6 picks
            for (let round = 0; round < maxArticles; round++) {
                for (let i = 0; i < cleanSymbols.length; i++) {
                    const sym = cleanSymbols[i];
                    const list = perSymbolArticles[sym] || [];
                    if (list.length === 0) continue;
                    const article = list.shift();
                    if (!article || !validateArticle(article)) continue;
                    collected.push(formatArticle(article, true, sym, round));
                    if (collected.length >= maxArticles) break;
                }
                if (collected.length >= maxArticles) break;
            }

            if (collected.length > 0) {
                // Sort by datetime desc
                collected.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
                return collected.slice(0, maxArticles);
            }
            // If none collected, fall through to general news
        }

        // General market news fallback or when no symbols provided
        const generalUrl = `${FINNHUB_BASE_URL}/news?category=general&token=${token}`;
        const general = await fetchJSON<RawNewsArticle[]>(generalUrl, 300);

        const seen = new Set<string>();
        const unique: RawNewsArticle[] = [];
        for (const art of general || []) {
            if (!validateArticle(art)) continue;
            const key = `${art.id}-${art.url}-${art.headline}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(art);
            if (unique.length >= 20) break; // cap early before final slicing
        }

        const formatted = unique.slice(0, maxArticles).map((a, idx) => formatArticle(a, false, undefined, idx));
        return formatted;
    } catch (err) {
        // Degrade to an empty news list — a Finnhub outage must not crash the whole page
        console.error('getNews error:', err);
        return [];
    }
}

export const searchStocks = cache(async (query?: string): Promise<StockWithWatchlistStatus[]> => {
    try {
        const token = NEXT_PUBLIC_FINNHUB_API_KEY;
        if (!token) {
            // If no token, log and return empty to avoid throwing per requirements
            console.error('Error in stock search:', new Error('FINNHUB API key is not configured'));
            return [];
        }

        const trimmed = typeof query === 'string' ? query.trim() : '';

        let results: SearchStockCandidate[] = [];

        if (!trimmed) {
            // Fetch top 10 popular symbols' profiles
            const top = POPULAR_STOCK_SYMBOLS.slice(0, 10);
            const profiles = await Promise.all(
                top.map(async (sym) => {
                    try {
                        const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${token}`;
                        // Revalidate every hour
                        const profile = await fetchJSON<FinnhubCompanyProfile>(url, 3600);
                        return { sym, profile } as { sym: string; profile: FinnhubCompanyProfile | null };
                    } catch (e) {
                        console.error('Error fetching profile2 for', sym, e);
                        return { sym, profile: null } as { sym: string; profile: FinnhubCompanyProfile | null };
                    }
                })
            );

            results = profiles
                .map(({ sym, profile }) => {
                    const symbol = sym.toUpperCase();
                    const name: string | undefined = profile?.name || profile?.ticker || undefined;
                    const exchange: string | undefined = profile?.exchange || undefined;
                    if (!name) return undefined;
                    const r: SearchStockCandidate = {
                        symbol,
                        description: name,
                        displaySymbol: symbol,
                        type: 'Common Stock',
                    };
                    r.__exchange = exchange;
                    return r;
                })
                .filter((x): x is SearchStockCandidate => Boolean(x));
        } else {
            const url = `${FINNHUB_BASE_URL}/search?q=${encodeURIComponent(trimmed)}&token=${token}`;
            const data = await fetchJSON<FinnhubSearchResponse>(url, 1800);
            results = Array.isArray(data?.result) ? data.result : [];
        }

        // Finnhub search can return the same symbol multiple times (e.g. across listings); keep the first occurrence
        const seenSymbols = new Set<string>();
        const mapped: StockWithWatchlistStatus[] = results
            .map((r) => {
                const upper = (r.symbol || '').toUpperCase();
                const name = r.description || upper;
                const exchangeFromProfile = r.__exchange;
                const exchange = getExchangeLabel(upper, exchangeFromProfile);
                const type = r.type || 'Stock';
                const item: StockWithWatchlistStatus = {
                    symbol: upper,
                    name,
                    exchange,
                    type,
                    isInWatchlist: false,
                };
                return item;
            })
            .filter((item) => {
                if (!item.symbol || seenSymbols.has(item.symbol)) return false;
                seenSymbols.add(item.symbol);
                return true;
            })
            .slice(0, 15);

        return mapped;
    } catch (err) {
        console.error('Error in stock search:', err);
        return [];
    }
});
