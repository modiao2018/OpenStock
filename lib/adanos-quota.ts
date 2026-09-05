// Pure helpers for staying inside the Adanos free tier (250 requests/month,
// 10 tickers per compare call). No I/O — unit-tested in __tests__/adanos-quota.test.ts.

export interface AdanosQuota {
    limit: number;
    remaining: number;
    used: number;
    // Epoch ms of the monthly reset; null when the header was missing/unparsable
    resetAt: number | null;
    // When this snapshot was taken (epoch ms)
    at: number;
}

function toInt(value: string | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
}

// Reads the x-ratelimit-*-monthly headers Adanos returns on every metered call.
// Returns null when the response carries no quota info (e.g. health endpoints).
export function parseQuotaHeaders(
    get: (name: string) => string | null | undefined,
    now: number = Date.now(),
): AdanosQuota | null {
    const limit = toInt(get('x-ratelimit-limit-monthly'));
    const remaining = toInt(get('x-ratelimit-remaining-monthly'));
    if (limit === null || remaining === null) return null;
    const used = toInt(get('x-ratelimit-used-monthly')) ?? Math.max(0, limit - remaining);
    const resetRaw = get('x-ratelimit-reset-monthly');
    const resetMs = resetRaw ? Date.parse(resetRaw) : NaN;
    return {
        limit,
        remaining,
        used,
        resetAt: Number.isFinite(resetMs) ? resetMs : null,
        at: now,
    };
}

// Of several snapshots taken by parallel requests, keep the most pessimistic
// one (lowest remaining). Snapshots from a previous reset window lose to
// newer ones regardless of their counts.
export function pickTighterQuota(a: AdanosQuota | null, b: AdanosQuota | null): AdanosQuota | null {
    if (!a) return b;
    if (!b) return a;
    if (a.resetAt !== null && b.resetAt !== null && a.resetAt !== b.resetAt) {
        return a.resetAt > b.resetAt ? a : b;
    }
    return b.remaining < a.remaining ? b : a;
}

// True when we should stop spending quota on new symbols: the last known
// remaining count is at or below the reserve and the window has not reset yet.
// A snapshot without a reset time is trusted for at most `staleAfterMs`.
export function quotaExhausted(
    quota: AdanosQuota | null,
    reserve: number,
    now: number = Date.now(),
    staleAfterMs: number = 7 * 86400_000,
): boolean {
    if (!quota) return false;
    if (quota.remaining > reserve) return false;
    if (quota.resetAt !== null) return now < quota.resetAt;
    return now - quota.at < staleAfterMs;
}

export function isCacheFresh(fetchedAt: number | Date, ttlMs: number, now: number = Date.now()): boolean {
    const ts = fetchedAt instanceof Date ? fetchedAt.getTime() : fetchedAt;
    return Number.isFinite(ts) && now - ts < ttlMs;
}

// Parses a comma-separated allow-list (ADANOS_SOURCES) against the known
// source keys, preserving the canonical order. Unknown names are ignored;
// an empty/unset value means "all sources".
export function parseSourceList<T extends string>(raw: string | undefined, all: readonly T[]): T[] {
    const wanted = new Set(
        (raw ?? '')
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
    );
    if (wanted.size === 0) return [...all];
    const picked = all.filter((key) => wanted.has(key));
    return picked.length > 0 ? picked : [...all];
}

export function formatQuota(quota: AdanosQuota | null): string | null {
    if (!quota) return null;
    const reset = quota.resetAt !== null ? new Date(quota.resetAt).toISOString().slice(5, 10).replace('-', '/') : null;
    return `${quota.remaining}/${quota.limit}${reset ? ` · reset ${reset}` : ''}`;
}
