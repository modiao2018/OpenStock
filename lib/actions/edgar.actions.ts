'use server';

/**
 * SEC EDGAR data for the stock detail page: insider transactions (Form 4),
 * reported fundamentals (XBRL company facts) and recent material filings.
 *
 * Why EDGAR instead of a vendor: Form 4 filings hit EDGAR the moment they are
 * accepted, while Finnhub was observed lagging by days and silently dropping
 * filings. Shared plumbing (headers, URLs, parsers) lives in lib/edgar.ts and is
 * the same code the catalyst-monitor daemon uses, so the site and the alerts
 * can never disagree about what a filing says.
 */

import { fetchJson, fetchText, mapWithConcurrency, memoize } from './http.helpers';
import {
    CIK_MAP_URL,
    buildFundamentalsSnapshot,
    companyFactsUrl,
    edgarHeaders,
    filingDocUrl,
    filingIndexUrl,
    normalizeTicker,
    parseCikMap,
    parseForm4Xml,
    submissionsUrl,
    summarizeInsiderActivity,
    type CompanyFactsPayload,
    type CompanyTickersPayload,
    type FundamentalsSnapshot,
    type InsiderActivitySummary,
    type InsiderTransaction,
} from '@/lib/edgar';

const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_FILINGS_PER_SYMBOL = 40;
/** SEC fair-access policy allows 10 req/s; keep well under it. */
const FORM4_CONCURRENCY = 4;

type SubmissionsPayload = {
    cik: string;
    name: string;
    filings: {
        recent: {
            accessionNumber: string[];
            filingDate: string[];
            reportDate: string[];
            form: string[];
            primaryDocument: string[];
            primaryDocDescription: string[];
        };
    };
};

export interface EdgarFilingRef {
    form: string;
    filingDate: string;
    reportDate: string;
    accessionNumber: string;
    primaryDocument: string;
    description: string;
    url: string;
}

/** Ticker -> unpadded CIK map, refreshed daily. Same file the daemon caches in Mongo. */
async function getCikMap(): Promise<Record<string, string>> {
    return memoize('edgar:cik-map', 24 * 60 * 60 * 1000, async () => {
        const payload = await fetchJson<CompanyTickersPayload>(CIK_MAP_URL, {
            headers: edgarHeaders(),
            timeoutMs: 15_000,
        });
        return parseCikMap(payload);
    });
}

/** Resolve a ticker to its CIK (unpadded), or null if unknown to the SEC. */
export async function getCikForSymbol(symbol: string): Promise<string | null> {
    const ticker = normalizeTicker(symbol);
    if (!ticker) return null;
    try {
        const map = await getCikMap();
        return map[ticker] ?? map[ticker.replace(/-/g, '.')] ?? null;
    } catch (error) {
        console.error('EDGAR ticker lookup failed for', symbol, error);
        return null;
    }
}

async function getSubmissions(cik: string): Promise<SubmissionsPayload | null> {
    try {
        return await fetchJson<SubmissionsPayload>(submissionsUrl(cik), { headers: edgarHeaders(), revalidate: 900 });
    } catch (error) {
        console.error('EDGAR submissions fetch failed for CIK', cik, error);
        return null;
    }
}

/** Recent filings of the given form types (e.g. ['4', '4/A'] or ['8-K']) newest first. */
export async function getRecentFilings(
    symbol: string,
    forms: string[],
    sinceDate?: string,
    limit: number = MAX_FILINGS_PER_SYMBOL,
): Promise<EdgarFilingRef[]> {
    const cik = await getCikForSymbol(symbol);
    if (!cik) return [];
    const submissions = await getSubmissions(cik);
    if (!submissions) return [];

    const wanted = new Set(forms.map((f) => f.toUpperCase()));
    const { recent } = submissions.filings;
    const refs: EdgarFilingRef[] = [];

    for (let i = 0; i < recent.form.length; i++) {
        const form = recent.form[i]?.toUpperCase();
        if (!wanted.has(form)) continue;
        const filingDate = recent.filingDate[i];
        if (sinceDate && filingDate < sinceDate) continue;
        refs.push({
            form,
            filingDate,
            reportDate: recent.reportDate[i],
            accessionNumber: recent.accessionNumber[i],
            primaryDocument: recent.primaryDocument[i],
            description: recent.primaryDocDescription[i] ?? form,
            url: filingDocUrl(cik, recent.accessionNumber[i], recent.primaryDocument[i]),
        });
        if (refs.length >= limit) break;
    }

    return refs.sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));
}

function isoDaysAgo(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

/**
 * All insider transactions for a symbol from Form 4 filings within the lookback window.
 * Returns an empty array (never throws) when the symbol is unknown or EDGAR is unreachable.
 */
export async function getInsiderTransactions(
    symbol: string,
    lookbackDays: number = DEFAULT_LOOKBACK_DAYS,
): Promise<InsiderTransaction[]> {
    const ticker = normalizeTicker(symbol);
    const cik = await getCikForSymbol(ticker);
    if (!cik) return [];
    const filings = await getRecentFilings(ticker, ['4', '4/A'], isoDaysAgo(lookbackDays));
    if (filings.length === 0) return [];

    const perFiling = await mapWithConcurrency(filings, FORM4_CONCURRENCY, async (filing) => {
        try {
            // Filings are immutable, cache for a week.
            const xml = await fetchText(filing.url, { headers: edgarHeaders(), revalidate: 604_800 });
            return parseForm4Xml(xml, {
                symbol: ticker,
                filingDate: filing.filingDate,
                accessionNumber: filing.accessionNumber,
                filingUrl: filingIndexUrl(cik, filing.accessionNumber),
            });
        } catch (error) {
            console.error('EDGAR Form 4 fetch failed', filing.url, error);
            return [];
        }
    });

    return perFiling
        .flat()
        .sort((a, b) => (a.filingDate < b.filingDate ? 1 : a.filingDate > b.filingDate ? -1 : a.transactionDate < b.transactionDate ? 1 : -1));
}

export interface InsiderActivity {
    summary: InsiderActivitySummary;
    transactions: InsiderTransaction[];
}

export async function getInsiderActivity(
    symbol: string,
    lookbackDays: number = DEFAULT_LOOKBACK_DAYS,
): Promise<InsiderActivity | null> {
    const ticker = normalizeTicker(symbol);
    if (!ticker) return null;
    // Unknown to the SEC (foreign listing, index, typo): no card rather than an empty one.
    if (!(await getCikForSymbol(ticker))) return null;
    const transactions = await getInsiderTransactions(ticker, lookbackDays);
    return {
        summary: summarizeInsiderActivity(ticker, transactions, lookbackDays),
        transactions,
    };
}

/** Reported fundamentals straight from XBRL-tagged 10-Q / 10-K filings. */
export async function getFundamentals(symbol: string): Promise<FundamentalsSnapshot | null> {
    const ticker = normalizeTicker(symbol);
    const cik = await getCikForSymbol(ticker);
    if (!cik) return null;
    // The raw companyfacts payload is 3-6MB, above the Next.js data-cache limit, so we
    // fetch it uncached and memoize the small derived snapshot in-process instead.
    return memoize(`edgar:fundamentals:${cik}`, 6 * 60 * 60 * 1000, async () => {
        try {
            const payload = await fetchJson<CompanyFactsPayload>(companyFactsUrl(cik), {
                headers: edgarHeaders(),
                timeoutMs: 20_000,
            });
            return buildFundamentalsSnapshot(ticker, payload);
        } catch (error) {
            console.error('EDGAR company facts fetch failed for', ticker, error);
            return null;
        }
    });
}

/** Material-event (8-K) and periodic (10-Q/10-K) filings, newest first. */
export async function getMaterialFilings(symbol: string, limit: number = 10): Promise<EdgarFilingRef[]> {
    const cik = await getCikForSymbol(symbol);
    if (!cik) return [];
    const refs = await getRecentFilings(symbol, ['8-K', '8-K/A', '10-Q', '10-K', '10-K/A', 'SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A'], undefined, limit);
    return refs.map((ref) => ({ ...ref, url: filingIndexUrl(cik, ref.accessionNumber) }));
}
