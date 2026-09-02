// Twelve Data client — second quote/daily-bar source used only for sampled
// cross-checks against Alpaca/Finnhub (free tier: 8 credits/min, 800/day,
// 1 credit per symbol). Plain fetch, no Next cache; importable by the daemon.

import { timed } from '@/lib/source-calls';

const BASE_URL = 'https://api.twelvedata.com';

type TwelveError = { status?: string; code?: number; message?: string };

export function twelveConfigured(): boolean {
    return Boolean(process.env.TWELVEDATA_API_KEY);
}

async function twelveGet<T>(path: string, params: Record<string, string>): Promise<T> {
    const key = process.env.TWELVEDATA_API_KEY;
    if (!key) throw new Error('TWELVEDATA_API_KEY is not set');
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return timed('twelvedata', async () => {
        // One retry on transport errors / 5xx / 429 — a single blip must not
        // show up as a source mismatch in the cross-check
        let lastErr: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const res = await fetch(url, {
                    headers: { Authorization: `apikey ${key}` },
                    signal: AbortSignal.timeout(15_000),
                    cache: 'no-store',
                });
                if (res.status === 429 || res.status >= 500) throw new Error(`Twelve Data HTTP ${res.status}`);
                if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
                const data = (await res.json()) as T & TwelveError;
                // Twelve wraps errors (bad symbol, quota) in a 200 with status:'error'
                if (data.status === 'error') throw new Error(`Twelve Data ${data.code ?? ''}: ${data.message ?? 'error'}`);
                return data;
            } catch (err) {
                lastErr = err;
                const msg = err instanceof Error ? err.message : String(err);
                const retryable = /fetch failed|HTTP 429|HTTP 5\d\d|aborted/i.test(msg);
                if (!retryable || attempt === 1) throw err;
                await new Promise((r) => setTimeout(r, 2000));
            }
        }
        throw lastErr;
    });
}

export interface TwelveQuote {
    close: number;
    datetime: string;
    isMarketOpen: boolean;
}

export async function fetchTwelveQuote(symbol: string): Promise<TwelveQuote> {
    const q = await twelveGet<{ close?: string; datetime?: string; is_market_open?: boolean }>('/quote', { symbol });
    const close = parseFloat(q.close ?? '');
    if (!Number.isFinite(close)) throw new Error(`Twelve Data quote for ${symbol} has no close`);
    return { close, datetime: q.datetime ?? '', isMarketOpen: Boolean(q.is_market_open) };
}

export interface TwelveDailyBar {
    // YYYY-MM-DD
    date: string;
    close: number;
}

// Latest completed daily bars (newest first), split-adjusted like our Alpaca feed
export async function fetchTwelveDaily(symbol: string, outputsize = 2): Promise<TwelveDailyBar[]> {
    const data = await twelveGet<{ values?: Array<{ datetime: string; close: string }> }>('/time_series', {
        symbol,
        interval: '1day',
        outputsize: String(outputsize),
        adjust: 'splits',
    });
    return (data.values ?? [])
        .map((v) => ({ date: v.datetime.slice(0, 10), close: parseFloat(v.close) }))
        .filter((v) => Number.isFinite(v.close));
}
