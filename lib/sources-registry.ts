// Registry of every external resource the app and the monitor daemon call.
// Pure metadata — importable from server, daemon and client components alike.
// Probe implementations live in lib/source-probes.ts (server only).

export type SourceId =
    | 'finnhub'
    | 'alpaca'
    | 'twelvedata'
    | 'sec-data'
    | 'sec-www'
    | 'clinicaltrials'
    | 'nasdaq-halts'
    | 'rss'
    | 'llm'
    | 'bark'
    | 'er-api'
    | 'adanos'
    | 'healthcheck';

export type SourceGroup = 'quotes' | 'filings' | 'clinical' | 'ai' | 'other';

export type SourceFeature =
    | 'watchlist' | 'search' | 'heatmap' | 'news' | 'aiDips' | 'insider'
    | 'catalystMarket' | 'catalystEdgar' | 'catalystTrials' | 'catalystHalts'
    | 'catalystRss' | 'analysis' | 'push' | 'xcheck' | 'sentiment' | 'fx' | 'monitor';

export interface SourceSpec {
    id: SourceId;
    // Brand name, not translated
    name: string;
    // Display only; llm shows the configured baseUrl instead
    host: string;
    group: SourceGroup;
    // Env vars that must all be set; [] = keyless
    keyEnv: string[];
    usedBy: SourceFeature[];
    // 'none' = passive only (we never send synthetic traffic, e.g. Bark)
    probe: 'http' | 'llm' | 'none';
    // Stats are kept per sub-source (rss:<slug>) and rolled up under this entry
    dynamicPrefix?: string;
}

export const SOURCES: SourceSpec[] = [
    {
        id: 'finnhub', name: 'Finnhub', host: 'finnhub.io', group: 'quotes',
        keyEnv: ['NEXT_PUBLIC_FINNHUB_API_KEY'],
        usedBy: ['watchlist', 'search', 'heatmap', 'news', 'aiDips', 'insider', 'xcheck'], probe: 'http',
    },
    {
        id: 'alpaca', name: 'Alpaca', host: 'data.alpaca.markets', group: 'quotes',
        keyEnv: ['ALPACA_API_KEY', 'ALPACA_API_SECRET'],
        usedBy: ['aiDips', 'catalystMarket', 'insider', 'xcheck'], probe: 'http',
    },
    {
        id: 'twelvedata', name: 'Twelve Data', host: 'api.twelvedata.com', group: 'quotes',
        keyEnv: ['TWELVEDATA_API_KEY'], usedBy: ['xcheck'], probe: 'http',
    },
    {
        id: 'er-api', name: 'ExchangeRate-API', host: 'open.er-api.com', group: 'quotes',
        keyEnv: [], usedBy: ['fx'], probe: 'http',
    },
    {
        id: 'sec-data', name: 'SEC EDGAR (submissions)', host: 'data.sec.gov', group: 'filings',
        keyEnv: [], usedBy: ['catalystEdgar', 'insider', 'xcheck'], probe: 'http',
    },
    {
        id: 'sec-www', name: 'SEC EDGAR (archives)', host: 'www.sec.gov', group: 'filings',
        keyEnv: [], usedBy: ['catalystEdgar', 'insider', 'analysis'], probe: 'http',
    },
    {
        id: 'nasdaq-halts', name: 'Nasdaq Trader halts', host: 'www.nasdaqtrader.com', group: 'filings',
        keyEnv: [], usedBy: ['catalystHalts'], probe: 'http',
    },
    {
        id: 'clinicaltrials', name: 'ClinicalTrials.gov', host: 'clinicaltrials.gov', group: 'clinical',
        keyEnv: [], usedBy: ['catalystTrials'], probe: 'http',
    },
    {
        id: 'rss', name: 'News RSS feeds', host: '(config.yaml feeds)', group: 'other',
        keyEnv: [], usedBy: ['catalystRss'], probe: 'http', dynamicPrefix: 'rss:',
    },
    {
        id: 'llm', name: 'LLM provider', host: '(per config)', group: 'ai',
        keyEnv: [], usedBy: ['analysis', 'insider', 'news'], probe: 'llm',
    },
    {
        id: 'adanos', name: 'Adanos sentiment', host: 'api.adanos.org', group: 'ai',
        keyEnv: ['ADANOS_API_KEY'], usedBy: ['sentiment'], probe: 'http',
    },
    {
        id: 'bark', name: 'Bark push', host: '(BARK_URL)', group: 'other',
        keyEnv: ['BARK_URL'], usedBy: ['push'], probe: 'none',
    },
    {
        id: 'healthcheck', name: 'Healthcheck ping', host: '(HEALTHCHECK_URL)', group: 'other',
        keyEnv: ['HEALTHCHECK_URL'], usedBy: ['monitor'], probe: 'none',
    },
];

export const SOURCE_BY_ID: Record<SourceId, SourceSpec> = Object.fromEntries(
    SOURCES.map((s) => [s.id, s]),
) as Record<SourceId, SourceSpec>;

// Reads process.env — call server-side only
export function isConfigured(id: SourceId): boolean {
    const spec = SOURCE_BY_ID[id];
    return spec.keyEnv.every((k) => Boolean(process.env[k]));
}

// 'rss:fierce-biotech' -> 'rss'
export function sourceIdOf(rawId: string): SourceId | null {
    if ((SOURCE_BY_ID as Record<string, SourceSpec>)[rawId]) return rawId as SourceId;
    const dyn = SOURCES.find((s) => s.dynamicPrefix && rawId.startsWith(s.dynamicPrefix));
    return dyn?.id ?? null;
}

export function rssSourceId(feedName: string): string {
    const slug = feedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `rss:${slug || 'feed'}`;
}

const HOST_TO_SOURCE: Array<[RegExp, SourceId]> = [
    [/(^|\.)finnhub\.io$/, 'finnhub'],
    [/(^|\.)alpaca\.markets$/, 'alpaca'],
    [/(^|\.)twelvedata\.com$/, 'twelvedata'],
    [/^data\.sec\.gov$/, 'sec-data'],
    [/^(www\.)?sec\.gov$/, 'sec-www'],
    [/(^|\.)clinicaltrials\.gov$/, 'clinicaltrials'],
    [/(^|\.)nasdaqtrader\.com$/, 'nasdaq-halts'],
    [/(^|\.)er-api\.com$/, 'er-api'],
    [/(^|\.)adanos\.org$/, 'adanos'],
];

// Lets the shared fetch wrappers attribute a call without every caller
// naming its source explicitly
export function inferSourceByHost(url: string): SourceId | null {
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return null;
    }
    for (const [re, id] of HOST_TO_SOURCE) if (re.test(host)) return id;
    return null;
}
