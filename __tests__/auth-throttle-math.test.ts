import { describe, expect, it } from 'vitest';
import {
    SIGN_IN_EMAIL_POLICY,
    emptyState,
    isLocked,
    recordFailure,
    retryAfterMinutes,
    retryAfterMs,
    stateTtlMs,
    type ThrottleState,
} from '@/lib/auth-throttle-math';

const P = SIGN_IN_EMAIL_POLICY;
const MIN = 60_000;

const fail = (state: ThrottleState, times: number, at: number) => {
    let s = state;
    for (let i = 0; i < times; i++) s = recordFailure(s, P, at);
    return s;
};

describe('recordFailure', () => {
    it('does not lock before maxFailures', () => {
        const s = fail(emptyState(0), P.maxFailures - 1, 0);
        expect(isLocked(s, 0)).toBe(false);
        expect(s.count).toBe(P.maxFailures - 1);
    });

    it('locks on the maxFailures-th failure for baseLockMs', () => {
        const s = fail(emptyState(0), P.maxFailures, 0);
        expect(isLocked(s, 0)).toBe(true);
        expect(retryAfterMs(s, 0)).toBe(P.baseLockMs);
        expect(isLocked(s, P.baseLockMs)).toBe(false);
        expect(s.count).toBe(0);
        expect(s.strikes).toBe(1);
    });

    it('resets the window count after windowMs of quiet', () => {
        const s = fail(emptyState(0), P.maxFailures - 1, 0);
        const later = recordFailure(s, P, P.windowMs + 1);
        expect(later.count).toBe(1);
        expect(isLocked(later, P.windowMs + 1)).toBe(false);
    });

    it('doubles the lockout on repeated lockouts up to maxLockMs', () => {
        let s = fail(emptyState(0), P.maxFailures, 0);
        let t = retryAfterMs(s, 0);
        const seen = [t];
        for (let round = 0; round < 6; round++) {
            const at = (s.lockedUntil as number) + 1;
            s = fail(s, P.maxFailures, at);
            t = retryAfterMs(s, at);
            seen.push(t);
        }
        expect(seen[1]).toBe(P.baseLockMs * 2);
        expect(seen[2]).toBe(P.baseLockMs * 4);
        expect(Math.max(...seen)).toBe(P.maxLockMs);
        expect(seen[seen.length - 1]).toBe(P.maxLockMs);
    });

    it('keeps the backoff when the subject merely waits out one lock', () => {
        const locked = fail(emptyState(0), P.maxFailures, 0);
        const soonAfter = (locked.lockedUntil as number) + P.windowMs + 1;
        expect(recordFailure(locked, P, soonAfter).strikes).toBe(1);
    });

    it('resets the backoff after maxLockMs of quiet past the last lock', () => {
        const locked = fail(emptyState(0), P.maxFailures, 0);
        const quietAt = (locked.lockedUntil as number) + P.maxLockMs + 1;
        const s = recordFailure(locked, P, quietAt);
        expect(s.strikes).toBe(0);
        expect(s.count).toBe(1);
        expect(isLocked(s, quietAt)).toBe(false);
    });
});

describe('stateTtlMs', () => {
    it('outlives the lock and the window', () => {
        const s = fail(emptyState(0), P.maxFailures, 0);
        expect(stateTtlMs(s, P, 0)).toBeGreaterThanOrEqual(P.baseLockMs);
        expect(stateTtlMs(s, P, 0)).toBeGreaterThanOrEqual(P.maxLockMs); // strike memory
        expect(stateTtlMs(emptyState(0), P, 0)).toBeGreaterThanOrEqual(MIN);
    });
});

describe('retryAfterMinutes', () => {
    it('rounds up and never says zero', () => {
        expect(retryAfterMinutes(1)).toBe(1);
        expect(retryAfterMinutes(MIN)).toBe(1);
        expect(retryAfterMinutes(MIN + 1)).toBe(2);
        expect(retryAfterMinutes(5 * MIN)).toBe(5);
    });
});
