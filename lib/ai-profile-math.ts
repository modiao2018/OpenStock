// Pure helpers for the watchlist "AI fundamentals" card: prompt text, reply
// parsing, Finnhub basic-financials normalisation and freshness rules. No IO,
// no mongoose, so the whole thing is unit-testable.

import type { AiProfileMarket, AiProfileScore, AiProfileStance } from '@/database/models/ai-profile.model';

/** The LLM-written part is refreshed monthly (or on demand) */
export const PROFILE_TEXT_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
/** The numeric market block is refreshed daily */
export const PROFILE_MARKET_FRESH_MS = 24 * 60 * 60 * 1000;

export const SCORE_KEYS = ['density', 'maturity', 'potential', 'results'] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

const NOTE_MAX = 160;
const SUMMARY_MAX = 240;
const CAPITAL_MAX = 400;
const HIGHLIGHT_MAX = 160;
const MAX_HIGHLIGHTS = 5;
const ROLE_MAX = 40;

/** Serialisable shape sent to the client */
export interface AiProfileData {
    symbol: string;
    lang: string;
    aiRole: string;
    summary: string;
    density: AiProfileScore;
    maturity: AiProfileScore;
    potential: AiProfileScore;
    results: AiProfileScore;
    highlights: string[];
    capitalNote: string;
    stance: AiProfileStance;
    model: string;
    /** ISO */
    generatedAt: string;
    market: (Omit<AiProfileMarket, 'fetchedAt'> & { fetchedAt: string }) | null;
}

/** What the LLM must return (before persistence adds market/model/timestamps) */
export interface AiProfileText {
    aiRole: string;
    summary: string;
    density: AiProfileScore;
    maturity: AiProfileScore;
    potential: AiProfileScore;
    results: AiProfileScore;
    highlights: string[];
    capitalNote: string;
    stance: AiProfileStance;
}

export function profileKey(symbol: string, lang: string): string {
    return `${symbol.toUpperCase()}|${lang}`;
}

export function isProfileTextFresh(p: { generatedAt: Date | string }, now = Date.now()): boolean {
    return now - new Date(p.generatedAt).getTime() < PROFILE_TEXT_FRESH_MS;
}

export function isProfileMarketFresh(m: { fetchedAt: Date | string } | null | undefined, now = Date.now()): boolean {
    if (!m) return false;
    return now - new Date(m.fetchedAt).getTime() < PROFILE_MARKET_FRESH_MS;
}

/** Whether a refresh would do any upstream work for this row */
export function profileNeedsRefresh(p: AiProfileData | null | undefined, now = Date.now()): boolean {
    if (!p) return true;
    return !isProfileTextFresh(p, now) || !isProfileMarketFresh(p.market, now);
}

// ── Finnhub basic financials ──────────────────────────────────────

/** Fields read from `GET /stock/metric?metric=all` */
export interface FinnhubMetricPayload {
    metric?: Record<string, unknown>;
}

function num(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
    return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Normalise Finnhub's metric map into the stored market block. Market cap is
 * taken from the caller (already USD-normalised by the profile store) rather
 * than the metric payload, which is in the listing currency.
 */
export function normalizeMarket(
    payload: FinnhubMetricPayload | null,
    extras: { price: number | null; marketCapUsdM: number | null },
    fetchedAt: Date = new Date(),
): AiProfileMarket {
    const m = payload?.metric ?? {};
    return {
        price: extras.price,
        marketCapUsdM: extras.marketCapUsdM,
        peTtm: num(m.peTTM),
        psTtm: num(m.psTTM),
        beta: num(m.beta),
        high52: num(m['52WeekHigh']),
        low52: num(m['52WeekLow']),
        high52Date: str(m['52WeekHighDate']),
        low52Date: str(m['52WeekLowDate']),
        ret13w: num(m['13WeekPriceReturnDaily']),
        ret26w: num(m['26WeekPriceReturnDaily']),
        ret52w: num(m['52WeekPriceReturnDaily']),
        retYtd: num(m.yearToDatePriceReturnDaily),
        revenueGrowthTtm: num(m.revenueGrowthTTMYoy),
        netMarginTtm: num(m.netProfitMarginTTM),
        fetchedAt,
    };
}

/** 0..1 position of `price` inside the 52-week range; null when unknown */
export function rangePosition(m: Pick<AiProfileMarket, 'price' | 'high52' | 'low52'> | null): number | null {
    if (!m || m.price === null || m.high52 === null || m.low52 === null) return null;
    const span = m.high52 - m.low52;
    if (span <= 0) return null;
    return Math.min(1, Math.max(0, (m.price - m.low52) / span));
}

// ── Prompt ────────────────────────────────────────────────────────

export interface PromptInput {
    symbol: string;
    name: string;
    industry: string;
    lang: string;
    /** YYYY-MM-DD */
    today: string;
    market: AiProfileMarket | null;
}

function fmtPct(v: number | null): string {
    return v === null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function fmtNum(v: number | null, digits = 1): string {
    return v === null ? 'n/a' : v.toFixed(digits);
}

export function describeMarketForPrompt(m: AiProfileMarket | null): string {
    if (!m) return 'market data unavailable';
    const cap = m.marketCapUsdM === null ? 'n/a' : `$${(m.marketCapUsdM / 1000).toFixed(1)}B`;
    return [
        `price ${fmtNum(m.price, 2)}`,
        `market cap ${cap}`,
        `P/E (TTM) ${fmtNum(m.peTtm)}`,
        `P/S (TTM) ${fmtNum(m.psTtm)}`,
        `beta ${fmtNum(m.beta, 2)}`,
        `52w range ${fmtNum(m.low52, 2)} (${m.low52Date ?? '?'}) – ${fmtNum(m.high52, 2)} (${m.high52Date ?? '?'})`,
        `returns 13w ${fmtPct(m.ret13w)}, 26w ${fmtPct(m.ret26w)}, YTD ${fmtPct(m.retYtd)}, 52w ${fmtPct(m.ret52w)}`,
        `TTM revenue growth ${fmtPct(m.revenueGrowthTtm)}, TTM net margin ${fmtPct(m.netMarginTtm)}`,
    ].join('; ');
}

const SCHEMA_ZH =
    '{"aiRole": "≤12 字的短标签：它在 AI 产业链里的位置（如 AI 算力芯片龙头 / 云与大模型平台 / AI 应用软件 / 与 AI 关系较弱）",' +
    ' "summary": "≤60 字：这家公司和 AI 的关系一句话说清",' +
    ' "density": {"score": 1-5, "note": "≤40 字：AI 相关业务在营收、研发、战略中的占比有多高"},' +
    ' "maturity": {"score": 1-5, "note": "≤40 字：AI 产品或技术商业化到什么程度（实验室 / 试点 / 规模化收入）"},' +
    ' "potential": {"score": 1-5, "note": "≤40 字：未来 2-3 年 AI 能带来多大的增量空间"},' +
    ' "results": {"score": 1-5, "note": "≤40 字：已经拿到手的 AI 成果有多少"},' +
    ' "highlights": ["2-4 条已落地的 AI 成果：已发布产品、AI 相关营收或订单数字、重要客户与合作伙伴、关键里程碑；尽量带时间和数字，每条 ≤40 字"],' +
    ' "capitalNote": "≤100 字：结合下面给出的市场数据，说清资本市场怎么给它的 AI 故事定价（估值高低、机构态度）、近期走势与驱动因素",' +
    ' "stance": "bullish|neutral|bearish（市场当前对它 AI 叙事的整体态度）"}';

const SCHEMA_EN =
    '{"aiRole": "≤6-word tag: where it sits in the AI value chain (e.g. AI compute leader / cloud & model platform / AI application software / weak AI link)",' +
    ' "summary": "≤40 words: the company\'s relationship with AI in one sentence",' +
    ' "density": {"score": 1-5, "note": "≤25 words: share of revenue, R&D and strategy that is AI-related"},' +
    ' "maturity": {"score": 1-5, "note": "≤25 words: how far AI products/tech are commercialised (lab / pilot / scaled revenue)"},' +
    ' "potential": {"score": 1-5, "note": "≤25 words: incremental upside AI can add over the next 2-3 years"},' +
    ' "results": {"score": 1-5, "note": "≤25 words: how much AI has already delivered"},' +
    ' "highlights": ["2-4 delivered AI results: shipped products, AI revenue or order figures, key customers and partners, milestones; with dates and numbers where possible, ≤25 words each"],' +
    ' "capitalNote": "≤70 words: using the market data below, explain how the market prices its AI story (valuation level, institutional stance), the recent trend and its drivers",' +
    ' "stance": "bullish|neutral|bearish (the market\'s current attitude to its AI narrative)"}';

export function buildAiProfilePrompt(i: PromptInput): string {
    const marketLine = describeMarketForPrompt(i.market);
    const who = `${i.symbol}${i.name ? ` (${i.name})` : ''}${i.industry ? `, industry: ${i.industry}` : ''}`;
    if (i.lang === 'zh-CN') {
        return (
            '你是一位跟踪 AI 产业链的卖方分析师，读者是中国个人投资者，不熟悉术语，请用大白话。' +
            `请评估这家美股上市公司与 AI 的关系：${who}。\n` +
            `评分标准：1 = 几乎没有，2 = 弱，3 = 中等，4 = 强，5 = 行业顶尖。四项分别评分，评分要拉开差距，不要都给 3-4。\n` +
            '你的训练知识可能滞后，涉及"近期走势"只依据下面给出的市场数据，不要编造数字；不确定的事实不要写。' +
            `今天是 ${i.today}。市场数据（数据日期为今天，价格为报价币种，市值已折美元）：${marketLine}\n` +
            '只输出一个 JSON 对象，不要其他文字、不要 markdown 围栏：\n' +
            SCHEMA_ZH
        );
    }
    return (
        'You are a sell-side analyst covering the AI value chain, writing for retail investors in plain language. ' +
        `Assess how this US-listed company relates to AI: ${who}.\n` +
        'Scoring: 1 = almost none, 2 = weak, 3 = moderate, 4 = strong, 5 = best in class. Score the four dimensions separately and use the full range; do not cluster everything at 3-4.\n' +
        'Your training data may be stale: describe the recent trend only from the market data below and never invent numbers; omit facts you are unsure of. ' +
        `Today is ${i.today}. Market data (as of today; price in quote currency, market cap in USD): ${marketLine}\n` +
        'Output exactly one JSON object with no other text and no markdown fences:\n' +
        SCHEMA_EN
    );
}

// ── Reply parsing ─────────────────────────────────────────────────

function clampScore(v: unknown): number | null {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (!Number.isFinite(n)) return null;
    return Math.min(5, Math.max(1, Math.round(n)));
}

function text(v: unknown, max: number): string {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function score(v: unknown): AiProfileScore | null {
    const o = v as { score?: unknown; note?: unknown } | undefined;
    const s = clampScore(o?.score);
    if (s === null) return null;
    return { score: s, note: text(o?.note, NOTE_MAX) };
}

/**
 * Extract the JSON object from the model reply (tolerating ```json fences and
 * surrounding prose). Returns null when any score is missing — a card with
 * half its meters blank is worse than a retry next time.
 */
export function parseAiProfileReply(reply: string): AiProfileText | null {
    const match = reply.match(/\{[\s\S]*\}/);
    if (!match) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(match[0]);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;

    const density = score(o.density);
    const maturity = score(o.maturity);
    const potential = score(o.potential);
    const results = score(o.results);
    if (!density || !maturity || !potential || !results) return null;

    const highlights = Array.isArray(o.highlights)
        ? o.highlights
              .map((h) => text(h, HIGHLIGHT_MAX))
              .filter(Boolean)
              .slice(0, MAX_HIGHLIGHTS)
        : [];
    const stanceRaw = typeof o.stance === 'string' ? o.stance.trim().toLowerCase() : '';
    const stance: AiProfileStance =
        stanceRaw === 'bullish' || stanceRaw === 'bearish' ? stanceRaw : 'neutral';

    return {
        aiRole: text(o.aiRole, ROLE_MAX),
        summary: text(o.summary, SUMMARY_MAX),
        density,
        maturity,
        potential,
        results,
        highlights,
        capitalNote: text(o.capitalNote, CAPITAL_MAX),
        stance,
    };
}
