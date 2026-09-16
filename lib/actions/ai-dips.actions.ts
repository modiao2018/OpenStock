'use server';

import { fetchJSON } from '@/lib/actions/finnhub.actions';
import { AI_DIP_CATALOG } from '@/lib/ai-dips-catalog';
import { getAiDipPool, type AiDipMeta } from '@/lib/ai-dips-pool';
import type { DailyBar } from '@/lib/ai-dips-math';
import {
    AI_DIPS_SNAPSHOT_KEY,
    aiDipsQuotesError,
    buildAiDipsRows,
    type AiDipQuote,
    type AiDipsPayload,
} from '@/lib/ai-dips-rows';
import { finnhubGate, isMemoized, pickWithinBudget } from '@/lib/finnhub-gate';
import { quoteTtlSeconds } from '@/lib/market-hours';
import { readSnapshot, writeSnapshot } from '@/lib/snapshot';
import { timed } from '@/lib/source-calls';

// Row / payload shapes live in lib/ai-dips-rows.ts (shared with the monitor's
// quote sweep); a 'use server' file may only export async functions
const SNAPSHOT_KEY = AI_DIPS_SNAPSHOT_KEY;

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const NEXT_PUBLIC_FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';

const ALPACA_BARS_URL = 'https://data.alpaca.markets/v2/stocks/bars';
const ALPACA_CLOCK_URL = 'https://paper-api.alpaca.markets/v2/clock';
// 70 calendar days ≈ 47 sessions: 30 for the drawdown window plus streak
// headroom before capping
const LOOKBACK_DAYS = 70;

type AlpacaBar = { t: string; c: number };
type AlpacaBarsResponse = { bars?: Record<string, AlpacaBar[]>; next_page_token?: string | null };

function alpacaHeaders(): Record<string, string> {
    return {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY ?? '',
        'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET ?? '',
    };
}

// Session date (YYYY-MM-DD) in US/Eastern for a bar timestamp
const etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const etClock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
});

// Daily bars for all symbols in one batched request (+ page_token follow-ups).
// 1h fetch cache: closes change once per session, so the client's 60s poll
// only refreshes quotes.
async function fetchDailyBars(symbols: string[]): Promise<Record<string, DailyBar[]>> {
    const start = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600_000).toISOString();
    const out: Record<string, DailyBar[]> = {};
    let pageToken: string | undefined;

    for (let page = 0; page < 3; page++) {
        const url =
            // split-adjusted: raw bars would fabricate a −50%/−90% "down day"
            // (and a fake streak) whenever a stock splits inside the window
            `${ALPACA_BARS_URL}?symbols=${symbols.join(',')}&timeframe=1Day&adjustment=split&feed=iex&limit=10000` +
            `&start=${encodeURIComponent(start)}` +
            (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '');
        const data = await timed('alpaca', async () => {
            const res = await fetch(url, {
                headers: alpacaHeaders(),
                signal: AbortSignal.timeout(15_000),
                cache: 'force-cache',
                next: { revalidate: 3600 },
            });
            if (!res.ok) throw new Error(`Alpaca bars HTTP ${res.status}`);
            return (await res.json()) as AlpacaBarsResponse;
        });
        for (const [symbol, bars] of Object.entries(data.bars ?? {})) {
            const list = (out[symbol] ??= []);
            for (const b of bars) list.push({ date: etDate.format(new Date(b.t)), c: b.c });
        }
        pageToken = data.next_page_token ?? undefined;
        if (!pageToken) break;
    }

    for (const list of Object.values(out)) list.sort((a, b) => a.date.localeCompare(b.date));
    return out;
}

// Today's ET-dated bar counts as complete only after the closing auction:
// market closed AND past 16:00 ET. Returns the date to exclude, or undefined.
async function formingSessionDate(): Promise<string | undefined> {
    const now = new Date();
    const today = etDate.format(now);
    const pastClose = etClock.format(now) >= '16:00';
    try {
        const clock = await timed('alpaca', async () => {
            const res = await fetch(ALPACA_CLOCK_URL, {
                headers: alpacaHeaders(),
                signal: AbortSignal.timeout(5_000),
                cache: 'force-cache',
                next: { revalidate: 30 },
            });
            if (!res.ok) throw new Error(`Alpaca clock HTTP ${res.status}`);
            return (await res.json()) as { is_open: boolean };
        });
        return !clock.is_open && pastClose ? undefined : today;
    } catch {
        // clock unavailable — fall through to the pure time check
    }
    return pastClose ? undefined : today;
}

function quoteUrl(symbol: string): string {
    return `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${NEXT_PUBLIC_FINNHUB_API_KEY}`;
}

// The pool (up to 60 symbols) alone exceeds the gate's 50/min, so a full
// fan-out every poll left the same tail of symbols rejected each time. Fetch
// only what fits the free budget, stalest quote first, and let the caller
// keep the previous snapshot's price for the rest; the next poll rotates on.
async function fetchQuotes(
    symbols: string[],
    previousFetchedAt: Map<string, number>,
): Promise<{ quotes: Record<string, AiDipQuote>; picked: Set<string> }> {
    if (!NEXT_PUBLIC_FINNHUB_API_KEY) return { quotes: {}, picked: new Set() };
    const stalestFirst = [...symbols].sort(
        (a, b) => (previousFetchedAt.get(a) ?? 0) - (previousFetchedAt.get(b) ?? 0),
    );
    const picked = pickWithinBudget(stalestFirst, (s) => (isMemoized(quoteUrl(s)) ? 0 : 1), finnhubGate.freeSlots);
    const entries = await Promise.all(
        picked.map(async (symbol) => {
            try {
                return [symbol, await fetchJSON<AiDipQuote>(quoteUrl(symbol), quoteTtlSeconds())] as const;
            } catch {
                return [symbol, {} as AiDipQuote] as const;
            }
        }),
    );
    const quotes = Object.fromEntries(entries.filter(([, q]) => (q.c ?? 0) > 0));
    return { quotes, picked: new Set(picked) };
}

// Last successful getAiDipsData payload; lets SSR paint instantly while the
// client's mount refresh + poll fetches live data (same pattern as the heatmap)
export async function getAiDipsSnapshot(): Promise<AiDipsPayload | null> {
    const snapshot = await readSnapshot<AiDipsPayload>(SNAPSHOT_KEY);
    return snapshot?.data ?? null;
}

export async function getAiDipsData(): Promise<AiDipsPayload> {
    const configured = Boolean(process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET);

    // DB-backed pool; static catalog keeps the page alive if the DB is down
    let pool: AiDipMeta[];
    try {
        pool = await getAiDipPool();
    } catch (e) {
        console.error('AI dip pool read failed, falling back to catalog', e);
        pool = AI_DIP_CATALOG;
    }
    const symbols = pool.map((s) => s.symbol);

    let barsBySymbol: Record<string, DailyBar[]> = {};
    let excludeDate: string | undefined;
    let barsError = false;
    if (configured) {
        try {
            [barsBySymbol, excludeDate] = await Promise.all([
                fetchDailyBars(symbols),
                formingSessionDate(),
            ]);
        } catch (e) {
            barsError = true;
            console.error('AI dips bars fetch failed', e);
        }
    }
    // Quotes the gate could not refresh fall back to the last snapshot's
    // values rather than a 0 that renders as "—" and then gets persisted
    const previousRows = new Map(
        ((await readSnapshot<AiDipsPayload>(SNAPSHOT_KEY))?.data.rows ?? []).map((r) => [r.symbol, r]),
    );
    const previousFetchedAt = new Map([...previousRows].map(([s, r]) => [s, r.price > 0 ? r.fetchedAt ?? 0 : 0]));
    const { quotes, picked } = await fetchQuotes(symbols, previousFetchedAt);
    const quotesError = Boolean(process.env.NEXT_PUBLIC_FINNHUB_API_KEY) && aiDipsQuotesError(symbols, quotes, previousRows);
    const { rows, quotesStale } = buildAiDipsRows({
        pool, barsBySymbol, excludeDate, quotes, attempted: picked, previousRows, fetchedAt: Date.now(),
    });

    const payload: AiDipsPayload = { configured, updatedAt: Date.now(), rows, barsError, quotesError, quotesStale };
    if (rows.some((r) => r.barsOk || r.price > 0)) {
        void writeSnapshot(SNAPSHOT_KEY, payload);
    }
    return payload;
}
