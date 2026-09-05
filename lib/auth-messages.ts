// Maps an AuthActionResult failure to a localized toast; shared by the
// sign-in / sign-up / forgot-password forms so the copy stays in one place.
import type { AuthActionResult } from '@/lib/actions/auth.actions';
import { retryAfterMinutes } from '@/lib/auth-throttle-math';

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function describeAuthFailure(
    result: Exclude<AuthActionResult, { success: true }>,
    t: Translate,
    fallbackKey: string,
): string {
    switch (result.code) {
        case 'throttled':
            return t('errorThrottled', { minutes: retryAfterMinutes(result.retryAfterMs) });
        case 'captcha':
            return t('errorCaptcha');
        case 'invalid':
            return t('errorInvalid');
        case 'exists':
            return t('errorExists');
        case 'unconfigured':
            return t('errorUnconfigured');
        case 'pending':
            return t('errorPending');
        case 'rejected':
            return t('errorRejected');
        default:
            return t(fallbackKey);
    }
}
