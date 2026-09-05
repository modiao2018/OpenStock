import { describe, expect, it } from 'vitest';

import {
    formatQuota,
    isCacheFresh,
    parseQuotaHeaders,
    parseSourceList,
    pickTighterQuota,
    quotaExhausted,
    type AdanosQuota,
} from '@/lib/adanos-quota';

const headers = (map: Record<string, string>) => (name: string) => map[name.toLowerCase()] ?? null;

const q = (over: Partial<AdanosQuota> = {}): AdanosQuota => ({
    limit: 250, remaining: 100, used: 150, resetAt: Date.parse('2026-10-05T10:12:15Z'), at: 1_000, ...over,
});

describe('parseQuotaHeaders', () => {
    it('reads the monthly headers Adanos sends on metered calls', () => {
        const quota = parseQuotaHeaders(headers({
            'x-ratelimit-limit-monthly': '250',
            'x-ratelimit-remaining-monthly': '244',
            'x-ratelimit-used-monthly': '6',
            'x-ratelimit-reset-monthly': '2026-10-05T10:12:15Z',
        }), 5);
        expect(quota).toEqual({ limit: 250, remaining: 244, used: 6, resetAt: Date.parse('2026-10-05T10:12:15Z'), at: 5 });
    });

    it('derives used and tolerates a missing reset', () => {
        const quota = parseQuotaHeaders(headers({ 'x-ratelimit-limit-monthly': '250', 'x-ratelimit-remaining-monthly': '200' }));
        expect(quota).toMatchObject({ used: 50, resetAt: null });
    });

    it('returns null for unmetered responses', () => {
        expect(parseQuotaHeaders(headers({}))).toBeNull();
        expect(parseQuotaHeaders(headers({ 'x-ratelimit-limit-monthly': 'abc', 'x-ratelimit-remaining-monthly': '1' }))).toBeNull();
    });
});

describe('pickTighterQuota', () => {
    it('keeps the lowest remaining within one window', () => {
        expect(pickTighterQuota(q({ remaining: 100 }), q({ remaining: 97 }))?.remaining).toBe(97);
        expect(pickTighterQuota(q({ remaining: 97 }), q({ remaining: 100 }))?.remaining).toBe(97);
    });

    it('prefers the newer window after a monthly reset', () => {
        const old = q({ remaining: 3, resetAt: 1_000 });
        const fresh = q({ remaining: 249, resetAt: 2_000 });
        expect(pickTighterQuota(old, fresh)).toBe(fresh);
        expect(pickTighterQuota(fresh, old)).toBe(fresh);
    });

    it('handles nulls', () => {
        expect(pickTighterQuota(null, null)).toBeNull();
        expect(pickTighterQuota(q(), null)?.remaining).toBe(100);
    });
});

describe('quotaExhausted', () => {
    const reset = Date.parse('2026-10-05T10:12:15Z');

    it('is false with headroom or no information', () => {
        expect(quotaExhausted(null, 10)).toBe(false);
        expect(quotaExhausted(q({ remaining: 11 }), 10, reset - 1)).toBe(false);
    });

    it('is true at the reserve until the window resets', () => {
        expect(quotaExhausted(q({ remaining: 10 }), 10, reset - 1)).toBe(true);
        expect(quotaExhausted(q({ remaining: 0 }), 10, reset - 1)).toBe(true);
        expect(quotaExhausted(q({ remaining: 0 }), 10, reset)).toBe(false);
    });

    it('trusts a reset-less snapshot only for a while', () => {
        const snap = q({ remaining: 0, resetAt: null, at: 1_000 });
        expect(quotaExhausted(snap, 10, 1_000 + 86400_000)).toBe(true);
        expect(quotaExhausted(snap, 10, 1_000 + 8 * 86400_000)).toBe(false);
    });
});

describe('isCacheFresh', () => {
    it('compares against the ttl', () => {
        expect(isCacheFresh(1_000, 500, 1_400)).toBe(true);
        expect(isCacheFresh(new Date(1_000), 500, 1_500)).toBe(false);
        expect(isCacheFresh(Number.NaN, 500, 1_500)).toBe(false);
    });
});

describe('parseSourceList', () => {
    const all = ['reddit', 'x', 'news', 'polymarket'] as const;

    it('keeps canonical order and drops unknown names', () => {
        expect(parseSourceList('news, Reddit,bogus', all)).toEqual(['reddit', 'news']);
    });

    it('falls back to everything when empty or all-unknown', () => {
        expect(parseSourceList(undefined, all)).toEqual([...all]);
        expect(parseSourceList('bogus', all)).toEqual([...all]);
    });
});

describe('formatQuota', () => {
    it('renders remaining/limit with the reset day', () => {
        expect(formatQuota(q({ remaining: 244 }))).toBe('244/250 · reset 10/05');
        expect(formatQuota(q({ remaining: 244, resetAt: null }))).toBe('244/250');
        expect(formatQuota(null)).toBeNull();
    });
});
