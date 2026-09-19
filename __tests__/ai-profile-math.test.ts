import { describe, expect, it } from 'vitest';
import {
    buildAiProfilePrompt,
    describeMarketForPrompt,
    isProfileMarketFresh,
    isProfileTextFresh,
    normalizeMarket,
    parseAiProfileReply,
    profileKey,
    profileNeedsRefresh,
    PROFILE_MARKET_FRESH_MS,
    PROFILE_TEXT_FRESH_MS,
    rangePosition,
    type AiProfileData,
} from '@/lib/ai-profile-math';

const REPLY = `Here you go:
\`\`\`json
{"aiRole": "AI 算力芯片龙头", "summary": "数据中心 GPU 事实标准。",
 "density": {"score": 5, "note": "数据中心占营收八成以上"},
 "maturity": {"score": "5", "note": "规模化收入"},
 "potential": {"score": 4.4, "note": "推理需求"},
 "results": {"score": 9, "note": "过高会被截断"},
 "highlights": ["Blackwell 量产", "", 42, "与微软合作"],
 "capitalNote": "估值处于高位。", "stance": "Bullish"}
\`\`\``;

describe('parseAiProfileReply', () => {
    it('tolerates fences and prose, clamps and rounds scores, drops junk highlights', () => {
        const p = parseAiProfileReply(REPLY);
        expect(p).not.toBeNull();
        expect(p!.aiRole).toBe('AI 算力芯片龙头');
        expect(p!.density.score).toBe(5);
        expect(p!.maturity.score).toBe(5);
        expect(p!.potential.score).toBe(4);
        expect(p!.results.score).toBe(5);
        expect(p!.highlights).toEqual(['Blackwell 量产', '与微软合作']);
        expect(p!.stance).toBe('bullish');
    });

    it('returns null when a score is missing or the JSON is broken', () => {
        expect(parseAiProfileReply('{"density": {"score": 3}}')).toBeNull();
        expect(parseAiProfileReply('no json here')).toBeNull();
        expect(parseAiProfileReply('{"density": {"score": 3}, "maturity": {"score": "x"}, "potential": {"score": 1}, "results": {"score": 1}}')).toBeNull();
    });

    it('defaults an unknown stance to neutral', () => {
        const p = parseAiProfileReply('{"density": {"score": 1}, "maturity": {"score": 1}, "potential": {"score": 1}, "results": {"score": 1}, "stance": "meh"}');
        expect(p!.stance).toBe('neutral');
        expect(p!.highlights).toEqual([]);
        expect(p!.summary).toBe('');
    });
});

describe('normalizeMarket / rangePosition', () => {
    const payload = {
        metric: {
            peTTM: 45.2, psTTM: 20.1, beta: 1.8,
            '52WeekHigh': 200, '52WeekLow': 100, '52WeekHighDate': '2026-08-01', '52WeekLowDate': '2025-10-01',
            '13WeekPriceReturnDaily': 5.5, '26WeekPriceReturnDaily': -3, '52WeekPriceReturnDaily': 40, yearToDatePriceReturnDaily: 12,
            revenueGrowthTTMYoy: 55, netProfitMarginTTM: 'oops',
        },
    };

    it('maps Finnhub metric names and ignores non-numeric values', () => {
        const m = normalizeMarket(payload, { price: 150, marketCapUsdM: 3_000_000 }, new Date('2026-09-19T00:00:00Z'));
        expect(m.peTtm).toBe(45.2);
        expect(m.high52).toBe(200);
        expect(m.high52Date).toBe('2026-08-01');
        expect(m.ret26w).toBe(-3);
        expect(m.netMarginTtm).toBeNull();
        expect(m.marketCapUsdM).toBe(3_000_000);
        expect(rangePosition(m)).toBe(0.5);
    });

    it('survives an empty payload and clamps the range position', () => {
        const m = normalizeMarket(null, { price: 500, marketCapUsdM: null });
        expect(m.peTtm).toBeNull();
        expect(rangePosition(m)).toBeNull();
        expect(rangePosition({ price: 500, high52: 200, low52: 100 })).toBe(1);
        expect(rangePosition({ price: 50, high52: 200, low52: 100 })).toBe(0);
        expect(rangePosition({ price: 50, high52: 100, low52: 100 })).toBeNull();
    });
});

describe('prompt', () => {
    it('embeds the market numbers and picks the language', () => {
        const market = normalizeMarket({ metric: { '52WeekHigh': 200, '52WeekLow': 100, '13WeekPriceReturnDaily': 5 } }, { price: 150, marketCapUsdM: 2500 });
        const zh = buildAiProfilePrompt({ symbol: 'NVDA', name: 'NVIDIA', industry: 'Semiconductors', lang: 'zh-CN', today: '2026-09-19', market });
        expect(zh).toContain('NVDA (NVIDIA), industry: Semiconductors');
        expect(zh).toContain('13w +5.0%');
        expect(zh).toContain('$2.5B');
        expect(zh).toContain('"aiRole"');
        expect(zh).toMatch(/大白话/);
        const en = buildAiProfilePrompt({ symbol: 'NVDA', name: '', industry: '', lang: 'en', today: '2026-09-19', market: null });
        expect(en).toContain('market data unavailable');
        expect(en).toMatch(/sell-side analyst/);
        expect(describeMarketForPrompt(null)).toBe('market data unavailable');
    });
});

describe('freshness', () => {
    const now = Date.now();
    const base: AiProfileData = {
        symbol: 'NVDA', lang: 'zh-CN', aiRole: '', summary: '',
        density: { score: 1, note: '' }, maturity: { score: 1, note: '' }, potential: { score: 1, note: '' }, results: { score: 1, note: '' },
        highlights: [], capitalNote: '', stance: 'neutral', model: '',
        generatedAt: new Date(now - 1000).toISOString(),
        market: null,
    };

    it('key is symbol|lang, upper-cased', () => {
        expect(profileKey('nvda', 'en')).toBe('NVDA|en');
    });

    it('text window is 30 days, market window one day', () => {
        expect(isProfileTextFresh({ generatedAt: new Date(now - PROFILE_TEXT_FRESH_MS + 1000) }, now)).toBe(true);
        expect(isProfileTextFresh({ generatedAt: new Date(now - PROFILE_TEXT_FRESH_MS - 1000) }, now)).toBe(false);
        expect(isProfileMarketFresh({ fetchedAt: new Date(now - PROFILE_MARKET_FRESH_MS + 1000) }, now)).toBe(true);
        expect(isProfileMarketFresh({ fetchedAt: new Date(now - PROFILE_MARKET_FRESH_MS - 1000) }, now)).toBe(false);
        expect(isProfileMarketFresh(null, now)).toBe(false);
    });

    it('profileNeedsRefresh when missing, text stale or market stale', () => {
        expect(profileNeedsRefresh(null, now)).toBe(true);
        expect(profileNeedsRefresh(base, now)).toBe(true); // market null
        const market = { ...normalizeMarket(null, { price: 1, marketCapUsdM: null }, new Date(now - 1000)), fetchedAt: new Date(now - 1000).toISOString() };
        expect(profileNeedsRefresh({ ...base, market }, now)).toBe(false);
        expect(profileNeedsRefresh({ ...base, market, generatedAt: new Date(now - PROFILE_TEXT_FRESH_MS - 1).toISOString() }, now)).toBe(true);
    });
});
