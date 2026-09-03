/**
 * Pure helpers for analyst / institutional data. Network code lives in
 * analyst.actions.ts; everything here is deterministic and unit-testable.
 */

import { toNumber } from './http.helpers';

export type RatingBucket = 'strongBuy' | 'buy' | 'hold' | 'sell' | 'strongSell';

export interface RatingDistribution {
    period: string;
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
    total: number;
}

export interface PriceTargetConsensus {
    source: 'yahoo' | 'nasdaq';
    currentPrice: number | null;
    mean: number | null;
    median: number | null;
    high: number | null;
    low: number | null;
    analystCount: number | null;
    /** Yahoo 1 (strong buy) .. 5 (strong sell) */
    recommendationMean: number | null;
    recommendationKey: string | null;
    /** Percent upside from current price to mean target. */
    upsidePct: number | null;
}

export type RatingAction = 'init' | 'up' | 'down' | 'main' | 'reit' | 'unknown';

export interface RatingChange {
    date: string;
    epoch: number;
    firm: string;
    fromGrade: string | null;
    toGrade: string;
    action: RatingAction;
    priceTargetAction: string | null;
    priceTarget: number | null;
    priorPriceTarget: number | null;
}

export interface EstimatePeriod {
    period: string;
    periodLabel: string;
    endDate: string | null;
    epsAvg: number | null;
    epsLow: number | null;
    epsHigh: number | null;
    epsAnalysts: number | null;
    epsYearAgo: number | null;
    revenueAvg: number | null;
    revenueLow: number | null;
    revenueHigh: number | null;
    revenueAnalysts: number | null;
    revenueYearAgo: number | null;
    growth: number | null;
    /** EPS estimate 90 days ago, to show revision direction. */
    eps90DaysAgo: number | null;
}

export interface EarningsSurprise {
    period: string;
    fiscalQuarter: string;
    estimate: number | null;
    actual: number | null;
    surprisePct: number | null;
}

export interface InstitutionalHolder {
    organization: string;
    reportDate: string | null;
    pctHeld: number | null;
    shares: number | null;
    value: number | null;
    pctChange: number | null;
}

export interface OwnershipBreakdown {
    insidersPct: number | null;
    institutionsPct: number | null;
    institutionsFloatPct: number | null;
    institutionsCount: number | null;
}

export interface AnalystResearch {
    symbol: string;
    fetchedAt: string;
    targets: PriceTargetConsensus[];
    ratingTrend: RatingDistribution[];
    ratingChanges: RatingChange[];
    estimates: EstimatePeriod[];
    surprises: EarningsSurprise[];
    topHolders: InstitutionalHolder[];
    ownership: OwnershipBreakdown | null;
    nextEarningsDate: string | null;
    /** Sources that returned data; useful for showing coverage. */
    sources: string[];
}

// ---------------------------------------------------------------------------
// Yahoo quoteSummary shapes (only the fields we read)
// ---------------------------------------------------------------------------

type YRaw = { raw?: number; fmt?: string } | number | null | undefined;

export interface YahooQuoteSummary {
    financialData?: {
        currentPrice?: YRaw;
        targetHighPrice?: YRaw;
        targetLowPrice?: YRaw;
        targetMeanPrice?: YRaw;
        targetMedianPrice?: YRaw;
        recommendationMean?: YRaw;
        recommendationKey?: string;
        numberOfAnalystOpinions?: YRaw;
    };
    recommendationTrend?: {
        trend?: Array<{ period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }>;
    };
    upgradeDowngradeHistory?: {
        history?: Array<{
            epochGradeDate: number;
            firm: string;
            toGrade: string;
            fromGrade?: string;
            action: string;
            priceTargetAction?: string;
            currentPriceTarget?: number;
            priorPriceTarget?: number;
        }>;
    };
    earningsTrend?: {
        trend?: Array<{
            period: string;
            endDate?: string;
            growth?: YRaw;
            earningsEstimate?: { avg?: YRaw; low?: YRaw; high?: YRaw; yearAgoEps?: YRaw; numberOfAnalysts?: YRaw };
            revenueEstimate?: { avg?: YRaw; low?: YRaw; high?: YRaw; yearAgoRevenue?: YRaw; numberOfAnalysts?: YRaw };
            epsTrend?: { current?: YRaw; '90daysAgo'?: YRaw };
        }>;
    };
    institutionOwnership?: {
        ownershipList?: Array<{
            organization: string;
            reportDate?: YRaw & { fmt?: string };
            pctHeld?: YRaw;
            position?: YRaw;
            value?: YRaw;
            pctChange?: YRaw;
        }>;
    };
    majorHoldersBreakdown?: {
        insidersPercentHeld?: YRaw;
        institutionsPercentHeld?: YRaw;
        institutionsFloatPercentHeld?: YRaw;
        institutionsCount?: YRaw;
    };
    calendarEvents?: {
        earnings?: { earningsDate?: Array<YRaw & { fmt?: string }> };
    };
}

const PERIOD_LABELS: Record<string, string> = {
    '0q': 'Current quarter',
    '+1q': 'Next quarter',
    '0y': 'Current year',
    '+1y': 'Next year',
    '+5y': 'Next 5 years (annualised)',
    '-5y': 'Past 5 years (annualised)',
};

function epochToIso(epoch: number | null): string | null {
    if (epoch === null) return null;
    const ms = epoch > 1e12 ? epoch : epoch * 1000;
    return new Date(ms).toISOString().slice(0, 10);
}

function normalizeAction(action: string | undefined): RatingAction {
    const a = (action ?? '').toLowerCase();
    if (a === 'init' || a === 'up' || a === 'down' || a === 'main' || a === 'reit') return a;
    return 'unknown';
}

export function upsidePct(current: number | null, target: number | null): number | null {
    if (current === null || target === null || current <= 0) return null;
    return ((target - current) / current) * 100;
}

export function normalizeYahooTargets(summary: YahooQuoteSummary): PriceTargetConsensus | null {
    const fd = summary.financialData;
    if (!fd) return null;
    const currentPrice = toNumber(fd.currentPrice);
    const mean = toNumber(fd.targetMeanPrice);
    if (mean === null && toNumber(fd.targetHighPrice) === null) return null;
    return {
        source: 'yahoo',
        currentPrice,
        mean,
        median: toNumber(fd.targetMedianPrice),
        high: toNumber(fd.targetHighPrice),
        low: toNumber(fd.targetLowPrice),
        analystCount: toNumber(fd.numberOfAnalystOpinions),
        recommendationMean: toNumber(fd.recommendationMean),
        recommendationKey: fd.recommendationKey ?? null,
        upsidePct: upsidePct(currentPrice, mean),
    };
}

export function normalizeYahooRatingTrend(summary: YahooQuoteSummary): RatingDistribution[] {
    const trend = summary.recommendationTrend?.trend ?? [];
    return trend.map((t) => {
        const strongBuy = toNumber(t.strongBuy) ?? 0;
        const buy = toNumber(t.buy) ?? 0;
        const hold = toNumber(t.hold) ?? 0;
        const sell = toNumber(t.sell) ?? 0;
        const strongSell = toNumber(t.strongSell) ?? 0;
        return { period: t.period, strongBuy, buy, hold, sell, strongSell, total: strongBuy + buy + hold + sell + strongSell };
    });
}

export function normalizeYahooRatingChanges(summary: YahooQuoteSummary, limit: number = 25): RatingChange[] {
    const history = summary.upgradeDowngradeHistory?.history ?? [];
    return history
        .filter((h) => h && h.firm && h.toGrade)
        .sort((a, b) => b.epochGradeDate - a.epochGradeDate)
        .slice(0, limit)
        .map((h) => ({
            date: epochToIso(h.epochGradeDate) ?? '',
            epoch: h.epochGradeDate,
            firm: h.firm,
            fromGrade: h.fromGrade?.trim() ? h.fromGrade : null,
            toGrade: h.toGrade,
            action: normalizeAction(h.action),
            priceTargetAction: h.priceTargetAction ?? null,
            priceTarget: toNumber(h.currentPriceTarget),
            priorPriceTarget: toNumber(h.priorPriceTarget),
        }));
}

export function normalizeYahooEstimates(summary: YahooQuoteSummary): EstimatePeriod[] {
    const trend = summary.earningsTrend?.trend ?? [];
    return trend
        .filter((t) => t.period in PERIOD_LABELS && !t.period.includes('5y'))
        .map((t) => ({
            period: t.period,
            periodLabel: PERIOD_LABELS[t.period],
            endDate: t.endDate ?? null,
            epsAvg: toNumber(t.earningsEstimate?.avg),
            epsLow: toNumber(t.earningsEstimate?.low),
            epsHigh: toNumber(t.earningsEstimate?.high),
            epsAnalysts: toNumber(t.earningsEstimate?.numberOfAnalysts),
            epsYearAgo: toNumber(t.earningsEstimate?.yearAgoEps),
            revenueAvg: toNumber(t.revenueEstimate?.avg),
            revenueLow: toNumber(t.revenueEstimate?.low),
            revenueHigh: toNumber(t.revenueEstimate?.high),
            revenueAnalysts: toNumber(t.revenueEstimate?.numberOfAnalysts),
            revenueYearAgo: toNumber(t.revenueEstimate?.yearAgoRevenue),
            growth: toNumber(t.growth),
            eps90DaysAgo: toNumber(t.epsTrend?.['90daysAgo']),
        }));
}

export function normalizeYahooHolders(summary: YahooQuoteSummary, limit: number = 10): InstitutionalHolder[] {
    const list = summary.institutionOwnership?.ownershipList ?? [];
    return list.slice(0, limit).map((h) => ({
        organization: h.organization,
        reportDate: (h.reportDate && typeof h.reportDate === 'object' && h.reportDate.fmt) || epochToIso(toNumber(h.reportDate)),
        pctHeld: toNumber(h.pctHeld),
        shares: toNumber(h.position),
        value: toNumber(h.value),
        pctChange: toNumber(h.pctChange),
    }));
}

export function normalizeYahooOwnership(summary: YahooQuoteSummary): OwnershipBreakdown | null {
    const mh = summary.majorHoldersBreakdown;
    if (!mh) return null;
    return {
        insidersPct: toNumber(mh.insidersPercentHeld),
        institutionsPct: toNumber(mh.institutionsPercentHeld),
        institutionsFloatPct: toNumber(mh.institutionsFloatPercentHeld),
        institutionsCount: toNumber(mh.institutionsCount),
    };
}

export function normalizeYahooNextEarnings(summary: YahooQuoteSummary): string | null {
    const dates = summary.calendarEvents?.earnings?.earningsDate ?? [];
    for (const d of dates) {
        if (d && typeof d === 'object' && d.fmt) return d.fmt;
        const iso = epochToIso(toNumber(d));
        if (iso) return iso;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Nasdaq analyst consensus
// ---------------------------------------------------------------------------

export interface NasdaqTargetPayload {
    data?: {
        symbol?: string;
        consensusOverview?: {
            lowPriceTarget?: number | string | null;
            highPriceTarget?: number | string | null;
            priceTarget?: number | string | null;
            buy?: number | string | null;
            sell?: number | string | null;
            hold?: number | string | null;
        };
    } | null;
}

export function normalizeNasdaqTargets(payload: NasdaqTargetPayload, currentPrice: number | null): PriceTargetConsensus | null {
    const c = payload.data?.consensusOverview;
    if (!c) return null;
    const mean = toNumber(c.priceTarget);
    if (mean === null) return null;
    const buy = toNumber(c.buy) ?? 0;
    const hold = toNumber(c.hold) ?? 0;
    const sell = toNumber(c.sell) ?? 0;
    const total = buy + hold + sell;
    const recommendationMean = total > 0 ? (buy * 1.5 + hold * 3 + sell * 4.5) / total : null;
    return {
        source: 'nasdaq',
        currentPrice,
        mean,
        median: null,
        high: toNumber(c.highPriceTarget),
        low: toNumber(c.lowPriceTarget),
        analystCount: total > 0 ? total : null,
        recommendationMean,
        recommendationKey: total === 0 ? null : buy / total >= 0.6 ? 'buy' : sell / total >= 0.4 ? 'sell' : 'hold',
        upsidePct: upsidePct(currentPrice, mean),
    };
}

// ---------------------------------------------------------------------------
// Finnhub secondary data
// ---------------------------------------------------------------------------

export interface FinnhubRecommendationRow {
    period: string;
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
}

export interface FinnhubEarningsRow {
    period: string;
    year: number;
    quarter: number;
    estimate: number | null;
    actual: number | null;
    surprisePercent: number | null;
}

export function normalizeFinnhubRecommendations(rows: FinnhubRecommendationRow[]): RatingDistribution[] {
    return (rows ?? []).slice(0, 4).map((r) => {
        const strongBuy = toNumber(r.strongBuy) ?? 0;
        const buy = toNumber(r.buy) ?? 0;
        const hold = toNumber(r.hold) ?? 0;
        const sell = toNumber(r.sell) ?? 0;
        const strongSell = toNumber(r.strongSell) ?? 0;
        return { period: r.period, strongBuy, buy, hold, sell, strongSell, total: strongBuy + buy + hold + sell + strongSell };
    });
}

export function normalizeFinnhubSurprises(rows: FinnhubEarningsRow[]): EarningsSurprise[] {
    return (rows ?? [])
        .filter((r) => r && r.period)
        .slice(0, 8)
        .map((r) => ({
            period: r.period,
            fiscalQuarter: r.year && r.quarter ? `Q${r.quarter} ${r.year}` : r.period,
            estimate: toNumber(r.estimate),
            actual: toNumber(r.actual),
            surprisePct: toNumber(r.surprisePercent),
        }));
}

// ---------------------------------------------------------------------------
// Consensus summarisation used by the UI
// ---------------------------------------------------------------------------

export function consensusLabel(distribution: RatingDistribution | null | undefined): string {
    if (!distribution || distribution.total === 0) return 'No coverage';
    const bullish = distribution.strongBuy + distribution.buy;
    const bearish = distribution.sell + distribution.strongSell;
    const bullishShare = bullish / distribution.total;
    const bearishShare = bearish / distribution.total;
    if (bullishShare >= 0.75) return 'Strong Buy';
    if (bullishShare >= 0.5) return 'Buy';
    if (bearishShare >= 0.5) return 'Sell';
    if (bearishShare >= 0.3) return 'Underperform';
    return 'Hold';
}

/** Simple sanity check that two consensus sources roughly agree on the mean target. */
export function targetsAgree(a: PriceTargetConsensus | null, b: PriceTargetConsensus | null, tolerancePct: number = 5): boolean | null {
    if (!a?.mean || !b?.mean) return null;
    const diff = Math.abs(a.mean - b.mean) / Math.max(a.mean, b.mean) * 100;
    return diff <= tolerancePct;
}
