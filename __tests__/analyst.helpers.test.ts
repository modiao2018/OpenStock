import { describe, expect, it } from 'vitest';

import {
    consensusLabel,
    normalizeFinnhubRecommendations,
    normalizeFinnhubSurprises,
    normalizeNasdaqTargets,
    normalizeYahooEstimates,
    normalizeYahooHolders,
    normalizeYahooNextEarnings,
    normalizeYahooOwnership,
    normalizeYahooRatingChanges,
    normalizeYahooRatingTrend,
    normalizeYahooTargets,
    targetsAgree,
    upsidePct,
    type YahooQuoteSummary,
} from '@/lib/actions/analyst.helpers';

const YAHOO: YahooQuoteSummary = {
    financialData: {
        currentPrice: { raw: 268.64 },
        targetMeanPrice: { raw: 415.36 },
        targetMedianPrice: { raw: 420 },
        targetHighPrice: { raw: 500 },
        targetLowPrice: { raw: 280 },
        recommendationMean: { raw: 1.6 },
        recommendationKey: 'buy',
        numberOfAnalystOpinions: { raw: 22 },
    },
    recommendationTrend: {
        trend: [
            { period: '0m', strongBuy: 4, buy: 14, hold: 5, sell: 0, strongSell: 0 },
            { period: '-1m', strongBuy: 4, buy: 13, hold: 6, sell: 0, strongSell: 0 },
        ],
    },
    upgradeDowngradeHistory: {
        history: [
            { epochGradeDate: 1786643696, firm: 'Jefferies', toGrade: 'Buy', fromGrade: 'Buy', action: 'main', priceTargetAction: 'Raises', currentPriceTarget: 420, priorPriceTarget: 375 },
            { epochGradeDate: 1788284295, firm: 'Deutsche Bank', toGrade: 'Buy', fromGrade: '', action: 'init', priceTargetAction: 'Announces', currentPriceTarget: 400, priorPriceTarget: 0 },
            { epochGradeDate: 1, firm: '', toGrade: 'Hold', action: 'down' },
        ],
    },
    earningsTrend: {
        trend: [
            { period: '0q', endDate: '2026-09-30', growth: { raw: 0.6886 }, earningsEstimate: { avg: { raw: 1.95 }, low: { raw: 1.68 }, high: { raw: 2.04 }, numberOfAnalysts: { raw: 19 }, yearAgoEps: { raw: 1.16 } }, revenueEstimate: { avg: { raw: 2.29e9 }, numberOfAnalysts: { raw: 16 } }, epsTrend: { current: { raw: 1.95 }, '90daysAgo': { raw: 1.76 } } },
            { period: '+5y', growth: { raw: 0.3 } },
        ],
    },
    institutionOwnership: {
        ownershipList: [
            { organization: 'Blackrock Inc.', reportDate: { raw: 1782777600, fmt: '2026-06-30' }, pctHeld: { raw: 0.0848 }, position: { raw: 16608092 }, value: { raw: 4.46e9 }, pctChange: { raw: 0.1107 } },
        ],
    },
    majorHoldersBreakdown: { insidersPercentHeld: { raw: 0.044 }, institutionsPercentHeld: { raw: 0.875 }, institutionsCount: { raw: 1754 } },
    calendarEvents: { earnings: { earningsDate: [{ raw: 1793750400, fmt: '2026-11-04' }] } },
};

describe('Yahoo normalisation', () => {
    it('builds price target consensus with upside', () => {
        const t = normalizeYahooTargets(YAHOO);
        expect(t).toMatchObject({ source: 'yahoo', mean: 415.36, median: 420, high: 500, low: 280, analystCount: 22, recommendationKey: 'buy' });
        expect(t?.upsidePct).toBeCloseTo(((415.36 - 268.64) / 268.64) * 100, 5);
        expect(normalizeYahooTargets({})).toBeNull();
    });

    it('normalises the rating trend with totals', () => {
        const trend = normalizeYahooRatingTrend(YAHOO);
        expect(trend[0]).toEqual({ period: '0m', strongBuy: 4, buy: 14, hold: 5, sell: 0, strongSell: 0, total: 23 });
        expect(consensusLabel(trend[0])).toBe('Strong Buy');
    });

    it('sorts rating changes newest first, drops empty firms and blank fromGrade', () => {
        const changes = normalizeYahooRatingChanges(YAHOO);
        expect(changes.map((c) => c.firm)).toEqual(['Deutsche Bank', 'Jefferies']);
        expect(changes[0]).toMatchObject({ date: '2026-09-01', action: 'init', fromGrade: null, priceTarget: 400, priorPriceTarget: 0 });
        expect(changes[1]).toMatchObject({ date: '2026-08-13', action: 'main', priceTargetAction: 'Raises', priceTarget: 420, priorPriceTarget: 375 });
    });

    it('keeps quarterly and annual estimates, drops 5y growth rows', () => {
        const est = normalizeYahooEstimates(YAHOO);
        expect(est).toHaveLength(1);
        expect(est[0]).toMatchObject({ period: '0q', periodLabel: 'Current quarter', epsAvg: 1.95, epsAnalysts: 19, revenueAvg: 2.29e9, growth: 0.6886, eps90DaysAgo: 1.76 });
    });

    it('normalises holders, ownership breakdown and next earnings date', () => {
        expect(normalizeYahooHolders(YAHOO)[0]).toMatchObject({ organization: 'Blackrock Inc.', reportDate: '2026-06-30', pctHeld: 0.0848, shares: 16608092, pctChange: 0.1107 });
        expect(normalizeYahooOwnership(YAHOO)).toEqual({ insidersPct: 0.044, institutionsPct: 0.875, institutionsFloatPct: null, institutionsCount: 1754 });
        expect(normalizeYahooNextEarnings(YAHOO)).toBe('2026-11-04');
        expect(normalizeYahooNextEarnings({})).toBeNull();
    });
});


describe('Nasdaq and Finnhub normalisation', () => {
    it('maps Nasdaq consensus and derives a recommendation', () => {
        const t = normalizeNasdaqTargets({ data: { consensusOverview: { priceTarget: 409.06, highPriceTarget: 500, lowPriceTarget: '280', buy: 12, hold: 3, sell: 0 } } }, 268.64);
        expect(t).toMatchObject({ source: 'nasdaq', mean: 409.06, high: 500, low: 280, analystCount: 15, recommendationKey: 'buy' });
        expect(t?.recommendationMean).toBeCloseTo((12 * 1.5 + 3 * 3) / 15);
        expect(normalizeNasdaqTargets({ data: null }, 1)).toBeNull();
        expect(normalizeNasdaqTargets({ data: { consensusOverview: { priceTarget: null } } }, 1)).toBeNull();
    });

    it('normalises Finnhub recommendation rows and surprises', () => {
        const rec = normalizeFinnhubRecommendations([{ period: '2026-09-01', strongBuy: 11, buy: 18, hold: 7, sell: 0, strongSell: 0 }]);
        expect(rec[0].total).toBe(36);
        expect(consensusLabel(rec[0])).toBe('Strong Buy');

        const surprises = normalizeFinnhubSurprises([{ period: '2026-06-30', year: 2026, quarter: 2, estimate: 5.77, actual: 6.03, surprisePercent: 4.53 }]);
        expect(surprises[0]).toEqual({ period: '2026-06-30', fiscalQuarter: 'Q2 2026', estimate: 5.77, actual: 6.03, surprisePct: 4.53 });
    });
});

describe('consensus helpers', () => {
    it('labels distributions', () => {
        expect(consensusLabel(null)).toBe('No coverage');
        expect(consensusLabel({ period: '0m', strongBuy: 0, buy: 5, hold: 5, sell: 0, strongSell: 0, total: 10 })).toBe('Buy');
        expect(consensusLabel({ period: '0m', strongBuy: 0, buy: 2, hold: 5, sell: 2, strongSell: 1, total: 10 })).toBe('Underperform');
        expect(consensusLabel({ period: '0m', strongBuy: 0, buy: 0, hold: 4, sell: 4, strongSell: 2, total: 10 })).toBe('Sell');
        expect(consensusLabel({ period: '0m', strongBuy: 1, buy: 2, hold: 6, sell: 1, strongSell: 0, total: 10 })).toBe('Hold');
    });

    it('compares targets within tolerance', () => {
        const a = normalizeYahooTargets(YAHOO)!;
        const near = { ...a, mean: 409 };
        const far = { ...a, mean: 300 };
        expect(targetsAgree(a, near)).toBe(true);
        expect(targetsAgree(a, far)).toBe(false);
        expect(targetsAgree(a, null)).toBeNull();
        expect(upsidePct(0, 10)).toBeNull();
    });
});
