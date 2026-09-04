import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the CompanyProfile collection
const rows = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock('@/database/mongoose', () => ({ connectToDatabase: async () => undefined }));
vi.mock('@/database/models/company-profile.model', () => ({
    CompanyProfile: {
        find: (q: { symbol: { $in: string[] } }) => ({
            lean: async () => q.symbol.$in.filter((s) => rows.has(s)).map((s) => rows.get(s)),
        }),
        updateOne: async ({ symbol }: { symbol: string }, { $set }: { $set: Record<string, unknown> }) => {
            rows.set(symbol, { symbol, ...(rows.get(symbol) ?? {}), ...$set });
        },
    },
}));

import { isProfileFresh, PROFILE_FRESH_MS, readStoredProfiles, resolveProfiles } from '@/lib/company-profiles';

const flush = () => new Promise((r) => setTimeout(r, 0));
const row = (symbol: string, ageMs: number) => ({
    symbol, name: `${symbol} stored`, ticker: symbol, currency: 'USD', exchange: 'US', logo: '',
    marketCapitalization: 500, finnhubIndustry: 'Tech', fetchedAt: new Date(Date.now() - ageMs),
});

describe('company-profiles', () => {
    beforeEach(() => { rows.clear(); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('isProfileFresh is a one-day window', () => {
        expect(isProfileFresh({ fetchedAt: new Date(Date.now() - PROFILE_FRESH_MS + 1000) })).toBe(true);
        expect(isProfileFresh({ fetchedAt: new Date(Date.now() - PROFILE_FRESH_MS - 1000) })).toBe(false);
    });

    it('serves fresh stored rows without calling upstream', async () => {
        rows.set('AAPL', row('AAPL', 60_000));
        const fetchOne = vi.fn(async () => ({ name: 'should not be used' }));
        const out = await resolveProfiles(['AAPL'], fetchOne);
        expect(out.get('AAPL')?.name).toBe('AAPL stored');
        expect(fetchOne).not.toHaveBeenCalled();
    });

    it('fetches missing symbols, normalizes blanks, and persists the row', async () => {
        const fetchOne = vi.fn(async () => ({ name: 'Nvidia', marketCapitalization: 3000 }));
        const out = await resolveProfiles(['NVDA'], fetchOne);
        expect(out.get('NVDA')).toMatchObject({ symbol: 'NVDA', name: 'Nvidia', marketCapitalization: 3000, currency: '', finnhubIndustry: '' });
        await flush();
        expect((await readStoredProfiles(['NVDA'])).get('NVDA')?.name).toBe('Nvidia');
    });

    it('refreshes a stale row, and falls back to it when the fetch throws', async () => {
        rows.set('AAPL', row('AAPL', PROFILE_FRESH_MS + 1));
        rows.set('MSFT', row('MSFT', PROFILE_FRESH_MS + 1));
        const fetchOne = vi.fn(async (symbol: string) => {
            if (symbol === 'MSFT') throw new Error('rate limited');
            return { name: 'Apple' };
        });
        const out = await resolveProfiles(['AAPL', 'MSFT'], fetchOne);
        expect(out.get('AAPL')?.name).toBe('Apple');
        expect(out.get('MSFT')?.name).toBe('MSFT stored');
        expect(fetchOne).toHaveBeenCalledTimes(2);
    });

    it('omits symbols with neither a row nor an upstream answer', async () => {
        const out = await resolveProfiles(['ZZZZ'], async () => null);
        expect(out.has('ZZZZ')).toBe(false);
    });

    it('accepts a pre-read store so callers can budget before resolving', async () => {
        rows.set('AAPL', row('AAPL', 0));
        const stored = await readStoredProfiles(['AAPL', 'MSFT']);
        expect([...stored.keys()]).toEqual(['AAPL']);
        const fetchOne = vi.fn(async () => ({ name: 'Microsoft' }));
        const out = await resolveProfiles(['AAPL', 'MSFT'], fetchOne, stored);
        expect(fetchOne).toHaveBeenCalledTimes(1);
        expect(out.get('MSFT')?.name).toBe('Microsoft');
    });
});
