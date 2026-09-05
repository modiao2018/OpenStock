'use server';

import {
    buildStockSentimentInsights,
    normalizeSourceInsight,
    SOURCE_CONFIG,
    type SentimentSourceInsight,
    type SentimentSourceKey,
    type SourceComparePayload,
    type StockSentimentInsights,
} from './adanos.helpers';
import {
    type AdanosQuota,
    isCacheFresh,
    parseQuotaHeaders,
    parseSourceList,
    pickTighterQuota,
    quotaExhausted,
} from '@/lib/adanos-quota';
import { readQuota, readSnapshot, writeQuota, writeSnapshot } from '@/lib/adanos-store';
import { recordSourceCall } from '@/lib/source-calls';

// The free tier allows 250 metered requests per month, and every source is
// one request. Snapshots therefore live in Mongo (shared by every instance
// and surviving deploys) and are refreshed at most once per ADANOS_CACHE_HOURS
// per symbol; when the month's quota is nearly gone we serve whatever
// snapshot we have rather than spend the last requests.
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_CACHE_HOURS = 24;
const DEFAULT_QUOTA_RESERVE = 10;
const FETCH_TIMEOUT_MS = 5000;

const ALL_SOURCES = Object.keys(SOURCE_CONFIG) as SentimentSourceKey[];

function getAdanosBaseUrl(): string {
    return (process.env.ADANOS_API_BASE_URL || 'https://api.adanos.org').replace(/\/$/, '');
}

function getAdanosApiKey(): string {
    return process.env.ADANOS_API_KEY ?? '';
}

function envInt(name: string, fallback: number): number {
    const n = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getConfiguredSources(): SentimentSourceKey[] {
    return parseSourceList(process.env.ADANOS_SOURCES, ALL_SOURCES);
}

function getCacheTtlMs(): number {
    return envInt('ADANOS_CACHE_HOURS', DEFAULT_CACHE_HOURS) * 3600_000;
}

function getQuotaReserve(): number {
    return envInt('ADANOS_QUOTA_RESERVE', DEFAULT_QUOTA_RESERVE);
}

type SourceFetch = { insight: SentimentSourceInsight | null; quota: AdanosQuota | null; failed: boolean };

async function fetchCompareSource(
    source: SentimentSourceKey,
    symbol: string,
    days: number,
): Promise<SourceFetch> {
    try {
        const url = new URL(`${getAdanosBaseUrl()}${SOURCE_CONFIG[source].path}`);
        url.searchParams.set('tickers', symbol.toUpperCase());
        url.searchParams.set('days', String(days));

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);
        const start = Date.now();
        let response: Response;
        try {
            response = await fetch(url.toString(), {
                headers: {
                    'X-API-Key': getAdanosApiKey(),
                },
                signal: abortController.signal,
                // Mongo snapshots are the cache; the Next data cache would
                // only hide them
                cache: 'no-store',
            });
        } catch (err) {
            void recordSourceCall('adanos', false, Date.now() - start, err);
            throw err;
        } finally {
            clearTimeout(timeout);
        }
        const quota = parseQuotaHeaders((name) => response.headers?.get(name), start);
        // 404 = no data for that ticker, the upstream itself is fine
        const healthy = response.ok || response.status === 404;
        void recordSourceCall(
            'adanos',
            healthy,
            Date.now() - start,
            healthy ? undefined : response.status === 429 ? 'HTTP 429 quota exhausted' : `HTTP ${response.status}`,
        );

        if (response.status === 404) {
            return { insight: null, quota, failed: false };
        }

        if (!response.ok) {
            console.error(`Adanos ${source} compare failed for ${symbol}: ${response.status}`);
            return { insight: null, quota, failed: true };
        }

        const payload = (await response.json()) as SourceComparePayload;
        const row = payload.stocks?.find((item) => item.ticker?.toUpperCase() === symbol.toUpperCase());

        return { insight: normalizeSourceInsight(source, row), quota, failed: false };
    } catch (error) {
        console.error(`Adanos ${source} compare request failed for ${symbol}`, error);
        return { insight: null, quota: null, failed: true };
    }
}

async function fetchFresh(symbol: string, days: number, sources: SentimentSourceKey[]): Promise<{
    insights: StockSentimentInsights | null;
    failed: boolean;
}> {
    const results = await Promise.all(sources.map((source) => fetchCompareSource(source, symbol, days)));

    const quota = results.reduce<AdanosQuota | null>((acc, r) => pickTighterQuota(acc, r.quota), null);
    if (quota) await writeQuota(quota);

    const insights = buildStockSentimentInsights(
        symbol,
        results.map((r) => r.insight),
    );
    if (insights) insights.requestedSources = sources.length;
    // Every source failed (network/5xx/429): nothing trustworthy to cache
    const failed = results.every((r) => r.failed);
    return { insights, failed };
}

// Coalesces concurrent renders of the same uncached symbol into one upstream
// round-trip per process
const inflight = new Map<string, Promise<StockSentimentInsights | null>>();

export async function getStockSentimentInsights(
    symbol: string,
    days: number = DEFAULT_LOOKBACK_DAYS,
): Promise<StockSentimentInsights | null> {
    if (!getAdanosApiKey() || !symbol?.trim()) {
        return null;
    }

    const normalizedSymbol = symbol.trim().toUpperCase();
    const lookbackDays = Math.max(1, Math.min(days, 30));
    const sources = getConfiguredSources();
    const now = Date.now();

    const cached = await readSnapshot(normalizedSymbol);
    const sameSources = cached ? sources.every((s) => cached.sources.includes(s)) : false;
    if (cached && sameSources && isCacheFresh(cached.fetchedAt, getCacheTtlMs(), now)) {
        return withMeta(cached.insights, cached.fetchedAt, sources.length);
    }

    const quota = await readQuota();
    if (quotaExhausted(quota, getQuotaReserve(), now)) {
        if (!cached) console.warn(`Adanos quota reserve reached (${quota?.remaining} left); no snapshot for ${normalizedSymbol}`);
        return cached ? withMeta(cached.insights, cached.fetchedAt, sources.length) : null;
    }

    const key = `${normalizedSymbol}:${lookbackDays}:${sources.join(',')}`;
    const pending = inflight.get(key);
    if (pending) return pending;

    const task = (async () => {
        const fresh = await fetchFresh(normalizedSymbol, lookbackDays, sources);
        if (fresh.failed) {
            // Keep serving the stale snapshot; retry on the next render
            return cached ? withMeta(cached.insights, cached.fetchedAt, sources.length) : null;
        }
        const fetchedAt = Date.now();
        await writeSnapshot(normalizedSymbol, { insights: fresh.insights, sources, fetchedAt });
        return withMeta(fresh.insights, fetchedAt, sources.length);
    })().finally(() => inflight.delete(key));

    inflight.set(key, task);
    return task;
}

function withMeta(
    insights: StockSentimentInsights | null,
    fetchedAt: number,
    requestedSources: number,
): StockSentimentInsights | null {
    if (!insights) return null;
    return { ...insights, fetchedAt, requestedSources };
}
