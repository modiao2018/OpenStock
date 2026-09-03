'use server';

/**
 * SEC EDGAR data source.
 *
 * Why EDGAR instead of a vendor: Form 4 insider filings hit EDGAR the moment they
 * are accepted, and we have observed Finnhub both lagging by days and silently
 * dropping filings entirely. EDGAR is the primary record, it is free, and the
 * only requirement is a descriptive User-Agent header.
 *
 * Endpoints used:
 *   https://www.sec.gov/files/company_tickers.json          ticker -> CIK (ticker.txt as fallback)
 *   https://data.sec.gov/submissions/CIK##########.json    recent filings index
 *   https://www.sec.gov/Archives/edgar/data/...            raw Form 4 XML
 *   https://data.sec.gov/api/xbrl/companyfacts/CIK...json  XBRL fundamentals
 */

import { fetchJson, fetchText, mapWithConcurrency, memoize } from './http.helpers';
import {
    buildFundamentalsSnapshot,
    parseForm4Xml,
    summarizeInsiderActivity,
    type CompanyFactsPayload,
    type FundamentalsSnapshot,
    type InsiderActivitySummary,
    type InsiderTransaction,
} from './edgar.helpers';

const SEC_WWW = 'https://www.sec.gov';
const SEC_DATA = 'https://data.sec.gov';
const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_FILINGS_PER_SYMBOL = 40;
/** SEC fair-access policy allows 10 req/s; keep well under it. */
const FORM4_CONCURRENCY = 4;

function secHeaders(): Record<string, string> {
    // Same EDGAR_CONTACT the catalyst monitor uses; SEC asks for a contactable User-Agent.
    const contact = process.env.EDGAR_CONTACT?.trim() || process.env.SEC_EDGAR_USER_AGENT?.trim() || 'contact-not-configured@example.com';
    return {
        'User-Agent': `HappyStock/0.1 (${contact})`,
        'Accept-Encoding': 'gzip, deflate',
        Accept: 'application/json, text/plain, */*',
    };
}

type SubmissionsPayload = {
    cik: string;
    name: string;
    tickers?: string[];
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

function normalizeTicker(symbol: string): string {
    return symbol.trim().toUpperCase().replace(/\./g, '-');
}

type CompanyTickersPayload = Record<string, { cik_str: number; ticker: string; title: string }>;

async function lookupInCompanyTickers(ticker: string): Promise<string | null> {
    // ~1MB JSON, the most complete SEC ticker map (includes recent IPOs missing from ticker.txt).
    const payload = await fetchJson<CompanyTickersPayload>(`${SEC_WWW}/files/company_tickers.json`, {
        headers: secHeaders(),
        revalidate: 86_400,
        timeoutMs: 15_000,
    });
    for (const entry of Object.values(payload)) {
        if (entry?.ticker?.toUpperCase() === ticker) {
            return String(entry.cik_str).padStart(10, '0');
        }
    }
    return null;
}

async function lookupInTickerTxt(ticker: string): Promise<string | null> {
    const text = await fetchText(`${SEC_WWW}/include/ticker.txt`, { headers: secHeaders(), revalidate: 86_400 });
    for (const line of text.split('\n')) {
        const [t, cik] = line.trim().split('\t');
        if (t && cik && t.toUpperCase() === ticker) {
            return cik.padStart(10, '0');
        }
    }
    return null;
}

/** Resolve a ticker to a zero-padded 10-digit CIK, or null if unknown to the SEC. */
export async function getCikForSymbol(symbol: string): Promise<string | null> {
    const ticker = normalizeTicker(symbol);
    if (!ticker) return null;
    try {
        return (await lookupInCompanyTickers(ticker)) ?? (await lookupInTickerTxt(ticker));
    } catch (error) {
        console.error('EDGAR ticker lookup failed for', symbol, error);
        try {
            return await lookupInTickerTxt(ticker);
        } catch {
            return null;
        }
    }
}

function accessionPath(cik: string, accessionNumber: string, primaryDocument: string): string {
    const noDashes = accessionNumber.replace(/-/g, '');
    const cikNumber = String(Number(cik));
    // The submissions index prefixes inline-XBRL viewer paths like `xslF345X06/form4.xml`;
    // the raw XML lives one level up.
    const doc = primaryDocument.replace(/^xsl[^/]+\//, '');
    return `${SEC_WWW}/Archives/edgar/data/${cikNumber}/${noDashes}/${doc}`;
}

async function getSubmissions(cik: string): Promise<SubmissionsPayload | null> {
    try {
        return await fetchJson<SubmissionsPayload>(`${SEC_DATA}/submissions/CIK${cik}.json`, {
            headers: secHeaders(),
            revalidate: 900,
        });
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
            url: accessionPath(cik, recent.accessionNumber[i], recent.primaryDocument[i]),
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
    const filings = await getRecentFilings(ticker, ['4', '4/A'], isoDaysAgo(lookbackDays));
    if (filings.length === 0) return [];

    const perFiling = await mapWithConcurrency(filings, FORM4_CONCURRENCY, async (filing) => {
        try {
            // Filings are immutable, cache for a week.
            const xml = await fetchText(filing.url, { headers: secHeaders(), revalidate: 604_800 });
            return parseForm4Xml(xml, {
                symbol: ticker,
                filingDate: filing.filingDate,
                accessionNumber: filing.accessionNumber,
                filingUrl: filing.url.replace(/\/[^/]+$/, `/${filing.accessionNumber}-index.htm`),
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
            const payload = await fetchJson<CompanyFactsPayload>(`${SEC_DATA}/api/xbrl/companyfacts/CIK${cik}.json`, {
                headers: secHeaders(),
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
    const refs = await getRecentFilings(symbol, ['8-K', '8-K/A', '10-Q', '10-K', '10-K/A', 'SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A'], undefined, limit);
    return refs.map((ref) => ({
        ...ref,
        // Send users to the filing index, which works for every document type.
        url: ref.url.replace(/\/[^/]+$/, `/${ref.accessionNumber}-index.htm`),
    }));
}
