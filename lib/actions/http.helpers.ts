/**
 * Small fetch helpers shared by the market-data sources (SEC EDGAR, Yahoo Finance,
 * Nasdaq, Finnhub). Every request has a timeout, participates in the Next.js data
 * cache via `next.revalidate`, and lands in the per-source ledger behind /status
 * (cache hits are recorded as fast successes, same as finnhub.actions).
 */

import { recordSourceCall } from '@/lib/source-calls';
import { inferSourceByHost } from '@/lib/sources-registry';

export type FetchOptions = {
    timeoutMs?: number;
    /** Seconds to keep the response in the Next.js data cache. Omit or 0 for no caching. */
    revalidate?: number;
    headers?: Record<string, string>;
};

type NextRequestInit = RequestInit & { next?: { revalidate?: number } };

export async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
    const { timeoutMs = 8000, revalidate, headers } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const source = inferSourceByHost(url) ?? '';
    const start = Date.now();

    try {
        const init: NextRequestInit = { headers, signal: controller.signal };
        if (revalidate && revalidate > 0) {
            init.cache = 'force-cache';
            init.next = { revalidate };
        } else {
            init.cache = 'no-store';
        }
        const res = await fetch(url, init);
        void recordSourceCall(source, res.ok, Date.now() - start, res.ok ? undefined : `HTTP ${res.status}`);
        return res;
    } catch (err) {
        void recordSourceCall(source, false, Date.now() - start, err);
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
    const res = await fetchWithTimeout(url, options);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return (await res.json()) as T;
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
    const res = await fetchWithTimeout(url, options);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.text();
}

/** Run `fn` over `items` with at most `limit` in flight at once, preserving order. */
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;

    async function worker() {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index], index);
        }
    }

    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
    await Promise.all(workers);
    return results;
}

export function toNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    if (value && typeof value === 'object' && 'raw' in value) {
        return toNumber((value as { raw: unknown }).raw);
    }
    return null;
}

// ---------------------------------------------------------------------------
// In-process memo for results that are too large for the Next.js data cache
// (2MB limit per entry) or that come from cookie-bound sessions.
// ---------------------------------------------------------------------------

type MemoEntry<T> = { value: T; expiresAt: number };
const memoStore = new Map<string, MemoEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const MEMO_MAX_ENTRIES = 500;

export async function memoize<T>(key: string, ttlMs: number, producer: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = memoStore.get(key) as MemoEntry<T> | undefined;
    if (cached && cached.expiresAt > now) {
        return cached.value;
    }

    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const promise = producer()
        .then((value) => {
            if (memoStore.size >= MEMO_MAX_ENTRIES) {
                const oldest = memoStore.keys().next().value;
                if (oldest !== undefined) memoStore.delete(oldest);
            }
            memoStore.set(key, { value, expiresAt: Date.now() + ttlMs });
            return value;
        })
        .finally(() => {
            inflight.delete(key);
        });

    inflight.set(key, promise);
    return promise;
}
