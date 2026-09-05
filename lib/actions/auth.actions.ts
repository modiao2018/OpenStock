'use server';

import { AUTH_ERROR_PENDING, AUTH_ERROR_REJECTED, auth } from "@/lib/better-auth/auth";
import { inngest } from "@/lib/inngest/client";
import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { consumeCaptchaToken } from "@/lib/captcha/server";
import { isAdminEmail } from "@/lib/admin";
import { notifyReviewersOfPendingSignUp } from "@/lib/admin-notify";
import { connectToDatabase } from "@/database/mongoose";
import {
    checkThrottle,
    clearThrottle,
    getClientIp,
    normalizeEmail,
    recordThrottleFailure,
} from "@/lib/auth-throttle";
import {
    RESET_EMAIL_POLICY,
    RESET_IP_POLICY,
    SIGN_IN_EMAIL_POLICY,
    SIGN_IN_IP_POLICY,
    SIGN_UP_IP_POLICY,
} from "@/lib/auth-throttle-math";

// Fires the personalized welcome email; failures are logged, never surfaced
export const sendWelcomeEvent = async (
    data: { email: string; name: string; country?: string; investmentGoals?: string; riskTolerance?: string; preferredIndustry?: string },
) => {
    try {
        console.log('📤 Sending Inngest event: app/user.created for', data.email);
        await inngest.send({ name: 'app/user.created', data });
        console.log('✅ Inngest event sent successfully');
    } catch (error) {
        console.error('❌ Failed to send Inngest event:', error);
    }
};

// Machine-readable outcome; the client maps `code` to a localized message.
export type AuthActionResult =
    | { success: true }
    // sign-up succeeded but the account waits for manual review
    | { success: true; pendingApproval: true }
    | { success: false; code: 'captcha' | 'invalid' | 'exists' | 'generic' | 'unconfigured' | 'pending' | 'rejected' }
    | { success: false; code: 'throttled'; retryAfterMs: number };

const apiErrorCode = (e: unknown): string | undefined =>
    e instanceof APIError ? (e.body as { code?: string } | undefined)?.code : undefined;

export const signUpWithEmail = async (
    { email, password, fullName, country, investmentGoals, riskTolerance, preferredIndustry, captchaToken }: SignUpFormData,
): Promise<AuthActionResult> => {
    const ip = await getClientIp();

    const gate = await checkThrottle([{ scope: 'signup:ip', subject: ip }]);
    if (gate.locked) return { success: false, code: 'throttled', retryAfterMs: gate.retryAfterMs };

    if (!(await consumeCaptchaToken(captchaToken))) return { success: false, code: 'captcha' };
    // every accepted attempt counts: sign-up is a write, not a guess
    await recordThrottleFailure('signup:ip', ip, SIGN_UP_IP_POLICY);

    try {
        const response = await auth.api.signUpEmail({ body: { email, password, name: fullName } })

        if (response) {
            const profile = { country, investmentGoals, riskTolerance, preferredIndustry };
            // The investor profile only feeds the welcome email; keep it on the
            // user doc so approval (which may be days later) can still send it.
            try {
                const db = (await connectToDatabase()).connection.db;
                await db?.collection('user').updateOne({ email }, { $set: { profile } });
            } catch (error) {
                console.error('Failed to store sign-up profile:', error);
            }

            if (isAdminEmail(email)) {
                // reviewers are approved on creation: welcome them right away
                void sendWelcomeEvent({ email, name: fullName, ...profile });
            } else {
                const base = process.env.BETTER_AUTH_URL || 'http://localhost:3000';
                void notifyReviewersOfPendingSignUp({ name: fullName, email, reviewUrl: `${base}/admin/users` });
            }
        }

        // autoSignIn is off: no cookie was issued, the account is pending review
        return { success: true, pendingApproval: true }
    } catch (e) {
        console.log('Sign up failed', apiErrorCode(e) ?? e)
        const code = apiErrorCode(e);
        if (code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
            return { success: false, code: 'exists' }
        }
        return { success: false, code: 'generic' }
    }
}

export const signInWithEmail = async ({ email, password, captchaToken }: SignInFormData): Promise<AuthActionResult> => {
    const ip = await getClientIp();
    const emailKey = normalizeEmail(email);

    const gate = await checkThrottle([
        { scope: 'signin:email', subject: emailKey },
        { scope: 'signin:ip', subject: ip },
    ]);
    if (gate.locked) return { success: false, code: 'throttled', retryAfterMs: gate.retryAfterMs };

    if (!(await consumeCaptchaToken(captchaToken))) return { success: false, code: 'captcha' };

    try {
        const response = await auth.api.signInEmail({ body: { email, password } })

        // Update lastActiveAt
        if (response) {
            try {
                // Dynamic import or ensure path is correct
                const { connectToDatabase } = await import("@/database/mongoose");
                const mongoose = await connectToDatabase();
                const db = mongoose.connection.db;
                if (db) {
                    await db.collection('user').updateOne(
                        { email },
                        { $set: { lastActiveAt: new Date() } }
                    );
                }
            } catch (err) {
                console.error("Failed to update lastActiveAt", err);
            }
        }

        await clearThrottle('signin:email', emailKey);
        return { success: true }
    } catch (e) {
        const code = apiErrorCode(e);
        console.log('Sign in failed', code ?? e)
        // The password was right; the account just is not approved yet. Not a
        // guess, so it does not count toward the lockout.
        if (code === AUTH_ERROR_PENDING) return { success: false, code: 'pending' }
        if (code === AUTH_ERROR_REJECTED) return { success: false, code: 'rejected' }
        // Wrong password and unknown email both count; the response never says which
        await Promise.all([
            recordThrottleFailure('signin:email', emailKey, SIGN_IN_EMAIL_POLICY),
            recordThrottleFailure('signin:ip', ip, SIGN_IN_IP_POLICY),
        ]);
        return { success: false, code: e instanceof APIError ? 'invalid' : 'generic' }
    }
}

export const requestPasswordResetEmail = async (
    { email, captchaToken }: { email: string; captchaToken?: string },
): Promise<AuthActionResult> => {
    if (!process.env.NODEMAILER_EMAIL || !process.env.NODEMAILER_PASSWORD) {
        return { success: false, code: 'unconfigured' }
    }

    const ip = await getClientIp();
    const emailKey = normalizeEmail(email);

    const gate = await checkThrottle([
        { scope: 'reset:email', subject: emailKey },
        { scope: 'reset:ip', subject: ip },
    ]);
    if (gate.locked) return { success: false, code: 'throttled', retryAfterMs: gate.retryAfterMs };

    if (!(await consumeCaptchaToken(captchaToken))) return { success: false, code: 'captcha' };
    // Each request sends a mail (or would): count it whether or not the account exists
    await Promise.all([
        recordThrottleFailure('reset:email', emailKey, RESET_EMAIL_POLICY),
        recordThrottleFailure('reset:ip', ip, RESET_IP_POLICY),
    ]);

    try {
        const configuredBaseUrl = process.env.BETTER_AUTH_URL;
        const baseUrl = configuredBaseUrl || (
            process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : null
        );

        if (!baseUrl) {
            console.error('BETTER_AUTH_URL must be configured before password reset emails can be sent.');
            return { success: false, code: 'unconfigured' }
        }

        await auth.api.requestPasswordReset({
            body: {
                email,
                redirectTo: `${baseUrl}/reset-password`,
            },
        });

        return { success: true }
    } catch (e) {
        console.log('Password reset request failed', e)
        return { success: false, code: 'generic' }
    }
}

export const resetPasswordWithToken = async (
    { token, newPassword }: { token: string; newPassword: string }
) => {
    try {
        await auth.api.resetPassword({
            body: {
                token,
                newPassword,
            },
        });

        return { success: true }
    } catch (e) {
        console.log('Password reset failed', e)
        return { success: false, error: 'Reset link is invalid or expired.' }
    }
}

export const signOut = async () => {
    try {
        await auth.api.signOut({ headers: await headers() });
    } catch (e) {
        console.log('Sign out failed', e)
        return { success: false, error: 'Sign out failed' }
    }
}
