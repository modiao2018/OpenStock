/**
 * Process-wide pacing for Finnhub's free tier (60 requests/minute, 30/second).
 *
 * The web app fans out per-symbol quote/profile calls with Promise.all from the
 * heatmap, watchlist, AI-dips and stock pages, and the client polls every minute.
 * Two open tabs on a 40-symbol dashboard were enough to trip 429s. This gate:
 *
 *   - dedupes identical in-flight requests and memoizes responses for a short TTL,
 *     so polls and concurrent renders share one upstream call per URL;
 *   - meters real upstream calls through a sliding 60s window with headroom left
 *     for the monitor daemon, which shares the same API key;
 *   - on a 429, opens a cooldown during which callers fail fast instead of piling
 *     more requests onto an already-throttled key.
 *
 * Pure timing logic lives in `FinnhubGate` so it can be unit-tested with an
 * injected clock; `finnhubGate` is the singleton the actions use.
 */

export interface GateOptions {
    /** Upstream calls allowed per window. Free tier is 60/min; leave room for the daemon. */
    limit: number;
    windowMs: number;
    /** Longest a caller will wait for a slot before giving up. */
    maxWaitMs: number;
    /** How long to fail fast after an upstream 429. */
    cooldownMs: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

export class FinnhubRateLimitError extends Error {
    constructor(message: string, public readonly retryAfterMs: number) {
        super(message);
        this.name = 'FinnhubRateLimitError';
    }
}

export class FinnhubGate {
    private readonly starts: number[] = [];
    private cooldownUntil = 0;
    private readonly now: () => number;
    private readonly sleep: (ms: number) => Promise<void>;

    constructor(private readonly opts: GateOptions) {
        this.now = opts.now ?? (() => Date.now());
        this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    }

    /** Milliseconds until the next slot frees up; 0 when a slot is free now. */
    private waitFor(): number {
        const now = this.now();
        if (now < this.cooldownUntil) return this.cooldownUntil - now;
        const cutoff = now - this.opts.windowMs;
        while (this.starts.length > 0 && this.starts[0] <= cutoff) this.starts.shift();
        if (this.starts.length < this.opts.limit) return 0;
        return this.starts[0] + this.opts.windowMs - now + 1;
    }

    /** Resolves when the caller may make one upstream request; throws if that is too far off. */
    async acquire(): Promise<void> {
        const wait = this.waitFor();
        if (wait > this.opts.maxWaitMs) {
            throw new FinnhubRateLimitError(
                this.now() < this.cooldownUntil
                    ? `Finnhub cooling down after 429 (${Math.ceil(wait / 1000)}s)`
                    : `Finnhub local rate limit reached (${Math.ceil(wait / 1000)}s until a slot frees)`,
                wait,
            );
        }
        if (wait > 0) {
            await this.sleep(wait);
            return this.acquire();
        }
        this.starts.push(this.now());
    }

    /** Call after an upstream 429 so subsequent callers back off together. */
    reportRateLimited(retryAfterMs?: number): void {
        this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + (retryAfterMs ?? this.opts.cooldownMs));
    }

    get inCooldown(): boolean {
        return this.now() < this.cooldownUntil;
    }

    /** Upstream calls started inside the current window. */
    get inWindow(): number {
        const cutoff = this.now() - this.opts.windowMs;
        return this.starts.filter((t) => t > cutoff).length;
    }
}

// ---------------------------------------------------------------------------
// Short-TTL response memo with in-flight dedupe, keyed by URL
// ---------------------------------------------------------------------------

type MemoEntry = { value: unknown; expiresAt: number };
const memo = new Map<string, MemoEntry>();
const inflight = new Map<string, Promise<unknown>>();
const MEMO_MAX = 2000;

export async function throughFinnhubGate<T>(
    gate: FinnhubGate,
    key: string,
    ttlMs: number,
    upstream: () => Promise<T>,
): Promise<T> {
    const now = Date.now();
    const hit = memo.get(key);
    if (hit && hit.expiresAt > now) return hit.value as T;

    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const run = (async () => {
        await gate.acquire();
        const value = await upstream();
        if (ttlMs > 0) {
            if (memo.size >= MEMO_MAX) {
                const oldest = memo.keys().next().value;
                if (oldest !== undefined) memo.delete(oldest);
            }
            memo.set(key, { value, expiresAt: Date.now() + ttlMs });
        }
        return value;
    })().finally(() => inflight.delete(key));

    inflight.set(key, run);
    return run;
}

/** Retry-After header is seconds (or an HTTP date); fall back to the gate's default cooldown. */
export function retryAfterMs(header: string | null): number | undefined {
    if (!header) return undefined;
    const secs = Number(header);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
    const at = Date.parse(header);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

// 50/min keeps ~10/min for the monitor daemon (insider every 90 min at 1 req/s,
// xcheck 10/hour) and absorbs Finnhub's own accounting jitter.
export const finnhubGate = new FinnhubGate({
    limit: 50,
    windowMs: 60_000,
    maxWaitMs: 20_000,
    cooldownMs: 15_000,
});
