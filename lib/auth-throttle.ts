// Mongo-backed auth throttle. Every counter is keyed by scope + subject and
// the arithmetic lives in auth-throttle-math.ts.
import { headers } from 'next/headers';
import { connectToDatabase } from '@/database/mongoose';
import { AuthThrottle } from '@/database/models/auth-guard.model';
import {
    emptyState,
    isLocked,
    recordFailure,
    retryAfterMs,
    stateTtlMs,
    type ThrottlePolicy,
    type ThrottleState,
} from './auth-throttle-math';

// Behind nginx + Cloudflare the socket peer is always the proxy; the real
// client is the first hop of X-Forwarded-For (nginx appends, Cloudflare
// prepends the visitor). Fall back to a shared bucket rather than skipping.
export async function getClientIp(): Promise<string> {
    const h = await headers();
    const cf = h.get('cf-connecting-ip');
    if (cf) return cf.trim();
    const xff = h.get('x-forwarded-for');
    if (xff) return xff.split(',')[0].trim();
    const real = h.get('x-real-ip');
    if (real) return real.trim();
    return 'unknown';
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const throttleKey = (scope: string, subject: string) => `${scope}:${subject}`;

async function readState(key: string, now: number): Promise<ThrottleState> {
    const doc = await AuthThrottle.findOne({ key }).lean();
    if (!doc) return emptyState(now);
    return {
        count: doc.count,
        windowStart: doc.windowStart.getTime(),
        lockedUntil: doc.lockedUntil ? doc.lockedUntil.getTime() : null,
        strikes: doc.strikes ?? 0,
    };
}

async function writeState(key: string, state: ThrottleState, policy: ThrottlePolicy, now: number) {
    await AuthThrottle.updateOne(
        { key },
        {
            $set: {
                count: state.count,
                windowStart: new Date(state.windowStart),
                lockedUntil: state.lockedUntil ? new Date(state.lockedUntil) : null,
                strikes: state.strikes,
                expiresAt: new Date(now + stateTtlMs(state, policy, now)),
            },
        },
        { upsert: true },
    );
}

export type ThrottleCheck = { locked: false } | { locked: true; retryAfterMs: number };

// Is any of the given (scope, subject) pairs currently locked?
export async function checkThrottle(
    entries: Array<{ scope: string; subject: string }>,
): Promise<ThrottleCheck> {
    await connectToDatabase();
    const now = Date.now();
    let worst = 0;
    for (const { scope, subject } of entries) {
        const state = await readState(throttleKey(scope, subject), now);
        if (isLocked(state, now)) worst = Math.max(worst, retryAfterMs(state, now));
    }
    return worst > 0 ? { locked: true, retryAfterMs: worst } : { locked: false };
}

export async function recordThrottleFailure(scope: string, subject: string, policy: ThrottlePolicy) {
    await connectToDatabase();
    const now = Date.now();
    const key = throttleKey(scope, subject);
    const next = recordFailure(await readState(key, now), policy, now);
    await writeState(key, next, policy, now);
}

export async function clearThrottle(scope: string, subject: string) {
    await connectToDatabase();
    await AuthThrottle.deleteOne({ key: throttleKey(scope, subject) });
}
