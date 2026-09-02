'use server';

import { fetchJSON } from '@/lib/actions/finnhub.actions';
import { AI_DIP_CATALOG, type AiSubSector } from '@/lib/ai-dips-catalog';
import { getAiDipPool, type AiDipMeta } from '@/lib/ai-dips-pool';
import { completedBars, computeDipStats, type DailyBar } from '@/lib/ai-dips-math';
import { readSnapshot, writeSnapshot } from '@/lib/snapshot';
import { timed } from '@/lib/source-calls';

// Fixed snapshot key: the pool is a global, editable set — hashing the symbol
// list (snapshotKey) would orphan the snapshot on every pool edit
const SNAPSHOT_KEY = 'ai-dips:pool';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const NEXT_PUBLIC_FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';

const ALPACA_BARS_URL = 'https://data.alpaca.markets/v2/stocks/bars';
const ALPACA_CLOCK_URL = 'https://paper-api.alpaca.markets/v2/clock';
// 70 calendar days ≈ 47 sessions: 30 for the drawdown window plus streak
// headroom before capping
const LOOKBACK_DAYS = 70;

export interface AiDipStock {
    symbol: string;
    name: string;
    subSector: AiSubSector;
    // Finnhub live quote; 0 when unavailable
    price: number;
    todayChangePct: number;
    streakDays: number;
    streakCapped: boolean;
    streakDeclinePct: number | null;
    drawdownFromHighPct: number | null;
    // Live price is below the last completed close — today extends the slide
    provisionalToday: boolean;
    // Trailing closes for the sparkline, ascending
    closes: number[];
    // False when Alpaca returned no usable history for the symbol
    barsOk: boolean;
}

export interface AiDipsPayload {
    // ALPACA_API_KEY/SECRET present — streak columns are meaningful
    configured: boolean;
    // Epoch ms of computation
    updatedAt: number;
    rows: AiDipStock[];
    // Alpaca bars fetch threw while configured — streak data is stale/missing
    barsError?: boolean;
    // Finnhub returned no usable quote for any symbol — likely quota/outage
    quotesError?: boolean;
}

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

type Quote = { c?: number; dp?: number };

async function fetchQuotes(symbols: string[]): Promise<Record<string, Quote>> {
    if (!NEXT_PUBLIC_FINNHUB_API_KEY) return {};
    const entries = await Promise.all(
        symbols.map(async (symbol) => {
            try {
                const quote = await fetchJSON<Quote>(
                    `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${NEXT_PUBLIC_FINNHUB_API_KEY}`,
                    60,
                );
                return [symbol, quote] as const;
            } catch {
                return [symbol, {}] as const;
            }
        }),
    );
    return Object.fromEntries(entries);
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
    const quotes = await fetchQuotes(symbols);
    const quotesError =
        Boolean(process.env.NEXT_PUBLIC_FINNHUB_API_KEY) &&
        symbols.length > 0 &&
        !symbols.some((s) => (quotes[s]?.c ?? 0) > 0);

    const rows: AiDipStock[] = pool.map(({ symbol, name, subSector }) => {
        const stats = computeDipStats(completedBars(barsBySymbol[symbol] ?? [], excludeDate));
        const price = quotes[symbol]?.c ?? 0;
        return {
            symbol,
            name,
            subSector,
            price,
            todayChangePct: quotes[symbol]?.dp ?? 0,
            streakDays: stats?.streakDays ?? 0,
            streakCapped: stats?.streakCapped ?? false,
            streakDeclinePct: stats?.streakDeclinePct ?? null,
            drawdownFromHighPct: stats?.drawdownFromHighPct ?? null,
            provisionalToday: Boolean(stats && price > 0 && price < stats.lastClose),
            closes: stats?.closes ?? [],
            barsOk: stats !== null,
        };
    });

    // Longest streak first, deepest decline breaking ties; symbols without
    // history sink to the bottom
    rows.sort((a, b) => {
        if (a.barsOk !== b.barsOk) return a.barsOk ? -1 : 1;
        if (a.streakDays !== b.streakDays) return b.streakDays - a.streakDays;
        return (a.streakDeclinePct ?? 0) - (b.streakDeclinePct ?? 0);
    });

    const payload: AiDipsPayload = { configured, updatedAt: Date.now(), rows, barsError, quotesError };
    if (rows.some((r) => r.barsOk || r.price > 0)) {
        void writeSnapshot(SNAPSHOT_KEY, payload);
    }
    return payload;
}
