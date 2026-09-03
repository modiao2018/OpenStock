// Lightweight liveness probes for every registered source — one cheap
// request each, used by the /status "probe" button and the daemon's
// 30-minute sources collector. Server/daemon only (touches env + DB).

import { CIK_MAP_URL, edgarHeaders, submissionsUrl } from '@/lib/edgar';
import { callAIProviderWithConfig } from '@/lib/ai-provider';
import { resolveLlmConfig } from '@/lib/llm-config';
import { SOURCE_BY_ID, isConfigured, sourceIdOf, type SourceId } from '@/lib/sources-registry';

export interface ProbeResult {
    ok: boolean;
    latencyMs: number;
    status?: number;
    error?: string;
}

export interface ProbeContext {
    edgarContact: string;
    // config.yaml feeds for rss:<slug> probes
    feeds?: Array<{ name: string; url: string }>;
}

const PROBE_TIMEOUT_MS = 10_000;

// GET with the body discarded — we only want reachability + status
async function head(url: string, init: RequestInit = {}): Promise<{ status: number; ok: boolean }> {
    const res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => undefined);
    return { status: res.status, ok: res.ok };
}

async function getJson<T>(url: string, init: RequestInit = {}): Promise<{ status: number; ok: boolean; data: T | null }> {
    const res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const data = res.ok ? ((await res.json().catch(() => null)) as T | null) : null;
    if (!res.ok) await res.body?.cancel().catch(() => undefined);
    return { status: res.status, ok: res.ok, data };
}

type Probe = (ctx: ProbeContext, rawId: string) => Promise<{ ok: boolean; status?: number; error?: string }>;

const PROBES: Record<Exclude<SourceId, 'bark' | 'healthcheck'>, Probe> = {
    finnhub: async () => {
        const r = await getJson<{ c?: number }>(
            `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? ''}`,
        );
        // A 200 with c=0 is Finnhub's way of saying "unknown/unauthorized"
        return { ok: r.ok && (r.data?.c ?? 0) > 0, status: r.status, error: r.ok && !(r.data?.c) ? 'empty quote' : undefined };
    },
    alpaca: async () => {
        const r = await head('https://paper-api.alpaca.markets/v2/clock', {
            headers: {
                'APCA-API-KEY-ID': process.env.ALPACA_API_KEY ?? '',
                'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET ?? '',
            },
        });
        return { ok: r.ok, status: r.status };
    },
    twelvedata: async () => {
        const r = await getJson<{ status?: string; message?: string; close?: string }>(
            'https://api.twelvedata.com/quote?symbol=AAPL',
            { headers: { Authorization: `apikey ${process.env.TWELVEDATA_API_KEY ?? ''}` } },
        );
        if (r.data?.status === 'error') return { ok: false, status: r.status, error: r.data.message ?? 'error' };
        return { ok: r.ok && Boolean(r.data?.close), status: r.status };
    },
    'er-api': async () => {
        const r = await head('https://open.er-api.com/v6/latest/USD');
        return { ok: r.ok, status: r.status };
    },
    'sec-data': async (ctx) => {
        const r = await head(submissionsUrl('320193'), { headers: edgarHeaders(ctx.edgarContact) });
        return { ok: r.ok, status: r.status };
    },
    'sec-www': async (ctx) => {
        const r = await head(CIK_MAP_URL, { headers: edgarHeaders(ctx.edgarContact) });
        return { ok: r.ok, status: r.status };
    },
    'nasdaq-halts': async () => {
        const r = await head('https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts', {
            headers: { 'User-Agent': 'catalyst-monitor/0.1' },
        });
        return { ok: r.ok, status: r.status };
    },
    clinicaltrials: async () => {
        const r = await head(
            'https://clinicaltrials.gov/api/v2/studies/NCT04368728?fields=protocolSection.identificationModule.nctId',
            { headers: { Accept: 'application/json' } },
        );
        return { ok: r.ok, status: r.status };
    },
    rss: async (ctx, rawId) => {
        const { rssSourceId } = await import('@/lib/sources-registry');
        const feed = (ctx.feeds ?? []).find((f) => rssSourceId(f.name) === rawId);
        if (!feed) return { ok: false, error: 'feed not found in config' };
        const r = await head(feed.url, {
            headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'catalyst-monitor/0.1' },
        });
        return { ok: r.ok, status: r.status };
    },
    llm: async () => {
        const llm = await resolveLlmConfig();
        if (!llm) return { ok: false, error: 'not configured' };
        const reply = await callAIProviderWithConfig('请只回复两个字符：OK', {
            name: llm.provider, apiKey: llm.apiKey, baseUrl: llm.baseUrl, model: llm.model,
        });
        return { ok: reply.trim().length > 0 };
    },
    adanos: async () => {
        const base = (process.env.ADANOS_API_BASE_URL || 'https://api.adanos.org').replace(/\/$/, '');
        const r = await head(`${base}/news/stocks/v1/compare?tickers=AAPL&days=1`, {
            headers: { 'X-API-Key': process.env.ADANOS_API_KEY ?? '' },
        });
        // 404 = no data for the ticker, upstream itself is fine
        return { ok: r.ok || r.status === 404, status: r.status };
    },
};

export function isProbeable(rawId: string): boolean {
    const id = sourceIdOf(rawId);
    return id !== null && SOURCE_BY_ID[id].probe !== 'none';
}

// llm's key may live in the DB rather than env, so only the probe itself can
// tell; everything else is decided by the registry's keyEnv
export async function isSourceConfigured(id: SourceId): Promise<boolean> {
    if (id === 'llm') return (await resolveLlmConfig()) !== null;
    return isConfigured(id);
}

export async function probeSource(rawId: string, ctx: ProbeContext): Promise<ProbeResult> {
    const id = sourceIdOf(rawId);
    const start = Date.now();
    if (!id) return { ok: false, latencyMs: 0, error: 'unknown source' };
    const probe = (PROBES as Partial<Record<SourceId, Probe>>)[id];
    if (!probe) return { ok: false, latencyMs: 0, error: 'passive' };
    try {
        const r = await probe(ctx, rawId);
        return {
            ok: r.ok,
            latencyMs: Date.now() - start,
            status: r.status,
            error: r.ok ? undefined : (r.error ?? (r.status ? `HTTP ${r.status}` : 'failed')),
        };
    } catch (err) {
        return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
}
