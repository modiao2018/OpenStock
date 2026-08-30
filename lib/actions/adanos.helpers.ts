export type SentimentSourceKey = 'reddit' | 'x' | 'news' | 'polymarket';
export type SentimentTrend = 'rising' | 'falling' | 'stable';

type BaseCompareRow = {
    ticker?: string;
    company_name?: string | null;
    buzz_score?: number | null;
    trend?: SentimentTrend | null;
    bullish_pct?: number | null;
    trend_history?: number[] | null;
};

export type SourceComparePayload = {
    stocks?: BaseCompareRow[];
};

// `label` and `metricLabel` are stable i18n keys, translated at render time
// (see StockSentimentCard: `sentiment.sources.*` / `sentiment.metrics.*`).
export const SOURCE_CONFIG = {
    reddit: {
        label: 'reddit',
        path: '/reddit/stocks/v1/compare',
        metricLabel: 'mentions',
        metricField: 'mentions',
    },
    x: {
        label: 'x',
        path: '/x/stocks/v1/compare',
        metricLabel: 'mentions',
        metricField: 'mentions',
    },
    news: {
        label: 'news',
        path: '/news/stocks/v1/compare',
        metricLabel: 'mentions',
        metricField: 'mentions',
    },
    polymarket: {
        label: 'polymarket',
        path: '/polymarket/stocks/v1/compare',
        metricLabel: 'trades',
        metricField: 'trade_count',
    },
} as const satisfies Record<
    SentimentSourceKey,
    {
        label: string;
        path: string;
        metricLabel: string;
        metricField: string;
    }
>;

type SourceSpecificRow = BaseCompareRow & Record<string, unknown>;

export interface SentimentSourceInsight {
    source: SentimentSourceKey;
    label: string;
    companyName: string | null;
    buzzScore: number;
    bullishPct: number | null;
    trend: SentimentTrend | null;
    metricLabel: string;
    metricValue: number;
}

export interface StockSentimentInsights {
    symbol: string;
    companyName: string | null;
    averageBuzz: number;
    bullishAverage: number | null;
    sourceAlignment: SourceAlignmentKey;
    availableSources: number;
    sources: SentimentSourceInsight[];
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function roundTo(value: number, digits: number = 1): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeTrend(value: unknown): SentimentTrend | null {
    return value === 'rising' || value === 'falling' || value === 'stable' ? value : null;
}

export type SourceAlignmentKey =
    | 'bullishAlignment'
    | 'bearishAlignment'
    | 'tightAlignment'
    | 'wideDivergence'
    | 'mixed'
    | 'singleSource'
    | 'noSentimentMix';

// Returns a stable key, translated at render time (`sentiment.alignment.*`).
export function getSourceAlignment(bullishValues: number[]): SourceAlignmentKey {
    if (bullishValues.length === 0) return 'noSentimentMix';
    if (bullishValues.length === 1) return 'singleSource';

    const min = Math.min(...bullishValues);
    const max = Math.max(...bullishValues);
    const spread = max - min;
    const avg = average(bullishValues);

    if (spread <= 12 && avg >= 60) return 'bullishAlignment';
    if (spread <= 12 && avg <= 40) return 'bearishAlignment';
    if (spread <= 12) return 'tightAlignment';
    if (spread >= 25) return 'wideDivergence';
    return 'mixed';
}

export function normalizeSourceInsight(
    source: SentimentSourceKey,
    row: SourceSpecificRow | null | undefined,
): SentimentSourceInsight | null {
    if (!row) return null;

    const buzzScore = toNumber(row.buzz_score);
    const metricValue = toNumber(row[SOURCE_CONFIG[source].metricField]);

    if (buzzScore === null || metricValue === null) {
        return null;
    }

    return {
        source,
        label: SOURCE_CONFIG[source].label,
        companyName: typeof row.company_name === 'string' ? row.company_name : null,
        buzzScore: roundTo(buzzScore),
        bullishPct: toNumber(row.bullish_pct),
        trend: normalizeTrend(row.trend),
        metricLabel: SOURCE_CONFIG[source].metricLabel,
        metricValue: Math.round(metricValue),
    };
}

export function buildStockSentimentInsights(
    symbol: string,
    sources: Array<SentimentSourceInsight | null>,
): StockSentimentInsights | null {
    const availableSources = sources.filter((source): source is SentimentSourceInsight => Boolean(source));

    if (availableSources.length === 0) {
        return null;
    }

    const buzzValues = availableSources.map((source) => source.buzzScore);
    const bullishValues = availableSources
        .map((source) => source.bullishPct)
        .filter((value): value is number => value !== null);

    return {
        symbol: symbol.toUpperCase(),
        companyName: availableSources.find((source) => source.companyName)?.companyName ?? null,
        averageBuzz: roundTo(average(buzzValues)),
        bullishAverage: bullishValues.length ? roundTo(average(bullishValues)) : null,
        sourceAlignment: getSourceAlignment(bullishValues),
        availableSources: availableSources.length,
        sources: availableSources,
    };
}
