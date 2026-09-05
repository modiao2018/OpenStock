'use server';

import { getClientIp, checkThrottle, recordThrottleFailure } from '@/lib/auth-throttle';
import { issueChallenge, judgeChallenge, type CaptchaChallengePayload, type SolveResult } from '@/lib/captcha/server';
import type { ThrottlePolicy } from '@/lib/auth-throttle-math';

// Puzzle issuance is itself throttled per IP so a script cannot mine
// thousands of (background, piece) pairs to train an offline solver.
const CAPTCHA_ISSUE_POLICY: ThrottlePolicy = {
    maxFailures: 60,
    windowMs: 10 * 60 * 1000,
    baseLockMs: 10 * 60 * 1000,
    maxLockMs: 60 * 60 * 1000,
};

export type CaptchaChallengeResult =
    | { success: true; challenge: CaptchaChallengePayload }
    | { success: false; error: 'throttled' | 'unavailable' };

export const requestCaptchaChallenge = async (): Promise<CaptchaChallengeResult> => {
    try {
        const ip = await getClientIp();
        const gate = await checkThrottle([{ scope: 'captcha:ip', subject: ip }]);
        if (gate.locked) return { success: false, error: 'throttled' };
        // every issuance counts toward the cap; it is a rate, not a failure count
        await recordThrottleFailure('captcha:ip', ip, CAPTCHA_ISSUE_POLICY);
        const challenge = await issueChallenge(ip);
        return { success: true, challenge };
    } catch (e) {
        console.error('captcha issue failed', e);
        return { success: false, error: 'unavailable' };
    }
};

export const submitCaptchaSolution = async (
    input: { id: string; x: number; trail: Array<{ t: number; x: number; y: number }> },
): Promise<SolveResult> => {
    try {
        if (!input || typeof input.id !== 'string') return { ok: false, reason: 'expired' };
        return await judgeChallenge(input.id, input.x, input.trail);
    } catch (e) {
        console.error('captcha judge failed', e);
        return { ok: false, reason: 'expired' };
    }
};
