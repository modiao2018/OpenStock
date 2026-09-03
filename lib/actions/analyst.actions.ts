'use server';

/**
 * Analyst ratings, price targets, estimates and institutional ownership.
 *
 * Primary: Yahoo Finance quoteSummary (Refinitiv / LSEG-sourced consensus, per-firm
 *          upgrade/downgrade history, forward EPS & revenue estimates, top holders).
 * Cross-check: Nasdaq analyst consensus (Zacks-sourced targets).
 * Secondary: Finnhub recommendation trend (free tier) and earnings surprises.
 *
 * Yahoo requires a session cookie + crumb; both are cached in-process and refreshed
 * when a request comes back 401/403. Everything degrades to null/empty on failure so
 * the stock page still renders.
 */

import { fetchJson, fetchWithTimeout } from './http.helpers';
import { fetchJSON as fetchFinnhubJSON } from './finnhub.actions';
import {
    consensusLabel,
    normalizeFinnhubRecommendations,
    normalizeFinnhubSurprises,
    normalizeNasdaqTargets,
    normalizeYahooEstimates,
    normalizeYahooHolders,
    normalizeYahooNextEarnings,
    normalizeYahooOwnership,
    normalizeYahooRatingChanges,
    normalizeYahooRatingTrend,
    normalizeYahooTargets,
    type AnalystResearch,
    type FinnhubEarningsRow,
    type FinnhubRecommendationRow,
    type NasdaqTargetPayload,
    type YahooQuoteSummary,
} from './analyst.helpers';

const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const YAHOO_MODULES = [
    'financialData',
    'recommendationTrend',
    'upgradeDowngradeHistory',
    'earningsTrend',
    'institutionOwnership',
    'majorHoldersBreakdown',
    'calendarEvents',
].join(',');
const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';

// ---------------------------------------------------------------------------
// Yahoo session handling
// ---------------------------------------------------------------------------

type YahooSession = { cookie: string; crumb: string; obtainedAt: number };
let yahooSession: YahooSession | null = null;
let yahooSessionPromise: Promise<YahooSession | null> | null = null;
const YAHOO_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

async function obtainYahooSession(): Promise<YahooSession | null> {
    try {
        const seed = await fetchWithTimeout('https://fc.yahoo.com', { headers: { 'User-Agent': BROWSER_UA }, timeoutMs: 8000 });
        const setCookies: string[] =
            typeof (seed.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
                ? (seed.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
                : [seed.headers.get('set-cookie') ?? ''];
        const cookie = setCookies
            .filter(Boolean)
            .map((c) => c.split(';')[0])
            .join('; ');
        if (!cookie) return null;

        const crumbRes = await fetchWithTimeout('https://query2.finance.yahoo.com/v1/test/getcrumb', {
            headers: { 'User-Agent': BROWSER_UA, Cookie: cookie },
            timeoutMs: 8000,
        });
        const crumb = (await crumbRes.text()).trim();
        if (!crumbRes.ok || !crumb || crumb.includes('<')) return null;
        return { cookie, crumb, obtainedAt: Date.now() };
    } catch (error) {
        console.error('Yahoo session bootstrap failed', error);
        return null;
    }
}

async function getYahooSession(force: boolean = false): Promise<YahooSession | null> {
    if (!force && yahooSession && Date.now() - yahooSession.obtainedAt < YAHOO_SESSION_TTL_MS) {
        return yahooSession;
    }
    if (!yahooSessionPromise) {
        yahooSessionPromise = obtainYahooSession().finally(() => {
            yahooSessionPromise = null;
        });
    }
    const session = await yahooSessionPromise;
    if (session) yahooSession = session;
    return session;
}

async function fetchYahooSummary(symbol: string, retry: boolean = true): Promise<YahooQuoteSummary | null> {
    const session = await getYahooSession();
    if (!session) return null;

    const url =
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
        `?modules=${YAHOO_MODULES}&crumb=${encodeURIComponent(session.crumb)}`;

    try {
        const res = await fetchWithTimeout(url, {
            headers: { 'User-Agent': BROWSER_UA, Cookie: session.cookie, Accept: 'application/json' },
            timeoutMs: 8000,
            revalidate: 1800,
        });
        if ((res.status === 401 || res.status === 403) && retry) {
            await getYahooSession(true);
            return fetchYahooSummary(symbol, false);
        }
        if (res.status === 404) return null;
        if (!res.ok) {
            console.error(`Yahoo quoteSummary ${symbol} failed: ${res.status}`);
            return null;
        }
        const payload = (await res.json()) as { quoteSummary?: { result?: YahooQuoteSummary[]; error?: unknown } };
        return payload.quoteSummary?.result?.[0] ?? null;
    } catch (error) {
        console.error('Yahoo quoteSummary request failed for', symbol, error);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Nasdaq
// ---------------------------------------------------------------------------

async function fetchNasdaqTargets(symbol: string): Promise<NasdaqTargetPayload | null> {
    try {
        return await fetchJson<NasdaqTargetPayload>(
            `https://api.nasdaq.com/api/analyst/${encodeURIComponent(symbol.toLowerCase())}/targetprice`,
            {
                headers: {
                    'User-Agent': BROWSER_UA,
                    Accept: 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    Origin: 'https://www.nasdaq.com',
                    Referer: 'https://www.nasdaq.com/',
                },
                timeoutMs: 8000,
                revalidate: 3600,
            },
        );
    } catch (error) {
        console.error('Nasdaq target price request failed for', symbol, error);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Finnhub (free tier endpoints only)
// ---------------------------------------------------------------------------

function finnhubToken(): string {
    return process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';
}

async function fetchFinnhubRecommendations(symbol: string): Promise<FinnhubRecommendationRow[]> {
    const token = finnhubToken();
    if (!token) return [];
    try {
        const rows = await fetchFinnhubJSON<FinnhubRecommendationRow[] | { error?: string }>(
            `${FINNHUB_BASE_URL}/stock/recommendation?symbol=${encodeURIComponent(symbol)}&token=${token}`,
            21_600,
        );
        return Array.isArray(rows) ? rows : [];
    } catch (error) {
        console.error('Finnhub recommendation request failed for', symbol, error);
        return [];
    }
}

async function fetchFinnhubEarnings(symbol: string): Promise<FinnhubEarningsRow[]> {
    const token = finnhubToken();
    if (!token) return [];
    try {
        const rows = await fetchFinnhubJSON<FinnhubEarningsRow[] | { error?: string }>(
            `${FINNHUB_BASE_URL}/stock/earnings?symbol=${encodeURIComponent(symbol)}&token=${token}`,
            21_600,
        );
        return Array.isArray(rows) ? rows : [];
    } catch (error) {
        console.error('Finnhub earnings request failed for', symbol, error);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getAnalystResearch(symbol: string): Promise<AnalystResearch | null> {
    const ticker = symbol?.trim().toUpperCase();
    if (!ticker) return null;

    const [yahoo, nasdaq, finnhubRecs, finnhubEarnings] = await Promise.all([
        fetchYahooSummary(ticker),
        fetchNasdaqTargets(ticker),
        fetchFinnhubRecommendations(ticker),
        fetchFinnhubEarnings(ticker),
    ]);

    const sources: string[] = [];
    const targets: AnalystResearch['targets'] = [];

    const yahooTargets = yahoo ? normalizeYahooTargets(yahoo) : null;
    if (yahooTargets) targets.push(yahooTargets);
    const nasdaqTargets = nasdaq ? normalizeNasdaqTargets(nasdaq, yahooTargets?.currentPrice ?? null) : null;
    if (nasdaqTargets) targets.push(nasdaqTargets);

    const yahooTrend = yahoo ? normalizeYahooRatingTrend(yahoo) : [];
    const ratingTrend = yahooTrend.length > 0 ? yahooTrend : normalizeFinnhubRecommendations(finnhubRecs);

    if (yahoo) sources.push('Yahoo Finance');
    if (nasdaqTargets) sources.push('Nasdaq');
    if (finnhubRecs.length > 0 || finnhubEarnings.length > 0) sources.push('Finnhub');

    if (targets.length === 0 && ratingTrend.length === 0 && finnhubEarnings.length === 0) {
        return null;
    }

    return {
        symbol: ticker,
        fetchedAt: new Date().toISOString(),
        targets,
        ratingTrend,
        ratingChanges: yahoo ? normalizeYahooRatingChanges(yahoo) : [],
        estimates: yahoo ? normalizeYahooEstimates(yahoo) : [],
        surprises: normalizeFinnhubSurprises(finnhubEarnings),
        topHolders: yahoo ? normalizeYahooHolders(yahoo) : [],
        ownership: yahoo ? normalizeYahooOwnership(yahoo) : null,
        nextEarningsDate: yahoo ? normalizeYahooNextEarnings(yahoo) : null,
        sources,
    };
}

/** Convenience for list views: a single consensus word plus mean target. */
export async function getAnalystConsensusSummary(symbol: string): Promise<{ consensus: string; meanTarget: number | null; upsidePct: number | null } | null> {
    const research = await getAnalystResearch(symbol);
    if (!research) return null;
    const primary = research.targets[0] ?? null;
    return {
        consensus: consensusLabel(research.ratingTrend[0]),
        meanTarget: primary?.mean ?? null,
        upsidePct: primary?.upsidePct ?? null,
    };
}
