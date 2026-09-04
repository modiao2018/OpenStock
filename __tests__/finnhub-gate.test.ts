import { describe, expect, it } from 'vitest';
import { FinnhubGate, FinnhubRateLimitError, isMemoized, retryAfterMs, throughFinnhubGate } from '@/lib/finnhub-gate';

function makeGate(over: Partial<ConstructorParameters<typeof FinnhubGate>[0]> = {}) {
    let now = 1_000_000;
    const slept: number[] = [];
    const gate = new FinnhubGate({
        limit: 3,
        windowMs: 1000,
        maxWaitMs: 1500,
        cooldownMs: 2000,
        now: () => now,
        sleep: async (ms) => { slept.push(ms); now += ms; },
        ...over,
    });
    return { gate, slept, advance: (ms: number) => { now += ms; }, clock: () => now };
}

describe('FinnhubGate', () => {
    it('lets `limit` calls through immediately, then waits for the window to slide', async () => {
        const { gate, slept } = makeGate();
        await gate.acquire(); await gate.acquire(); await gate.acquire();
        expect(slept).toEqual([]);
        expect(gate.inWindow).toBe(3);
        // 4th call: the oldest start is at t0, so it must wait ~windowMs
        await gate.acquire();
        expect(slept).toEqual([1001]);
        expect(gate.inWindow).toBe(1);
    });

    it('fails fast instead of queueing when the wait would exceed maxWaitMs', async () => {
        const { gate } = makeGate({ limit: 1, windowMs: 5000, maxWaitMs: 100 });
        await gate.acquire();
        await expect(gate.acquire()).rejects.toBeInstanceOf(FinnhubRateLimitError);
    });

    it('opens a shared cooldown after an upstream 429', async () => {
        const { gate, advance } = makeGate({ maxWaitMs: 100 });
        gate.reportRateLimited();
        expect(gate.inCooldown).toBe(true);
        await expect(gate.acquire()).rejects.toThrow(/cooling down/);
        advance(2001);
        expect(gate.inCooldown).toBe(false);
        await expect(gate.acquire()).resolves.toBeUndefined();
    });

    it('reports free slots: limit minus calls in the window, none during a cooldown', async () => {
        const { gate, advance } = makeGate({ limit: 3, windowMs: 1000 });
        expect(gate.freeSlots).toBe(3);
        await gate.acquire(); await gate.acquire();
        expect(gate.freeSlots).toBe(1);
        gate.reportRateLimited();
        expect(gate.freeSlots).toBe(0);
        advance(2001);
        expect(gate.freeSlots).toBe(3);
    });

    it('honours an explicit Retry-After over the default cooldown', () => {
        const { gate, advance } = makeGate();
        gate.reportRateLimited(10_000);
        advance(2500);
        expect(gate.inCooldown).toBe(true);
    });
});

describe('throughFinnhubGate', () => {
    it('dedupes concurrent identical requests and memoizes for the TTL', async () => {
        const { gate } = makeGate({ limit: 100 });
        let calls = 0;
        const upstream = async () => { calls += 1; return { c: 1 }; };
        const key = `memo-test-${Math.random()}`;
        const [a, b] = await Promise.all([
            throughFinnhubGate(gate, key, 1000, upstream),
            throughFinnhubGate(gate, key, 1000, upstream),
        ]);
        expect(a).toBe(b);
        expect(calls).toBe(1);
        await throughFinnhubGate(gate, key, 1000, upstream);
        expect(calls).toBe(1);
    });

    it('exposes memo hits via isMemoized so callers can budget upstream calls', async () => {
        const { gate } = makeGate({ limit: 100 });
        const key = `memo-check-${Math.random()}`;
        expect(isMemoized(key)).toBe(false);
        await throughFinnhubGate(gate, key, 1000, async () => ({ c: 1 }));
        expect(isMemoized(key)).toBe(true);
        const noTtl = `memo-nottl-${Math.random()}`;
        await throughFinnhubGate(gate, noTtl, 0, async () => ({ c: 1 }));
        expect(isMemoized(noTtl)).toBe(false);
    });

    it('does not memoize failures, so the next caller retries', async () => {
        const { gate } = makeGate({ limit: 100 });
        let calls = 0;
        const key = `fail-test-${Math.random()}`;
        const failing = async () => { calls += 1; throw new Error('boom'); };
        await expect(throughFinnhubGate(gate, key, 1000, failing)).rejects.toThrow('boom');
        await expect(throughFinnhubGate(gate, key, 1000, failing)).rejects.toThrow('boom');
        expect(calls).toBe(2);
    });
});

describe('retryAfterMs', () => {
    it('parses seconds and dates, ignores junk', () => {
        expect(retryAfterMs('30')).toBe(30_000);
        expect(retryAfterMs(null)).toBeUndefined();
        expect(retryAfterMs('garbage')).toBeUndefined();
        const future = new Date(Date.now() + 5000).toUTCString();
        const ms = retryAfterMs(future)!;
        expect(ms).toBeGreaterThan(3000);
        expect(ms).toBeLessThanOrEqual(5000);
    });
});
