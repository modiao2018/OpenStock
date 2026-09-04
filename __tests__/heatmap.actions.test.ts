import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeatmapStock } from '@/lib/actions/heatmap.actions';

// The action's rate-limit fallback is what's under test, so the gate, the
// Finnhub fetch layer and the Mongo snapshot store are all stubbed.
const gateState = vi.hoisted(() => ({ freeSlots: 100, memoized: new Set<string>() }));
const snapshotStore = vi.hoisted(() => new Map<string, { data: unknown; updatedAt: Date }>());
const upstream = vi.hoisted(() => ({ calls: [] as string[] }));
// Stand-in for the Mongo-backed profile store: symbol -> stored row
const profileStore = vi.hoisted(() => new Map<string, { symbol: string; name: string; ticker: string; currency: string; exchange: string; logo: string; marketCapitalization: number; finnhubIndustry: string; fetchedAt: Date }>());

vi.mock('@/lib/finnhub-gate', () => ({
    finnhubGate: { get freeSlots() { return gateState.freeSlots; } },
    isMemoized: (key: string) => gateState.memoized.has(key),
}));

vi.mock('@/lib/snapshot', () => ({
    snapshotKey: (prefix: string, symbols: string[]) => `${prefix}:${[...symbols].sort().join(',')}`,
    readSnapshot: async (key: string) => snapshotStore.get(key) ?? null,
    writeSnapshot: async (key: string, data: unknown) => { snapshotStore.set(key, { data, updatedAt: new Date() }); },
}));

vi.mock('@/lib/actions/finnhub.actions', () => ({
    fetchJSON: async (url: string) => {
        upstream.calls.push(url);
        const symbol = new URL(url).searchParams.get('symbol')!;
        if (url.includes('/quote')) return { c: 100, d: 1, dp: 1, o: 99, h: 101, l: 98, pc: 99, t: 1 };
        return { name: `${symbol} Inc`, currency: 'USD', marketCapitalization: 1000, finnhubIndustry: 'Technology' };
    },
}));

vi.mock('@/lib/market-cap', () => ({
    marketCapToUsdMillions: async (m: number) => m,
}));

// The real module minus Mongo: same resolve/fresh logic over the in-memory map
vi.mock('@/lib/company-profiles', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/company-profiles')>();
    const readStoredProfiles = async (symbols: string[]) =>
        new Map(symbols.filter((s) => profileStore.has(s)).map((s) => [s, profileStore.get(s)!]));
    return {
        ...actual,
        readStoredProfiles,
        resolveProfiles: async (
            symbols: string[],
            fetchOne: (s: string) => Promise<Record<string, unknown> | null>,
            stored?: Map<string, unknown>,
        ) => {
            const known = (stored as Map<string, ReturnType<typeof profileStore.get>>) ?? (await readStoredProfiles(symbols));
            const out = new Map();
            await Promise.all(symbols.map(async (symbol) => {
                const existing = known.get(symbol);
                if (existing && actual.isProfileFresh(existing)) { out.set(symbol, existing); return; }
                try {
                    const raw = await fetchOne(symbol);
                    if (raw) {
                        const fresh = { symbol, name: '', ticker: '', currency: '', exchange: '', logo: '', marketCapitalization: 0, finnhubIndustry: '', ...raw, fetchedAt: new Date() };
                        out.set(symbol, fresh);
                        profileStore.set(symbol, fresh);
                        return;
                    }
                } catch { /* fall through to stale */ }
                if (existing) out.set(symbol, existing);
            }));
            return out;
        },
    };
});

const storedProfile = (symbol: string, ageMs = 0) => ({
    symbol, name: `${symbol} stored`, ticker: symbol, currency: 'USD', exchange: 'US', logo: '',
    marketCapitalization: 2000, finnhubIndustry: 'Technology', fetchedAt: new Date(Date.now() - ageMs),
});

const tile = (symbol: string, over: Partial<HeatmapStock> = {}): HeatmapStock => ({
    symbol, name: `${symbol} old`, price: 50, changePercent: -1, change: -0.5, open: 50, high: 51, low: 49,
    prevClose: 50.5, marketCap: 1e9, industry: 'Technology', quoteTime: 0, ...over,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('getHeatmapData rate-limit fallback', () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_FINNHUB_API_KEY = 'test-token';
        gateState.freeSlots = 100;
        gateState.memoized.clear();
        snapshotStore.clear();
        profileStore.clear();
        upstream.calls.length = 0;
        vi.resetModules();
    });
    afterEach(() => {
        // Spies on the mocked fetchJSON survive vi.resetModules; drop them
        // so a test that makes MSFT fail does not leak into the next one
        vi.restoreAllMocks();
        delete process.env.NEXT_PUBLIC_FINNHUB_API_KEY;
    });

    async function load() {
        return (await import('@/lib/actions/heatmap.actions')).getHeatmapData;
    }

    it('fetches live and writes the snapshot when the sweep fits the free budget', async () => {
        const getHeatmapData = await load();
        const data = await getHeatmapData(['AAPL', 'MSFT']);
        expect(data.map((s) => s.symbol).sort()).toEqual(['AAPL', 'MSFT']);
        expect(upstream.calls).toHaveLength(4);
        await flush();
        expect(snapshotStore.get('heatmap:AAPL,MSFT')?.data).toHaveLength(2);
        // Profiles fetched live are persisted for the next cold start
        expect(profileStore.get('AAPL')?.name).toBe('AAPL Inc');
    });

    it('spends no upstream calls on profiles already stored and fresh', async () => {
        profileStore.set('AAPL', storedProfile('AAPL'));
        profileStore.set('MSFT', storedProfile('MSFT'));
        gateState.freeSlots = 2; // exactly the two quotes
        const getHeatmapData = await load();
        const data = await getHeatmapData(['AAPL', 'MSFT']);
        expect(data.map((s) => s.name).sort()).toEqual(['AAPL stored', 'MSFT stored']);
        expect(upstream.calls.every((u) => u.includes('/quote'))).toBe(true);
        expect(upstream.calls).toHaveLength(2);
    });

    it('refreshes a stored profile older than a day and keeps the stale row when Finnhub refuses', async () => {
        const dayAndABit = 25 * 60 * 60 * 1000;
        profileStore.set('AAPL', storedProfile('AAPL', dayAndABit));
        profileStore.set('MSFT', storedProfile('MSFT', dayAndABit));
        const mod = await import('@/lib/actions/finnhub.actions');
        vi.spyOn(mod, 'fetchJSON').mockImplementation(async (url: string) => {
            upstream.calls.push(url);
            if (url.includes('/quote')) return { c: 100, d: 1, dp: 1, o: 99, h: 101, l: 98, pc: 99, t: 1 };
            if (url.includes('symbol=MSFT')) throw new Error('Finnhub local rate limit reached');
            return { name: 'AAPL Inc', currency: 'USD', marketCapitalization: 1000, finnhubIndustry: 'Technology' };
        });
        const getHeatmapData = await load();
        const data = await getHeatmapData(['AAPL', 'MSFT']);
        expect(data.map((s) => `${s.symbol}:${s.name}`).sort()).toEqual(['AAPL:AAPL Inc', 'MSFT:MSFT stored']);
    });

    it('returns a fresh snapshot without touching upstream', async () => {
        snapshotStore.set('heatmap:AAPL,MSFT', { data: [tile('AAPL'), tile('MSFT')], updatedAt: new Date() });
        const getHeatmapData = await load();
        const data = await getHeatmapData(['AAPL', 'MSFT']);
        expect(data[0].name).toBe('AAPL old');
        expect(upstream.calls).toHaveLength(0);
    });

    it('over budget with a stale snapshot: returns the snapshot at once and sweeps in the background', async () => {
        snapshotStore.set('heatmap:AAPL,MSFT', {
            data: [tile('AAPL'), tile('MSFT')],
            updatedAt: new Date(Date.now() - 10 * 60_000),
        });
        gateState.freeSlots = 1; // sweep needs 4
        const getHeatmapData = await load();
        const data = await getHeatmapData(['AAPL', 'MSFT']);
        expect(data.map((s) => s.name)).toEqual(['AAPL old', 'MSFT old']);
        // The background sweep still ran and refreshed the snapshot
        await flush();
        expect(upstream.calls).toHaveLength(4);
        const refreshed = snapshotStore.get('heatmap:AAPL,MSFT')?.data as HeatmapStock[];
        expect(refreshed.map((s) => s.name).sort()).toEqual(['AAPL Inc', 'MSFT Inc']);
    });

    it('over budget with no snapshot: paints the symbols that fit and leaves the rest to the next poll', async () => {
        gateState.freeSlots = 3; // 2 per symbol: only the first symbol fits
        const getHeatmapData = await load();
        const data = await getHeatmapData(['AAPL', 'MSFT', 'NVDA']);
        expect(data.map((s) => s.symbol)).toEqual(['AAPL']);
        expect(upstream.calls).toHaveLength(2);
        await flush();
        expect((snapshotStore.get('heatmap:AAPL,MSFT,NVDA')?.data as HeatmapStock[]).map((s) => s.symbol)).toEqual(['AAPL']);
    });

    it('counts memoized URLs as free so warm profiles halve the budget needed', async () => {
        gateState.freeSlots = 2;
        gateState.memoized.add('https://finnhub.io/api/v1/stock/profile2?symbol=AAPL&token=test-token');
        gateState.memoized.add('https://finnhub.io/api/v1/stock/profile2?symbol=MSFT&token=test-token');
        const getHeatmapData = await load();
        const data = await getHeatmapData(['AAPL', 'MSFT']);
        expect(data.map((s) => s.symbol).sort()).toEqual(['AAPL', 'MSFT']);
    });

    it('merges a partial live result over the previous snapshot so rejected symbols keep their tiles', async () => {
        snapshotStore.set('heatmap:AAPL,MSFT', {
            data: [tile('AAPL'), tile('MSFT')],
            updatedAt: new Date(Date.now() - 10 * 60_000),
        });
        gateState.freeSlots = 1;
        // Make MSFT fail live so the merge has something to fall back to
        const mod = await import('@/lib/actions/finnhub.actions');
        vi.spyOn(mod, 'fetchJSON').mockImplementation(async (url: string) => {
            if (url.includes('symbol=MSFT')) throw new Error('Finnhub local rate limit reached');
            upstream.calls.push(url);
            if (url.includes('/quote')) return { c: 100, d: 1, dp: 1, o: 99, h: 101, l: 98, pc: 99, t: 1 };
            return { name: 'AAPL Inc', currency: 'USD', marketCapitalization: 1000, finnhubIndustry: 'Technology' };
        });
        const getHeatmapData = await load();
        await getHeatmapData(['AAPL', 'MSFT']);
        await flush();
        const refreshed = snapshotStore.get('heatmap:AAPL,MSFT')?.data as HeatmapStock[];
        expect(refreshed.map((s) => `${s.symbol}:${s.name}`).sort()).toEqual(['AAPL:AAPL Inc', 'MSFT:MSFT old']);
    });
});
