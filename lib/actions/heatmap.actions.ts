'use server';

import { fetchJSON } from '@/lib/actions/finnhub.actions';
import {
    isProfileFresh,
    readStoredProfiles,
    resolveProfiles,
    type RawCompanyProfile,
    type StoredCompanyProfile,
} from '@/lib/company-profiles';
import { finnhubGate, isMemoized } from '@/lib/finnhub-gate';
import { marketCapToUsdMillions } from '@/lib/market-cap';
import { readSnapshot, snapshotKey, writeSnapshot } from '@/lib/snapshot';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const NEXT_PUBLIC_FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';

// A cold load costs one quote per symbol (profiles come from Mongo once seen,
// see lib/company-profiles.ts); getHeatmapData falls back to the snapshot when
// a sweep would not fit the gate's free budget
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
type Profiles = Map<string, StoredCompanyProfile>;

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

// Every viewer's 60s poll used to fan out quote+profile per symbol; with two
// dashboards open that alone exceeded Finnhub's 60/min. A snapshot younger
// than this is served as-is, so N viewers cost one upstream sweep per minute.
const SNAPSHOT_FRESH_MS = 45_000;

function quoteUrl(symbol: string, token: string): string {
    return `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`;
}

function profileUrl(symbol: string, token: string): string {
    return `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`;
}

// Upstream calls fetching this symbol would make right now: memo hits and
// profiles already fresh in Mongo are free
function callsFor(symbol: string, token: string, stored: Profiles): number {
    const quote = isMemoized(quoteUrl(symbol, token)) ? 0 : 1;
    const known = stored.get(symbol);
    const profile = (known && isProfileFresh(known)) || isMemoized(profileUrl(symbol, token)) ? 0 : 1;
    return quote + profile;
}

function upstreamCallsNeeded(list: string[], token: string, stored: Profiles): number {
    return list.reduce((n, symbol) => n + callsFor(symbol, token, stored), 0);
}

// Leading symbols (dashboard order) whose combined upstream calls fit `budget`
function withinBudget(list: string[], token: string, stored: Profiles, budget: number): string[] {
    const out: string[] = [];
    let used = 0;
    for (const symbol of list) {
        const cost = callsFor(symbol, token, stored);
        if (used + cost > budget) break;
        used += cost;
        out.push(symbol);
    }
    return out;
}

// One live sweep per symbol set at a time: concurrent viewers (and a foreground
// call racing a background refresh) share the same Promise
const inflightSweeps = new Map<string, Promise<HeatmapStock[]>>();

// Fetches `fetchList` live and merges the result over `previous`, so a symbol
// the gate rejected keeps its last-known tile instead of vanishing from the
// heatmap until the next poll. Every sweep that yields anything refreshes the
// snapshot so the next SSR / poll is served instantly.
function sweep(
    key: string,
    list: string[],
    token: string,
    stored: Profiles,
    previous: HeatmapStock[] | null,
    fetchList: string[] = list,
): Promise<HeatmapStock[]> {
    const pending = inflightSweeps.get(key);
    if (pending) return pending;
    const run = fetchLive(fetchList, token, stored)
        .then((fresh) => {
            const bySymbol = new Map((previous ?? []).map((s) => [s.symbol, s]));
            for (const s of fresh) bySymbol.set(s.symbol, s);
            const data = list
                .map((symbol) => bySymbol.get(symbol))
                .filter((s): s is HeatmapStock => s !== undefined)
                .sort((a, b) => b.marketCap - a.marketCap);
            if (fresh.length > 0) void writeSnapshot(key, data);
            return data;
        })
        .finally(() => inflightSweeps.delete(key));
    inflightSweeps.set(key, run);
    return run;
}

export async function getHeatmapData(symbols?: string[]): Promise<HeatmapStock[]> {
    const token = NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!token) return [];

    const list = normalizeSymbols(symbols);

    const key = snapshotKey('heatmap', list);
    const snapshot = await readSnapshot<HeatmapStock[]>(key);
    const previous = snapshot && snapshot.data.length > 0 ? snapshot.data : null;
    if (previous && Date.now() - new Date(snapshot!.updatedAt).getTime() < SNAPSHOT_FRESH_MS) {
        return previous;
    }

    // Before profiles were persisted, a 35-symbol dashboard on a cold process
    // needed 70 upstream calls against a 50/min gate: the overflow either
    // queued (up to 20s) or failed, and Promise.all made the whole heatmap
    // wait for the slowest one. Profiles now cost nothing once stored, and a
    // sweep that still would not fit the free budget degrades instead of waiting.
    const stored = await readStoredProfiles(list);
    const needed = upstreamCallsNeeded(list, token, stored);
    const budget = finnhubGate.freeSlots;
    if (needed <= budget) return sweep(key, list, token, stored, previous);

    // Over budget with a snapshot: hand the snapshot back right away and let
    // the sweep run in the background; the client's 60s poll picks it up.
    if (previous) {
        void sweep(key, list, token, stored, previous).catch((e) => console.error('Heatmap background sweep failed', e));
        return previous;
    }

    // Over budget on the very first visit for this symbol set: paint whatever
    // fits the budget now instead of holding the whole heatmap behind the
    // gate's queue. The poll fetches the rest once the window has slid.
    const partial = withinBudget(list, token, stored, budget);
    if (partial.length === 0) return [];
    return sweep(key, list, token, stored, null, partial);
}

async function fetchLive(list: string[], token: string, stored: Profiles): Promise<HeatmapStock[]> {
    // Profiles: Mongo when fresh, Finnhub otherwise (persisted for next time),
    // stale Mongo row when Finnhub refuses. Runs alongside the quote fan-out.
    const profilesPromise = resolveProfiles(
        list,
        (symbol) => fetchJSON<RawCompanyProfile>(profileUrl(symbol, token), 86400),
        stored,
    );

    const quotes = await Promise.all(
        list.map(async (symbol) => {
            try {
                // Short cache: Next serves stale-while-revalidate, so a longer
                // TTL means infrequent visits keep seeing the previous visit's
                // data. 60s still dedupes concurrent renders and client polls.
                return await fetchJSON<Quote>(quoteUrl(symbol, token), 60);
            } catch (e) {
                console.error('Heatmap fetch failed for', symbol, e);
                return null;
            }
        }),
    );
    const profiles = await profilesPromise;

    const results = await Promise.all(
        list.map(async (symbol, i) => {
            const quote = quotes[i];
            const profile = profiles.get(symbol);
            if (!quote || !profile) return null;

            const price = quote.c ?? 0;
            const marketCapMillions = await marketCapToUsdMillions(profile.marketCapitalization, profile.currency);
            // Delisted/renamed tickers come back with zeroed data — drop them
            if (price <= 0 || marketCapMillions <= 0) return null;

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
                marketCap: marketCapMillions * 1e6,
                industry: profile.finnhubIndustry,
                quoteTime: quote.t ?? 0,
            } satisfies HeatmapStock;
        }),
    );

    return results.filter((s): s is HeatmapStock => s !== null);
}
