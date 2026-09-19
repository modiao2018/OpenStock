import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the AiProfile collection
const rows = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock('@/database/mongoose', () => ({ connectToDatabase: async () => undefined }));
vi.mock('@/database/models/ai-profile.model', () => ({
    AiProfile: {
        find: (q: { key: { $in: string[] } }) => ({
            lean: async () => q.key.$in.filter((k) => rows.has(k)).map((k) => rows.get(k)),
        }),
        findOne: (q: { key: string }) => ({ lean: async () => rows.get(q.key) ?? null }),
        updateOne: async ({ key }: { key: string }, { $set }: { $set: Record<string, unknown> }) => {
            rows.set(key, { key, ...(rows.get(key) ?? {}), ...$set });
        },
    },
}));

const resolveLlmConfigMock = vi.fn();
vi.mock('@/lib/llm-config', () => ({ resolveLlmConfig: (...a: unknown[]) => resolveLlmConfigMock(...a) }));
const callAIMock = vi.fn();
vi.mock('@/lib/ai-provider', () => ({ callAIProviderWithConfig: (...a: unknown[]) => callAIMock(...a) }));

import { readProfiles, refreshProfile, type ProfileSources } from '@/lib/ai-profiles';
import { PROFILE_MARKET_FRESH_MS, PROFILE_TEXT_FRESH_MS } from '@/lib/ai-profile-math';

const CFG = { provider: 'gemini', apiKey: 'k', baseUrl: 'b', model: 'm' };
const GOOD_REPLY = JSON.stringify({
    aiRole: 'role', summary: 'sum',
    density: { score: 5, note: 'd' }, maturity: { score: 4, note: 'm' }, potential: { score: 3, note: 'p' }, results: { score: 2, note: 'r' },
    highlights: ['h1'], capitalNote: 'cap', stance: 'bullish',
});

function sources(): ProfileSources & { fetchMetrics: ReturnType<typeof vi.fn>; fetchQuoteAndCap: ReturnType<typeof vi.fn> } {
    return {
        fetchMetrics: vi.fn(async () => ({ metric: { peTTM: 30, '52WeekHigh': 20, '52WeekLow': 10 } })),
        fetchQuoteAndCap: vi.fn(async () => ({ price: 15, marketCapUsdM: 1000 })),
        fetchIdentity: vi.fn(async () => ({ name: 'Nvidia', industry: 'Semis' })),
    };
}

const storedRow = (ageTextMs: number, ageMarketMs: number) => ({
    key: 'NVDA|zh-CN', symbol: 'NVDA', lang: 'zh-CN', aiRole: 'old role', summary: 'old',
    density: { score: 1, note: '' }, maturity: { score: 1, note: '' }, potential: { score: 1, note: '' }, results: { score: 1, note: '' },
    highlights: [], capitalNote: '', stance: 'neutral', llmModel: 'x', generatedAt: new Date(Date.now() - ageTextMs),
    market: { price: 1, marketCapUsdM: 1, peTtm: 1, psTtm: null, beta: null, high52: null, low52: null, high52Date: null, low52Date: null,
        ret13w: null, ret26w: null, ret52w: null, retYtd: null, revenueGrowthTtm: null, netMarginTtm: null, fetchedAt: new Date(Date.now() - ageMarketMs) },
});

describe('ai-profiles', () => {
    beforeEach(() => {
        rows.clear();
        resolveLlmConfigMock.mockReset().mockResolvedValue(CFG);
        callAIMock.mockReset().mockResolvedValue(GOOD_REPLY);
    });
    afterEach(() => vi.restoreAllMocks());

    it('generates, persists and returns a new card; prompt carries the market data', async () => {
        const s = sources();
        const out = await refreshProfile('nvda', 'zh-CN', s);
        expect(out.status).toBe('ok');
        expect(out.profile?.symbol).toBe('NVDA');
        expect(out.profile?.density.score).toBe(5);
        expect(out.profile?.market?.peTtm).toBe(30);
        expect(out.profile?.market?.price).toBe(15);
        expect(out.profile?.model).toBe('gemini/m');
        expect(callAIMock.mock.calls[0][0]).toContain('P/E (TTM) 30.0');
        expect(callAIMock.mock.calls[0][0]).toContain('NVDA (Nvidia), industry: Semis');
        expect(rows.has('NVDA|zh-CN')).toBe(true);
        const read = await readProfiles(['NVDA'], 'zh-CN');
        expect(read.get('NVDA')?.aiRole).toBe('role');
        expect(await readProfiles(['NVDA'], 'en')).toEqual(new Map());
    });

    it('serves a fully fresh row with no upstream work', async () => {
        rows.set('NVDA|zh-CN', storedRow(1000, 1000));
        const s = sources();
        const out = await refreshProfile('NVDA', 'zh-CN', s);
        expect(out.status).toBe('ok');
        expect(out.profile?.aiRole).toBe('old role');
        expect(s.fetchMetrics).not.toHaveBeenCalled();
        expect(callAIMock).not.toHaveBeenCalled();
    });

    it('refreshes only the market block when the text is still fresh', async () => {
        rows.set('NVDA|zh-CN', storedRow(1000, PROFILE_MARKET_FRESH_MS + 1000));
        const s = sources();
        const out = await refreshProfile('NVDA', 'zh-CN', s);
        expect(out.status).toBe('ok');
        expect(out.profile?.aiRole).toBe('old role');
        expect(out.profile?.market?.peTtm).toBe(30);
        expect(callAIMock).not.toHaveBeenCalled();
        expect((rows.get('NVDA|zh-CN')?.market as { peTtm: number }).peTtm).toBe(30);
    });

    it('rewrites the text when it is a month old, and when forced', async () => {
        rows.set('NVDA|zh-CN', storedRow(PROFILE_TEXT_FRESH_MS + 1000, 1000));
        const s = sources();
        const out = await refreshProfile('NVDA', 'zh-CN', s);
        expect(out.profile?.aiRole).toBe('role');
        expect(s.fetchMetrics).not.toHaveBeenCalled(); // market was fresh
        expect(callAIMock).toHaveBeenCalledTimes(1);

        callAIMock.mockClear();
        await refreshProfile('NVDA', 'zh-CN', s, { force: true });
        expect(callAIMock).toHaveBeenCalledTimes(1);
    });

    it('reports noLlm but still keeps the fresh numbers', async () => {
        resolveLlmConfigMock.mockResolvedValue(null);
        rows.set('NVDA|zh-CN', storedRow(PROFILE_TEXT_FRESH_MS + 1000, PROFILE_MARKET_FRESH_MS + 1000));
        const out = await refreshProfile('NVDA', 'zh-CN', sources());
        expect(out.status).toBe('noLlm');
        expect(out.profile?.aiRole).toBe('old role');
        expect(out.profile?.market?.peTtm).toBe(30);

        rows.clear();
        const empty = await refreshProfile('AMD', 'zh-CN', sources());
        expect(empty).toEqual({ status: 'noLlm', profile: null });
    });

    it('reports failed on an unusable reply and does not persist a card', async () => {
        callAIMock.mockResolvedValue('nonsense');
        const out = await refreshProfile('NVDA', 'zh-CN', sources());
        expect(out).toEqual({ status: 'failed', profile: null });
        expect(rows.has('NVDA|zh-CN')).toBe(false);
    });

    it('shares one in-flight generation between concurrent callers', async () => {
        let release: (v: string) => void = () => undefined;
        callAIMock.mockImplementation(() => new Promise<string>((r) => (release = r)));
        const s = sources();
        const a = refreshProfile('NVDA', 'zh-CN', s);
        const b = refreshProfile('NVDA', 'zh-CN', s);
        await new Promise((r) => setTimeout(r, 0));
        release(GOOD_REPLY);
        const [ra, rb] = await Promise.all([a, b]);
        expect(ra.status).toBe('ok');
        expect(rb).toBe(ra);
        expect(callAIMock).toHaveBeenCalledTimes(1);
    });
});
