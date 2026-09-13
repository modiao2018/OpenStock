import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchlistRow } from '@/lib/actions/finnhub.actions';

// Under test: the watchlist rows / company-news budgeting in finnhub.actions
// (issue 0002). The gate, the snapshot store, the profile store and the
// network are all stubbed; `throughFinnhubGate` runs the upstream directly.
const gateState = vi.hoisted(() => ({ freeSlots: 100, memoized: new Set<string>() }));
const snapshotStore = vi.hoisted(() => new Map<string, { data: unknown; updatedAt: Date }>());
const upstream = vi.hoisted(() => ({ calls: [] as string[], failing: new Set<string>() }));
const profileStore = vi.hoisted(() => new Map<string, { symbol: string; name: string; ticker: string; currency: string; exchange: string; logo: string; marketCapitalization: number; finnhubIndustry: string; fetchedAt: Date }>());

vi.mock('@/lib/finnhub-gate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/finnhub-gate')>();
    return {
        pickWithinBudget: actual.pickWithinBudget,
        retryAfterMs: actual.retryAfterMs,
        finnhubGate: { get freeSlots() { return gateState.freeSlots; }, reportRateLimited: () => {} },
        isMemoized: (key: string) => gateState.memoized.has(key),
        throughFinnhubGate: async <T,>(_g: unknown, _k: string, _ttl: number, run: () => Promise<T>) => run(),
    };
});

vi.mock('@/lib/market-hours', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/market-hours')>();
    return { ...actual, quoteTtlSeconds: () => actual.LIVE_QUOTE_TTL_S, isFetchStale: () => false };
});

vi.mock('@/lib/snapshot', () => ({
    snapshotKey: (prefix: string, symbols: string[]) => `${prefix}:${[...symbols].sort().join(',')}`,
    readSnapshot: async (key: string) => snapshotStore.get(key) ?? null,
    writeSnapshot: async (key: string, data: unknown) => { snapshotStore.set(key, { data, updatedAt: new Date() }); },
}));

vi.mock('@/lib/source-calls', () => ({ recordSourceCall: async () => {}, timed: async (_s: string, fn: () => unknown) => fn() }));
vi.mock('@/lib/market-cap', () => ({ marketCapToUsdMillions: async (m: number) => m }));

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

const NOW_S = Math.floor(Date.now() / 1000);

function article(symbol: string, n: number) {
    return { id: n, headline: `${symbol} headline ${n}`, summary: `${symbol} summary ${n}`, url: `https://x/${symbol}/${n}`, datetime: NOW_S - n * 3600, source: 'Wire' };
}

// Stand-in for Finnhub: quotes, profiles and company news keyed by symbol
function stubFetch() {
    vi.stubGlobal('fetch', async (url: string) => {
        upstream.calls.push(url);
        const u = new URL(url);
        const symbol = u.searchParams.get('symbol') ?? '';
        if (upstream.failing.has(symbol)) return new Response('rate limited', { status: 429 });
        let body: unknown;
        if (u.pathname.endsWith('/quote')) body = { c: 100, d: 1, dp: 1, t: NOW_S };
        else if (u.pathname.endsWith('/stock/profile2')) body = { name: `${symbol} Inc`, currency: 'USD', marketCapitalization: 1000, logo: `https://logo/${symbol}` };
        else if (u.pathname.endsWith('/company-news')) body = [article(symbol, 1), article(symbol, 2), { id: 9, headline: 'no summary' }];
        else body = [];
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
}

const storedProfile = (symbol: string, ageMs = 0) => ({
    symbol, name: `${symbol} stored`, ticker: symbol, currency: 'USD', exchange: 'US', logo: `https://stored/${symbol}`,
    marketCapitalization: 2000, finnhubIndustry: 'Technology', fetchedAt: new Date(Date.now() - ageMs),
});

const row = (symbol: string, over: Partial<WatchlistRow> = {}): WatchlistRow => ({
    symbol, price: 50, change: -1, changePercent: -2, currency: 'USD', name: `${symbol} old`, marketCap: 500, peRatio: 0, quoteTime: 0, ...over,
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const calls = (path: string) => upstream.calls.filter((u) => u.includes(path)).map((u) => new URL(u).searchParams.get('symbol'));

async function load() {
    return import('@/lib/actions/finnhub.actions');
}

beforeEach(() => {
    process.env.NEXT_PUBLIC_FINNHUB_API_KEY = 'test-token';
    gateState.freeSlots = 100;
    gateState.memoized.clear();
    snapshotStore.clear();
    profileStore.clear();
    upstream.calls.length = 0;
    upstream.failing.clear();
    stubFetch();
    vi.resetModules();
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_FINNHUB_API_KEY;
});

describe('getWatchlistData budget rotation', () => {
    it('fetches quote + profile per symbol and writes the snapshot when the sweep fits', async () => {
        const { getWatchlistData } = await load();
        const rows = await getWatchlistData(['AAPL', 'MSFT']);
        expect(rows.map((r) => `${r.symbol}:${r.price}:${r.name}`)).toEqual(['AAPL:100:AAPL Inc', 'MSFT:100:MSFT Inc']);
        expect(rows.every((r) => r.fetchedAt && r.quoteTime === NOW_S)).toBe(true);
        expect(upstream.calls).toHaveLength(4);
        await flush();
        expect(snapshotStore.get('watchlist:AAPL,MSFT')?.data).toHaveLength(2);
    });

    it('spends nothing on profiles already fresh in Mongo', async () => {
        profileStore.set('AAPL', storedProfile('AAPL'));
        profileStore.set('MSFT', storedProfile('MSFT'));
        gateState.freeSlots = 2;
        const { getWatchlistData } = await load();
        const rows = await getWatchlistData(['AAPL', 'MSFT']);
        expect(rows.map((r) => r.name)).toEqual(['AAPL stored', 'MSFT stored']);
        expect(rows.map((r) => r.logo)).toEqual(['https://stored/AAPL', 'https://stored/MSFT']);
        expect(calls('/quote')).toEqual(['AAPL', 'MSFT']);
        expect(calls('/profile2')).toEqual([]);
    });

    it('over budget: refreshes the stalest rows that fit and keeps the snapshot for the rest', async () => {
        snapshotStore.set('watchlist:AAPL,MSFT,NVDA', {
            data: [row('AAPL', { fetchedAt: 300 }), row('MSFT', { fetchedAt: 100 }), row('NVDA', { fetchedAt: 200 })],
            updatedAt: new Date(),
        });
        for (const s of ['AAPL', 'MSFT', 'NVDA']) profileStore.set(s, storedProfile(s));
        gateState.freeSlots = 2;
        const { getWatchlistData } = await load();
        const rows = await getWatchlistData(['AAPL', 'MSFT', 'NVDA']);
        // Order is the caller's; MSFT and NVDA had the oldest quotes
        expect(rows.map((r) => `${r.symbol}:${r.price}`)).toEqual(['AAPL:50', 'MSFT:100', 'NVDA:100']);
        expect(calls('/quote').sort()).toEqual(['MSFT', 'NVDA']);
        expect(rows[0].fetchedAt).toBe(300);
        expect(rows[1].fetchedAt).toBeGreaterThan(300);
        await flush();
        const written = snapshotStore.get('watchlist:AAPL,MSFT,NVDA')?.data as WatchlistRow[];
        expect(written.find((r) => r.symbol === 'AAPL')?.price).toBe(50);
    });

    it('rows the snapshot never priced go first, ahead of everything fetched before', async () => {
        snapshotStore.set('watchlist:AAPL,MSFT', {
            data: [row('AAPL', { fetchedAt: 100 }), row('MSFT', { price: null, fetchedAt: 999 })],
            updatedAt: new Date(),
        });
        profileStore.set('AAPL', storedProfile('AAPL'));
        profileStore.set('MSFT', storedProfile('MSFT'));
        gateState.freeSlots = 1;
        const { getWatchlistData } = await load();
        await getWatchlistData(['AAPL', 'MSFT']);
        expect(calls('/quote')).toEqual(['MSFT']);
    });

    it('memo hits are free, so a symbol just fetched does not eat the budget', async () => {
        profileStore.set('AAPL', storedProfile('AAPL'));
        profileStore.set('MSFT', storedProfile('MSFT'));
        gateState.memoized.add('https://finnhub.io/api/v1/quote?symbol=AAPL&token=test-token');
        gateState.freeSlots = 1;
        const { getWatchlistData } = await load();
        const rows = await getWatchlistData(['AAPL', 'MSFT']);
        expect(rows.map((r) => r.price)).toEqual([100, 100]);
        expect(calls('/quote')).toEqual(['AAPL', 'MSFT']);
    });

    it('a refused quote keeps the snapshot row instead of blanking it', async () => {
        snapshotStore.set('watchlist:AAPL,MSFT', { data: [row('AAPL'), row('MSFT')], updatedAt: new Date() });
        profileStore.set('AAPL', storedProfile('AAPL'));
        profileStore.set('MSFT', storedProfile('MSFT'));
        upstream.failing.add('MSFT');
        const { getWatchlistData } = await load();
        const rows = await getWatchlistData(['AAPL', 'MSFT']);
        expect(rows.map((r) => `${r.symbol}:${r.price}`)).toEqual(['AAPL:100', 'MSFT:50']);
    });

    it('budget zero with no snapshot: returns placeholder rows without touching upstream', async () => {
        gateState.freeSlots = 0;
        const { getWatchlistData } = await load();
        const rows = await getWatchlistData(['AAPL']);
        expect(rows).toEqual([expect.objectContaining({ symbol: 'AAPL', price: null, name: 'AAPL', marketCap: null })]);
        expect(upstream.calls).toHaveLength(0);
        await flush();
        expect(snapshotStore.has('watchlist:AAPL')).toBe(false);
    });
});

describe('getWatchlistQuotes', () => {
    it('never fetches profiles, filling name/logo from Mongo or the snapshot', async () => {
        snapshotStore.set('watchlist:AAPL,MSFT', { data: [row('AAPL'), row('MSFT')], updatedAt: new Date() });
        profileStore.set('AAPL', storedProfile('AAPL', 3 * 24 * 3600_000)); // stale in Mongo
        const { getWatchlistQuotes } = await load();
        const rows = await getWatchlistQuotes(['AAPL', 'MSFT']);
        expect(calls('/profile2')).toEqual([]);
        expect(calls('/quote')).toEqual(['AAPL', 'MSFT']);
        expect(rows.map((r) => `${r.name}:${r.price}`)).toEqual(['AAPL stored:100', 'MSFT old:100']);
        await flush();
        // The poll advances fetchedAt in the snapshot so the rotation order stays honest
        const written = snapshotStore.get('watchlist:AAPL,MSFT')?.data as WatchlistRow[];
        expect(written.every((r) => (r.fetchedAt ?? 0) > 0)).toBe(true);
    });
});

describe('getNews company-news budget', () => {
    const symbols = Array.from({ length: 12 }, (_, i) => `S${i}`);

    it('caps a cold render at NEWS_CALLS_PER_RENDER symbols and snapshots what it got', async () => {
        const { getNews } = await load();
        const news = await getNews(symbols);
        expect(calls('/company-news')).toHaveLength(8);
        expect(news).toHaveLength(6);
        expect(news.every((n) => n.related && n.headline)).toBe(true);
        await flush();
        const snap = snapshotStore.get(`news:${[...symbols].sort().join(',')}`)?.data as Record<string, { articles: unknown[] }>;
        expect(Object.keys(snap)).toHaveLength(8);
        // The invalid article was dropped before persisting
        expect(snap.S0.articles).toHaveLength(2);
    });

    it('the next render picks the symbols left out last time, serving the rest from the snapshot', async () => {
        const { getNews } = await load();
        await getNews(symbols);
        await flush();
        const first = new Set(calls('/company-news'));
        upstream.calls.length = 0;
        const news = await getNews(symbols);
        const second = calls('/company-news');
        expect(second).toHaveLength(4);
        expect(second.every((s) => !first.has(s))).toBe(true);
        expect(news).toHaveLength(6);
    });

    it('stays within the gate budget when that is tighter than the per-render cap', async () => {
        gateState.freeSlots = 3;
        const { getNews } = await load();
        await getNews(symbols);
        expect(calls('/company-news')).toHaveLength(3);
    });

    it('no budget and no snapshot: falls back to general news with one call', async () => {
        gateState.freeSlots = 0;
        vi.stubGlobal('fetch', async (url: string) => {
            upstream.calls.push(url);
            return new Response(JSON.stringify([{ id: 1, headline: 'Market', summary: 'wide', url: 'https://x/1', datetime: NOW_S, category: 'general' }]), { status: 200 });
        });
        const { getNews } = await load();
        const news = await getNews(symbols);
        expect(upstream.calls).toEqual(['https://finnhub.io/api/v1/news?category=general&token=test-token']);
        expect(news.map((n) => n.headline)).toEqual(['Market']);
    });

    it('a refused symbol keeps its snapshot articles', async () => {
        snapshotStore.set('news:AAPL,MSFT', {
            data: { MSFT: { fetchedAt: 1, articles: [article('MSFT', 1)] } },
            updatedAt: new Date(),
        });
        upstream.failing.add('MSFT');
        const { getNews } = await load();
        const news = await getNews(['AAPL', 'MSFT']);
        expect(news.map((n) => n.related).sort()).toEqual(['AAPL', 'AAPL', 'MSFT']);
    });
});
