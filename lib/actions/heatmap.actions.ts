'use server';

import { fetchJSON } from '@/lib/actions/finnhub.actions';
import {
    isProfileFresh,
    readStoredProfiles,
    resolveProfiles,
    type RawCompanyProfile,
    type StoredCompanyProfile,
} from '@/lib/company-profiles';
import { DEFAULT_DASHBOARD_SYMBOLS } from '@/lib/dashboard-catalog';
import { finnhubGate, isMemoized, pickWithinBudget } from '@/lib/finnhub-gate';
import {
    buildHeatmapTile,
    mergeHeatmapTiles,
    normalizeHeatmapSymbols,
    type FinnhubQuote,
    type HeatmapStock,
} from '@/lib/heatmap-tile';
import { marketCapToUsdMillions } from '@/lib/market-cap';
import { isFetchStale, quoteTtlSeconds } from '@/lib/market-hours';
import { readSnapshot, snapshotKey, writeSnapshot } from '@/lib/snapshot';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const NEXT_PUBLIC_FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';

// A cold load costs one quote per symbol (profiles come from Mongo once seen,
// see lib/company-profiles.ts); getHeatmapData falls back to the snapshot when
// a sweep would not fit the gate's free budget. The default list is the
// dashboard catalog's default selection so anonymous visitors, users without
// a saved dashboard and the monitor's sweep all key the same snapshot.
const HEATMAP_SYMBOLS = DEFAULT_DASHBOARD_SYMBOLS;

type Profiles = Map<string, StoredCompanyProfile>;

// Tile shape lives in lib/heatmap-tile.ts (shared with the monitor's sweep);
// a 'use server' file may only export async functions, so import it from there

function normalizeSymbols(symbols?: string[]): string[] {
    return normalizeHeatmapSymbols(symbols, HEATMAP_SYMBOLS);
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
// Outside the extended session quotes cannot move, so the window stretches to
// the closed-hours quote TTL — unless a tile still predates the last close.
const SNAPSHOT_FRESH_MS = 45_000;

function snapshotIsFresh(data: HeatmapStock[], updatedAt: Date): boolean {
    const age = Date.now() - updatedAt.getTime();
    const window = Math.max(SNAPSHOT_FRESH_MS, quoteTtlSeconds() * 1000);
    return age < window && !data.some((s) => isFetchStale(s.fetchedAt, s.quoteTime));
}

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

// Symbols whose combined upstream calls fit `budget`, stalest tile first.
// The gate rejects whatever overflows, and it used to reject the same tail
// of the list every poll: those tiles sat on the previous day's close for
// hours while the head of the list refreshed every minute.
function withinBudget(
    list: string[],
    token: string,
    stored: Profiles,
    budget: number,
    previous: HeatmapStock[] | null,
): string[] {
    // A tile whose quote is two sessions behind is treated as never fetched
    const fetchedAt = new Map(
        (previous ?? []).map((s) => [s.symbol, isFetchStale(s.fetchedAt, s.quoteTime) ? 0 : s.fetchedAt ?? 0]),
    );
    const stalestFirst = [...list].sort((a, b) => (fetchedAt.get(a) ?? 0) - (fetchedAt.get(b) ?? 0));
    return pickWithinBudget(stalestFirst, (symbol) => callsFor(symbol, token, stored), budget);
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
            const data = mergeHeatmapTiles(list, previous, fresh);
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
    if (previous && snapshotIsFresh(previous, new Date(snapshot!.updatedAt))) {
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

    // Over budget: fetch only what fits, stalest tiles first, and merge over
    // the snapshot. Nothing queues behind the gate, so this answers in one
    // round trip; the next poll rotates to the tiles left out this time.
    const partial = withinBudget(list, token, stored, budget, previous);
    if (partial.length === 0) return previous ?? [];
    return sweep(key, list, token, stored, previous, partial);
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
                // 60s in session (dedupes concurrent renders and client polls
                // without serving a visit the previous visit's data); 30 min
                // once after-hours ends, when the quote cannot move anyway
                return await fetchJSON<FinnhubQuote>(quoteUrl(symbol, token), quoteTtlSeconds());
            } catch (e) {
                console.error('Heatmap fetch failed for', symbol, e);
                return null;
            }
        }),
    );
    const profiles = await profilesPromise;

    const fetchedAt = Date.now();
    const results = await Promise.all(
        list.map(async (symbol, i): Promise<HeatmapStock | null> => {
            const quote = quotes[i];
            const profile = profiles.get(symbol);
            if (!quote || !profile) return null;

            const marketCapMillions = await marketCapToUsdMillions(profile.marketCapitalization, profile.currency);
            return buildHeatmapTile(symbol, quote, profile, marketCapMillions, fetchedAt);
        }),
    );

    return results.filter((s): s is HeatmapStock => s !== null);
}
