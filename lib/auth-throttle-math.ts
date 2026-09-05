// Pure sliding-window/lockout arithmetic for the auth throttle. Kept free of
// I/O so the policy is unit-testable; lib/auth-throttle.ts persists it.

export type ThrottlePolicy = {
    // failures allowed inside one window before lockout
    maxFailures: number;
    windowMs: number;
    // first lockout length; doubles on every consecutive lockout up to maxLockMs
    baseLockMs: number;
    maxLockMs: number;
};

// Per-email: 5 wrong passwords in 10 minutes locks that account for 5 min,
// doubling each repeat up to an hour. Per-IP is looser so a shared office NAT
// with a few forgetful people is not locked out by one of them.
export const SIGN_IN_EMAIL_POLICY: ThrottlePolicy = {
    maxFailures: 5,
    windowMs: 10 * 60 * 1000,
    baseLockMs: 5 * 60 * 1000,
    maxLockMs: 60 * 60 * 1000,
};
export const SIGN_IN_IP_POLICY: ThrottlePolicy = {
    maxFailures: 20,
    windowMs: 10 * 60 * 1000,
    baseLockMs: 10 * 60 * 1000,
    maxLockMs: 6 * 60 * 60 * 1000,
};
// Sign-up and password-reset requests are counted per IP regardless of
// outcome: each one is a cheap way to spam the DB or someone's mailbox.
export const SIGN_UP_IP_POLICY: ThrottlePolicy = {
    maxFailures: 10,
    windowMs: 60 * 60 * 1000,
    baseLockMs: 60 * 60 * 1000,
    maxLockMs: 24 * 60 * 60 * 1000,
};
export const RESET_EMAIL_POLICY: ThrottlePolicy = {
    maxFailures: 3,
    windowMs: 60 * 60 * 1000,
    baseLockMs: 60 * 60 * 1000,
    maxLockMs: 24 * 60 * 60 * 1000,
};
export const RESET_IP_POLICY: ThrottlePolicy = {
    maxFailures: 10,
    windowMs: 60 * 60 * 1000,
    baseLockMs: 60 * 60 * 1000,
    maxLockMs: 24 * 60 * 60 * 1000,
};

export type ThrottleState = {
    count: number;
    windowStart: number;
    lockedUntil: number | null;
    // consecutive lockouts; drives the exponential backoff
    strikes: number;
};

export const emptyState = (now: number): ThrottleState => ({
    count: 0,
    windowStart: now,
    lockedUntil: null,
    strikes: 0,
});

export function isLocked(state: ThrottleState, now: number): boolean {
    return state.lockedUntil !== null && state.lockedUntil > now;
}

export function retryAfterMs(state: ThrottleState, now: number): number {
    return isLocked(state, now) ? (state.lockedUntil as number) - now : 0;
}

// Fold one failure into the state. Returns the next state; the caller
// decides whether it is now locked.
export function recordFailure(state: ThrottleState, policy: ThrottlePolicy, now: number): ThrottleState {
    let next = { ...state };
    if (now - next.windowStart >= policy.windowMs) {
        next.count = 0;
        next.windowStart = now;
    }
    // Backoff memory: strikes only reset after the subject has been quiet for
    // a full maxLockMs beyond its last lockout, so a bot cannot pace itself to
    // stay at the base lockout forever.
    if (next.lockedUntil !== null && now - next.lockedUntil >= policy.maxLockMs) {
        next.strikes = 0;
        next.lockedUntil = null;
    }
    next.count += 1;
    if (next.count >= policy.maxFailures) {
        const lockMs = Math.min(policy.maxLockMs, policy.baseLockMs * 2 ** next.strikes);
        next = { count: 0, windowStart: now, lockedUntil: now + lockMs, strikes: next.strikes + 1 };
    }
    return next;
}

// How long the persisted doc must survive so the lock or window is honoured
export function stateTtlMs(state: ThrottleState, policy: ThrottlePolicy, now: number): number {
    const lockRemaining = retryAfterMs(state, now);
    const windowRemaining = Math.max(0, policy.windowMs - (now - state.windowStart));
    // keep strikes around for a while so a bot cannot reset the backoff by waiting one window
    const strikeMemory = state.strikes > 0 ? policy.maxLockMs : 0;
    return Math.max(lockRemaining, windowRemaining, strikeMemory, 60_000);
}

// Human-facing rounding: "try again in N minutes"
export function retryAfterMinutes(ms: number): number {
    return Math.max(1, Math.ceil(ms / 60_000));
}
