// Pure logic for the multi-source cross-checks (quotes: Alpaca vs Twelve Data
// vs Finnhub; insiders: EDGAR filings vs Finnhub trades). No I/O — unit-tested
// in __tests__/xcheck-math.test.ts.

import { shiftDate } from '@/lib/insider-math';

export const QUOTE_DEVIATION_PCT = 1;

export interface QuoteTriple {
    symbol: string;
    // Session date the Alpaca close belongs to (YYYY-MM-DD, ET)
    date: string;
    alpaca: number | null;
    // Finnhub live quote: c = last price, t = epoch seconds of last trade
    finnhub: { c: number; t: number } | null;
    twelve: { date: string; close: number } | null;
}

export type MismatchReason = 'dateMismatch' | 'priceMismatch';

export interface QuoteMismatch {
    symbol: string;
    date: string;
    reason: MismatchReason;
    alpaca: number | null;
    twelve: number | null;
    twelveDate: string | null;
    finnhub: number | null;
    // |twelve − alpaca| / alpaca in percent
    deviationPct: number | null;
    // Finnhub last price is also off by more than the threshold — informational,
    // its quote includes after-hours trades so it never decides the verdict
    finnhubOff: boolean;
}

const etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

function pctDiff(a: number, b: number): number {
    return Math.abs(a - b) / Math.abs(b) * 100;
}

// Alpaca is the reference; Twelve must land on the same session date and
// within thresholdPct. Returns null when the sources agree or when there's
// nothing to compare (a source didn't return data).
export function compareQuote(q: QuoteTriple, thresholdPct = QUOTE_DEVIATION_PCT): QuoteMismatch | null {
    if (q.alpaca === null || q.alpaca <= 0 || !q.twelve) return null;
    const finnhubSameDay = q.finnhub ? etDate.format(new Date(q.finnhub.t * 1000)) === q.date : false;
    const finnhubOff = finnhubSameDay && q.finnhub ? pctDiff(q.finnhub.c, q.alpaca) > thresholdPct : false;
    const base = {
        symbol: q.symbol,
        date: q.date,
        alpaca: q.alpaca,
        twelve: q.twelve.close,
        twelveDate: q.twelve.date,
        finnhub: finnhubSameDay && q.finnhub ? q.finnhub.c : null,
        finnhubOff,
    };
    if (q.twelve.date !== q.date) {
        return { ...base, reason: 'dateMismatch', deviationPct: null };
    }
    const deviationPct = pctDiff(q.twelve.close, q.alpaca);
    if (deviationPct > thresholdPct) {
        return { ...base, reason: 'priceMismatch', deviationPct };
    }
    return null;
}

// Round-robin sampler: picks n items starting at cursor, wrapping around
export function rotateSample<T>(pool: T[], cursor: number, n: number): { picked: T[]; next: number } {
    if (pool.length === 0 || n <= 0) return { picked: [], next: 0 };
    const start = ((cursor % pool.length) + pool.length) % pool.length;
    const count = Math.min(n, pool.length);
    const picked: T[] = [];
    for (let i = 0; i < count; i++) picked.push(pool[(start + i) % pool.length]);
    return { picked, next: (start + count) % pool.length };
}

// Order-independent identity of a mismatch set, for "only alert on change"
export function alertSignature(keys: string[]): string {
    return [...new Set(keys)].sort().join(',');
}

export interface FilingKey {
    symbol: string;
    filingDate: string;
    accessionNumber: string;
    // null = XML not parsed yet (seed path); callers may backfill before deciding
    txCodes: string[] | null;
}

export interface TradeKey {
    symbol: string;
    filingDate: string;
}

export interface MissingFilingOpts {
    // Finnhub ingestion lag we tolerate before calling a filing "missing"
    graceDays: number;
    // Finnhub's filingDate may differ from EDGAR's by a day (timezone)
    toleranceDays: number;
    lookbackDays: number;
}

export const DEFAULT_MISSING_OPTS: MissingFilingOpts = { graceDays: 2, toleranceDays: 1, lookbackDays: 7 };

const hasOpenMarketCode = (codes: string[]) => codes.includes('P') || codes.includes('S');

// EDGAR Form 4 filings that should have a matching Finnhub trade row but
// don't: same symbol, filing date within ±toleranceDays. Filings whose
// parsed transaction codes contain no P/S can never appear in the trades
// table (it only stores open-market buys/sells) and are skipped; unparsed
// filings (txCodes null) are kept so the caller can backfill and re-check.
export function findMissingFilings(
    filings: FilingKey[],
    trades: TradeKey[],
    today: string,
    opts: MissingFilingOpts = DEFAULT_MISSING_OPTS,
): FilingKey[] {
    const from = shiftDate(today, -opts.lookbackDays);
    const to = shiftDate(today, -opts.graceDays);
    const tradeDatesBySymbol = new Map<string, string[]>();
    for (const t of trades) {
        const list = tradeDatesBySymbol.get(t.symbol) ?? [];
        list.push(t.filingDate);
        tradeDatesBySymbol.set(t.symbol, list);
    }
    const out: FilingKey[] = [];
    for (const f of filings) {
        if (f.filingDate < from || f.filingDate > to) continue;
        if (f.txCodes !== null && !hasOpenMarketCode(f.txCodes)) continue;
        const lo = shiftDate(f.filingDate, -opts.toleranceDays);
        const hi = shiftDate(f.filingDate, opts.toleranceDays);
        const matched = (tradeDatesBySymbol.get(f.symbol) ?? []).some((d) => d >= lo && d <= hi);
        if (!matched) out.push(f);
    }
    return out;
}
