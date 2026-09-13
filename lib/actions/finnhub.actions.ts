'use server';

import { getDateRange, validateArticle, formatArticle } from '@/lib/utils';
import { marketCapToUsdMillions } from '@/lib/market-cap';
import { POPULAR_STOCK_SYMBOLS } from '@/lib/constants';
import { cache } from 'react';
import { readSnapshot, snapshotKey, writeSnapshot } from '@/lib/snapshot';
import { recordSourceCall } from '@/lib/source-calls';
import { finnhubGate, isMemoized, pickWithinBudget, retryAfterMs, throughFinnhubGate } from '@/lib/finnhub-gate';
import { isProfileFresh, readStoredProfiles, resolveProfiles, type StoredCompanyProfile } from '@/lib/company-profiles';
import { inferSourceByHost } from '@/lib/sources-registry';
import { isFetchStale, quoteTtlSeconds } from '@/lib/market-hours';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const NEXT_PUBLIC_FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';

type FinnhubQuote = {
    c?: number;
    d?: number;
    dp?: number;
    // Unix seconds of the last trade
    t?: number;
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
// ledger for the /status page. `revalidateSeconds` is the memo TTL.
//
// The memo is the only cache: Next's data cache (`force-cache` + revalidate)
// is deliberately bypassed. It serves stale-while-revalidate, so the first
// request after a quiet stretch got the previous visit's response — on a
// Saturday morning that was Thursday's close, stamped as freshly fetched and,
// once the memo TTL grew to 30 min off-hours, pinned there for half an hour.
async function fetchJSON<T>(url: string, revalidateSeconds?: number, source?: string): Promise<T> {
    const sourceId = source ?? inferSourceByHost(url) ?? '';
    return throughFinnhubGate<T>(finnhubGate, url, (revalidateSeconds ?? 0) * 1000, async () => {
        const start = Date.now();
        try {
            // Bound every upstream call — a hanging Finnhub connection must not stall SSR
            const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
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
        // Short server-side cache so concurrent renders/polls share one Finnhub
        // call per symbol; stretches to 30 min once after-hours ends
        return await fetchJSON<FinnhubQuote>(url, quoteTtlSeconds());
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

// ---------------------------------------------------------------------------
// Watchlist table rows
// ---------------------------------------------------------------------------

export interface WatchlistRow {
    symbol: string;
    // null (not 0) when no quote has ever arrived, so the UI can keep stale values
    price: number | null;
    change: number | null;
    changePercent: number | null;
    currency: string;
    name: string;
    logo?: string;
    // USD millions, null when unknown
    marketCap: number | null;
    peRatio: number;
    // Unix seconds of the quote's last trade, 0 when unknown
    quoteTime?: number;
    // Epoch ms when the quote was last fetched from Finnhub; absent on rows
    // written before the budgeted sweep existed (treated as never fetched)
    fetchedAt?: number;
}

function quoteUrl(symbol: string): string {
    return `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${NEXT_PUBLIC_FINNHUB_API_KEY}`;
}

function profileUrl(symbol: string): string {
    return `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${NEXT_PUBLIC_FINNHUB_API_KEY}`;
}

// Serve the last-known table rows instantly at SSR; the table's mount refresh
// fetches live data and writes the snapshot back. Falls back to a live fetch
// on the very first visit (no snapshot yet).
export async function getWatchlistDataCached(symbols: string[]): Promise<WatchlistRow[]> {
    if (!symbols || symbols.length === 0) return [];
    const snapshot = await readSnapshot<WatchlistRow[]>(snapshotKey('watchlist', symbols));
    if (snapshot) return snapshot.data;
    return getWatchlistData(symbols);
}

// Full rows: quotes plus profiles (name / logo / market cap)
export async function getWatchlistData(symbols: string[]): Promise<WatchlistRow[]> {
    return refreshWatchlistRows(symbols, true);
}

// Variant for the client's 30s poll: never spends Finnhub budget on profiles
// (name / logo / market cap barely change); they come from Mongo or the snapshot
export async function getWatchlistQuotes(symbols: string[]): Promise<WatchlistRow[]> {
    return refreshWatchlistRows(symbols, false);
}

// Upstream calls fetching this symbol would make right now: memo hits and
// profiles already fresh in Mongo are free
function watchlistCallsFor(symbol: string, withProfiles: boolean, stored: Map<string, StoredCompanyProfile>): number {
    const quote = isMemoized(quoteUrl(symbol)) ? 0 : 1;
    if (!withProfiles) return quote;
    const known = stored.get(symbol);
    const profile = (known && isProfileFresh(known)) || isMemoized(profileUrl(symbol)) ? 0 : 1;
    return quote + profile;
}

// The watchlist used to fan out quote + profile (+ news, see getNews) per
// symbol on every load, and 17 symbols alone blew through the gate's 50/min
// on a cold page: the overflow failed, those rows painted empty, and the same
// tail of the list was rejected on every poll. Same recipe as the heatmap now:
// fetch only what fits the free budget, stalest quote first, and keep the
// snapshot's values for the rest so the next poll rotates on to them.
async function refreshWatchlistRows(symbols: string[], withProfiles: boolean): Promise<WatchlistRow[]> {
    if (!symbols || symbols.length === 0) return [];

    const key = snapshotKey('watchlist', symbols);
    const [snapshot, stored] = await Promise.all([
        readSnapshot<WatchlistRow[]>(key),
        readStoredProfiles(symbols),
    ]);
    const previous = new Map((snapshot?.data ?? []).map((r) => [r.symbol, r]));

    // A row that never got a price, or whose quote is two sessions behind,
    // counts as never fetched so it goes to the front of the queue
    const lastFetched = (symbol: string): number => {
        const row = previous.get(symbol);
        if (!row || row.price === null) return 0;
        return isFetchStale(row.fetchedAt, row.quoteTime) ? 0 : row.fetchedAt ?? 0;
    };
    const stalestFirst = [...symbols].sort((a, b) => lastFetched(a) - lastFetched(b));
    const picked = pickWithinBudget(
        stalestFirst,
        (symbol) => watchlistCallsFor(symbol, withProfiles, stored),
        finnhubGate.freeSlots,
    );

    // Profiles: Mongo when fresh, Finnhub otherwise (persisted for next time),
    // stale Mongo row when Finnhub refuses. Runs alongside the quote fan-out.
    const profilesPromise = withProfiles
        ? resolveProfiles(picked, (symbol) => fetchJSON<FinnhubCompanyProfile>(profileUrl(symbol), 86400), stored)
        : Promise.resolve(new Map<string, StoredCompanyProfile>());
    const quotes = new Map<string, FinnhubQuote>();
    await Promise.all(
        picked.map(async (symbol) => {
            try {
                const quote = await fetchJSON<FinnhubQuote>(quoteUrl(symbol), quoteTtlSeconds());
                if (quote?.c) quotes.set(symbol, quote);
            } catch (e) {
                console.error('Error fetching quote for', symbol, e);
            }
        }),
    );
    const profiles = await profilesPromise;
    const fetchedAt = Date.now();

    const rows = await Promise.all(
        symbols.map(async (symbol): Promise<WatchlistRow> => {
            const old = previous.get(symbol);
            const quote = quotes.get(symbol);
            // A stale stored profile still beats the snapshot's copy of it
            const profile = profiles.get(symbol) ?? stored.get(symbol);
            // Normalized to USD millions — Finnhub reports in the primary listing's currency
            const marketCap = profile?.marketCapitalization
                ? await marketCapToUsdMillions(profile.marketCapitalization, profile.currency)
                : old?.marketCap ?? null;
            return {
                symbol,
                price: quote ? quote.c! : old?.price ?? null,
                change: quote ? quote.d ?? null : old?.change ?? null,
                changePercent: quote ? quote.dp ?? null : old?.changePercent ?? null,
                currency: profile?.currency || old?.currency || 'USD',
                name: profile?.name || old?.name || symbol,
                logo: profile?.logo || old?.logo,
                marketCap,
                // Finnhub 'quote' and 'profile2' don't give PE; the 'metric' endpoint would cost another call per symbol
                peRatio: 0,
                quoteTime: quote ? quote.t ?? 0 : old?.quoteTime ?? 0,
                fetchedAt: quote ? fetchedAt : old?.fetchedAt,
            };
        }),
    );

    if (quotes.size > 0) void writeSnapshot(key, rows);
    return rows;
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

const NEWS_MEMO_S = 300;
// A cold watchlist used to fan out one company-news call per symbol on top of
// the quotes. Per-symbol news now lives in a snapshot: each render refreshes at
// most this many symbols (stalest first, within the gate's free budget) and
// serves the rest from the snapshot, so the grid fills in over a couple of
// visits instead of eating the budget the quotes need.
const NEWS_CALLS_PER_RENDER = 8;
const NEWS_KEPT_PER_SYMBOL = 10;

type NewsSnapshot = Record<string, { fetchedAt: number; articles: RawNewsArticle[] }>;

function companyNewsUrl(symbol: string, range: { from: string; to: string }, token: string): string {
    return `${FINNHUB_BASE_URL}/company-news?symbol=${encodeURIComponent(symbol)}&from=${range.from}&to=${range.to}&token=${token}`;
}

// Validated articles per symbol, newest first: live for the symbols refreshed
// this render, the snapshot's copy for the others
async function companyNewsBySymbol(
    symbols: string[],
    range: { from: string; to: string },
    token: string,
): Promise<Record<string, RawNewsArticle[]>> {
    const key = snapshotKey('news', symbols);
    const previous = (await readSnapshot<NewsSnapshot>(key))?.data ?? {};
    const now = Date.now();
    const url = (symbol: string) => companyNewsUrl(symbol, range, token);
    const age = (symbol: string) => now - (previous[symbol]?.fetchedAt ?? 0);

    // A snapshot entry younger than the memo TTL is as good as a memo hit;
    // skip it so a process restart does not buy the same news again
    const candidates = symbols
        .filter((symbol) => isMemoized(url(symbol)) || age(symbol) >= NEWS_MEMO_S * 1000)
        .sort((a, b) => age(b) - age(a));
    const picked = pickWithinBudget(
        candidates,
        (symbol) => (isMemoized(url(symbol)) ? 0 : 1),
        Math.min(NEWS_CALLS_PER_RENDER, finnhubGate.freeSlots),
    );

    const next: NewsSnapshot = { ...previous };
    let refreshed = 0;
    await Promise.all(
        picked.map(async (symbol) => {
            try {
                const articles = await fetchJSON<RawNewsArticle[]>(url(symbol), NEWS_MEMO_S);
                const kept = (articles || [])
                    .filter(validateArticle)
                    .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
                    .slice(0, NEWS_KEPT_PER_SYMBOL);
                next[symbol] = { fetchedAt: now, articles: kept };
                refreshed++;
            } catch (e) {
                console.error('Error fetching company news for', symbol, e);
            }
        }),
    );
    if (refreshed > 0) void writeSnapshot(key, next);

    // Snapshot entries can be older than the query window; drop what fell out of it
    const cutoff = Date.parse(range.from) / 1000;
    return Object.fromEntries(
        symbols.map((symbol) => [symbol, (next[symbol]?.articles ?? []).filter((a) => (a.datetime ?? 0) >= cutoff)]),
    );
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
            const perSymbolArticles = await companyNewsBySymbol(cleanSymbols, range, token);

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
        const general = await fetchJSON<RawNewsArticle[]>(generalUrl, NEWS_MEMO_S);

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
