import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getStockSentimentInsights,
} from '@/lib/actions/adanos.actions';
import * as store from '@/lib/adanos-store';
import {
    buildStockSentimentInsights,
    getSourceAlignment,
    normalizeSourceInsight,
} from '@/lib/actions/adanos.helpers';

afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ADANOS_API_KEY;
    delete process.env.ADANOS_API_BASE_URL;
    delete process.env.ADANOS_SOURCES;
    delete process.env.ADANOS_CACHE_HOURS;
    delete process.env.ADANOS_QUOTA_RESERVE;
});

describe('normalizeSourceInsight', () => {
    it('maps source-specific metrics for mentions and trades', () => {
        const reddit = normalizeSourceInsight('reddit', {
            ticker: 'TSLA',
            buzz_score: 81.2,
            bullish_pct: 46,
            trend: 'rising',
            mentions: 647,
        });

        const polymarket = normalizeSourceInsight('polymarket', {
            ticker: 'TSLA',
            buzz_score: 55.7,
            bullish_pct: 72,
            trend: 'stable',
            trade_count: 3731,
        });

        expect(reddit).toMatchObject({
            label: 'reddit',
            companyName: null,
            metricLabel: 'mentions',
            metricValue: 647,
            buzzScore: 81.2,
            bullishPct: 46,
        });
        expect(polymarket).toMatchObject({
            label: 'polymarket',
            companyName: null,
            metricLabel: 'trades',
            metricValue: 3731,
            buzzScore: 55.7,
            bullishPct: 72,
        });
    });

    it('returns null when required values are missing', () => {
        expect(
            normalizeSourceInsight('x', {
                ticker: 'NVDA',
                bullish_pct: 54,
                mentions: 1200,
            }),
        ).toBeNull();

        expect(
            normalizeSourceInsight('news', {
                ticker: 'NVDA',
                buzz_score: 60,
                bullish_pct: 54,
            }),
        ).toBeNull();
    });
});

describe('getSourceAlignment', () => {
    it('classifies wide divergence when sources materially disagree', () => {
        expect(getSourceAlignment([31, 56, 48, 30])).toBe('wideDivergence');
    });

    it('classifies bullish alignment when sources are tightly aligned and positive', () => {
        expect(getSourceAlignment([61, 64, 67])).toBe('bullishAlignment');
    });
});

describe('buildStockSentimentInsights', () => {
    it('builds a compact aggregate summary from available sources', () => {
        const insight = buildStockSentimentInsights('TSLA', [
            {
                source: 'reddit',
                label: 'reddit',
                companyName: 'Tesla, Inc.',
                buzzScore: 74.1,
                bullishPct: 31,
                trend: 'rising',
                metricLabel: 'mentions',
                metricValue: 647,
            },
            {
                source: 'x',
                label: 'x',
                companyName: 'Tesla, Inc.',
                buzzScore: 86.1,
                bullishPct: 56,
                trend: 'falling',
                metricLabel: 'mentions',
                metricValue: 2650,
            },
            {
                source: 'polymarket',
                label: 'polymarket',
                companyName: 'Tesla, Inc.',
                buzzScore: 83.3,
                bullishPct: 30,
                trend: 'falling',
                metricLabel: 'trades',
                metricValue: 3731,
            },
            null,
        ]);

        expect(insight).toMatchObject({
            symbol: 'TSLA',
            companyName: 'Tesla, Inc.',
            averageBuzz: 81.2,
            bullishAverage: 39,
            sourceAlignment: 'wideDivergence',
            availableSources: 3,
        });
        expect(insight?.sources).toHaveLength(3);
    });

    it('returns null when no sources have usable data', () => {
        expect(buildStockSentimentInsights('MSFT', [null, null])).toBeNull();
    });
});

const okStock = (over: Record<string, unknown> = {}) =>
    new Response(
        JSON.stringify({ stocks: [{ ticker: 'TSLA', company_name: 'Tesla, Inc.', buzz_score: 80, bullish_pct: 40, trend: 'rising', mentions: 10, trade_count: 10, ...over }] }),
        { status: 200, headers: { 'x-ratelimit-limit-monthly': '250', 'x-ratelimit-remaining-monthly': '200', 'x-ratelimit-used-monthly': '50', 'x-ratelimit-reset-monthly': '2099-01-01T00:00:00Z' } },
    );

describe('getStockSentimentInsights snapshot cache and quota', () => {
    beforeEach(() => {
        process.env.ADANOS_API_KEY = 'test-key';
        vi.spyOn(store, 'writeQuota').mockResolvedValue();
        vi.spyOn(store, 'writeSnapshot').mockResolvedValue();
    });

    it('serves a fresh snapshot without touching upstream', async () => {
        const fetchSpy = vi.spyOn(global, 'fetch');
        vi.spyOn(store, 'readSnapshot').mockResolvedValue({
            insights: { symbol: 'TSLA', companyName: null, averageBuzz: 1, bullishAverage: null, sourceAlignment: 'noSentimentMix', availableSources: 1, sources: [] },
            sources: ['reddit', 'x', 'news', 'polymarket'],
            fetchedAt: Date.now() - 3600_000,
        });
        vi.spyOn(store, 'readQuota').mockResolvedValue(null);

        const insight = await getStockSentimentInsights('tsla');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(insight).toMatchObject({ symbol: 'TSLA', requestedSources: 4 });
        expect(insight?.fetchedAt).toBeTypeOf('number');
    });

    it('refetches when the snapshot is older than ADANOS_CACHE_HOURS and stores the quota', async () => {
        process.env.ADANOS_CACHE_HOURS = '1';
        const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => okStock());
        vi.spyOn(store, 'readSnapshot').mockResolvedValue({ insights: null, sources: ['reddit', 'x', 'news', 'polymarket'], fetchedAt: Date.now() - 2 * 3600_000 });
        vi.spyOn(store, 'readQuota').mockResolvedValue(null);

        const insight = await getStockSentimentInsights('TSLA');
        expect(fetchSpy).toHaveBeenCalledTimes(4);
        expect(insight).toMatchObject({ symbol: 'TSLA', availableSources: 4, requestedSources: 4 });
        expect(store.writeQuota).toHaveBeenCalledWith(expect.objectContaining({ limit: 250, remaining: 200 }));
        expect(store.writeSnapshot).toHaveBeenCalledWith('TSLA', expect.objectContaining({ sources: ['reddit', 'x', 'news', 'polymarket'] }));
        // The Next data cache must not mask the Mongo snapshot
        expect(fetchSpy.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
    });

    it('refetches when ADANOS_SOURCES asks for a source the snapshot lacks', async () => {
        process.env.ADANOS_SOURCES = 'news,reddit';
        const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => okStock());
        vi.spyOn(store, 'readSnapshot').mockResolvedValue({ insights: null, sources: ['news'], fetchedAt: Date.now() });
        vi.spyOn(store, 'readQuota').mockResolvedValue(null);

        const insight = await getStockSentimentInsights('TSLA');
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(fetchSpy.mock.calls.map((c) => String(c[0]))).toEqual([
            expect.stringContaining('/reddit/'),
            expect.stringContaining('/news/'),
        ]);
        expect(insight).toMatchObject({ availableSources: 2, requestedSources: 2 });
    });

    it('serves the stale snapshot instead of spending the quota reserve', async () => {
        const fetchSpy = vi.spyOn(global, 'fetch');
        const stale = { insights: { symbol: 'TSLA', companyName: null, averageBuzz: 5, bullishAverage: null, sourceAlignment: 'noSentimentMix' as const, availableSources: 1, sources: [] }, sources: ['reddit', 'x', 'news', 'polymarket'], fetchedAt: Date.now() - 10 * 86400_000 };
        vi.spyOn(store, 'readSnapshot').mockResolvedValue(stale);
        vi.spyOn(store, 'readQuota').mockResolvedValue({ limit: 250, remaining: 8, used: 242, resetAt: Date.now() + 86400_000, at: Date.now() });

        const insight = await getStockSentimentInsights('TSLA');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(insight).toMatchObject({ averageBuzz: 5, fetchedAt: stale.fetchedAt });
    });

    it('returns null for an unknown symbol once the quota reserve is reached', async () => {
        const fetchSpy = vi.spyOn(global, 'fetch');
        vi.spyOn(store, 'readSnapshot').mockResolvedValue(null);
        vi.spyOn(store, 'readQuota').mockResolvedValue({ limit: 250, remaining: 0, used: 250, resetAt: Date.now() + 86400_000, at: Date.now() });

        await expect(getStockSentimentInsights('TSLA')).resolves.toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('keeps the stale snapshot and does not overwrite it when every source fails', async () => {
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{"detail":"quota"}', { status: 429 }));
        const stale = { insights: { symbol: 'TSLA', companyName: null, averageBuzz: 5, bullishAverage: null, sourceAlignment: 'noSentimentMix' as const, availableSources: 1, sources: [] }, sources: ['reddit', 'x', 'news', 'polymarket'], fetchedAt: Date.now() - 2 * 86400_000 };
        vi.spyOn(store, 'readSnapshot').mockResolvedValue(stale);
        vi.spyOn(store, 'readQuota').mockResolvedValue(null);

        const insight = await getStockSentimentInsights('TSLA');
        expect(insight).toMatchObject({ averageBuzz: 5 });
        expect(store.writeSnapshot).not.toHaveBeenCalled();
    });

    it('caches an all-404 answer so unknown tickers are not retried every render', async () => {
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
        vi.spyOn(store, 'readSnapshot').mockResolvedValue(null);
        vi.spyOn(store, 'readQuota').mockResolvedValue(null);

        await expect(getStockSentimentInsights('ZZZZ')).resolves.toBeNull();
        expect(store.writeSnapshot).toHaveBeenCalledWith('ZZZZ', expect.objectContaining({ insights: null }));
    });

    it('coalesces concurrent renders of the same symbol into one upstream round-trip', async () => {
        const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => okStock());
        vi.spyOn(store, 'readSnapshot').mockResolvedValue(null);
        vi.spyOn(store, 'readQuota').mockResolvedValue(null);

        const [a, b] = await Promise.all([getStockSentimentInsights('TSLA'), getStockSentimentInsights('TSLA')]);
        expect(fetchSpy).toHaveBeenCalledTimes(4);
        expect(a).toEqual(b);
    });
});

describe('getStockSentimentInsights', () => {
    beforeEach(() => {
        // No MONGODB_URI in unit tests, so the store is a no-op; pin it anyway
        vi.spyOn(store, 'readSnapshot').mockResolvedValue(null);
        vi.spyOn(store, 'readQuota').mockResolvedValue(null);
        vi.spyOn(store, 'writeQuota').mockResolvedValue();
        vi.spyOn(store, 'writeSnapshot').mockResolvedValue();
    });

    it('returns a parsed result when compare data matches the requested ticker', async () => {
        process.env.ADANOS_API_KEY = 'test-key';
        vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/reddit/')) {
                return new Response(
                    JSON.stringify({
                        stocks: [{ ticker: 'TSLA', company_name: 'Tesla, Inc.', buzz_score: 80, bullish_pct: 40, trend: 'rising', mentions: 10 }],
                    }),
                    { status: 200 },
                );
            }

            if (url.includes('/x/')) {
                return new Response(
                    JSON.stringify({
                        stocks: [{ ticker: 'TSLA', company_name: 'Tesla, Inc.', buzz_score: 90, bullish_pct: 60, trend: 'falling', mentions: 20 }],
                    }),
                    { status: 200 },
                );
            }

            return new Response(JSON.stringify({ stocks: [] }), { status: 404 });
        });

        const insight = await getStockSentimentInsights('TSLA');

        expect(insight).toMatchObject({
            symbol: 'TSLA',
            companyName: 'Tesla, Inc.',
            averageBuzz: 85,
            bullishAverage: 50,
            availableSources: 2,
        });
        expect(insight?.sources).toHaveLength(2);
    });

    it('returns null when the remote source returns 404 for all sources', async () => {
        process.env.ADANOS_API_KEY = 'test-key';
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));

        await expect(getStockSentimentInsights('TSLA')).resolves.toBeNull();
    });

    it('returns null when the remote payload contains a different ticker only', async () => {
        process.env.ADANOS_API_KEY = 'test-key';
        vi.spyOn(global, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({
                    stocks: [{ ticker: 'MSFT', company_name: 'Microsoft Corporation', buzz_score: 70, bullish_pct: 55, trend: 'stable', mentions: 30 }],
                }),
                { status: 200 },
            ),
        );

        await expect(getStockSentimentInsights('TSLA')).resolves.toBeNull();
    });

    it('returns null when the response body is invalid json', async () => {
        process.env.ADANOS_API_KEY = 'test-key';
        vi.spyOn(global, 'fetch').mockResolvedValue({
            status: 200,
            ok: true,
            json: vi.fn().mockRejectedValue(new Error('invalid json')),
        } as unknown as Response);

        await expect(getStockSentimentInsights('TSLA')).resolves.toBeNull();
    });

    it('returns null when fetch fails', async () => {
        process.env.ADANOS_API_KEY = 'test-key';
        vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network failed'));

        await expect(getStockSentimentInsights('TSLA')).resolves.toBeNull();
    });
});
