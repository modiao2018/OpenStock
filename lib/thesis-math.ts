// Pure logic for the short-term thesis follow-up: the user writes down why
// they suddenly care about a symbol, and the monitor daemon decides *when*
// that thought deserves a reminder. No I/O — unit-tested in
// __tests__/thesis-math.test.ts.

export type ThesisDirection = 'long' | 'short' | 'watch';
export type ThesisStatus = 'active' | 'closed' | 'expired';
export type ThesisOutcome = 'confirmed' | 'refuted' | 'abandoned';

export type ThesisTriggerId =
    | 'stop'
    | 'target'
    | 'horizonPassed'
    | 'horizonSoon'
    | 'urgentEvent'
    | 'newEvent'
    | 'bigMove'
    | 'checkin';

/** Generic single-stock benchmark for the signal ledger (AI pool uses QQQ, biotech XBI) */
export const THESIS_BENCHMARK = 'SPY';
export const DEFAULT_HORIZON_DAYS = 14;
/** Nudge the user when nothing else has fired for this many days */
export const DEFAULT_CHECKIN_DAYS = 3;
/** Price move since the last alert (or entry) that is worth a follow-up, in percent */
export const DEFAULT_MOVE_PCT = 7;
export const MAX_NOTE_CHARS = 2000;

const DAY_MS = 86_400_000;

export function isValidIsoDate(v: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

export interface ThesisNewItem {
    /** Source label shown to the user, e.g. "SEC 申报" / "内部人" */
    kind: string;
    title: string;
    urgent: boolean;
}

export interface ThesisHits {
    target?: boolean;
    stop?: boolean;
    horizonSoon?: boolean;
}

export interface ThesisEvalInput {
    direction: ThesisDirection;
    entryPrice: number | null;
    targetPrice: number | null;
    stopPrice: number | null;
    /** YYYY-MM-DD */
    horizonDate: string;
    /** YYYY-MM-DD "today" in the market's session date */
    today: string;
    price: number | null;
    /** Price at the last follow-up push; null before the first */
    lastAlertPrice: number | null;
    hits: ThesisHits;
    /** Events / trades on the symbol that appeared since the last check */
    newItems: ThesisNewItem[];
    createdAtMs: number;
    lastFollowupAtMs: number | null;
    nowMs: number;
    checkinDays: number;
    movePct: number;
}

export interface ThesisTrigger {
    id: ThesisTriggerId;
    /** Short Chinese detail for the push body */
    detail: string;
    urgent: boolean;
}

export interface ThesisEvaluation {
    /** Sorted by priority (most actionable first); empty = nothing to say */
    triggers: ThesisTrigger[];
    /** Horizon date has passed: push a final review and retire the thesis */
    expired: boolean;
    daysLeft: number;
    changePct: number | null;
}

const PRIORITY: ThesisTriggerId[] = ['stop', 'urgentEvent', 'target', 'horizonPassed', 'horizonSoon', 'bigMove', 'newEvent', 'checkin'];

export const TRIGGER_ZH: Record<ThesisTriggerId, string> = {
    stop: '触及失效价',
    urgentEvent: '紧急事件',
    target: '达到目标价',
    horizonPassed: '已到截止日',
    horizonSoon: '即将到期',
    bigMove: '价格大幅波动',
    newEvent: '有新信息',
    checkin: '定期回顾',
};

export const DIRECTION_ZH: Record<ThesisDirection, string> = { long: '偏多', short: '偏空', watch: '方向未定' };

/**
 * AI 把一个不成熟的点子梳理成可检验的框架：观点一句话、什么算验证、
 * 什么算证伪、跟进时要盯的关键词。用户只写了方向或一句话也能生成。
 */
export interface ThesisFraming {
    thesis: string;
    confirm: string[];
    refute: string[];
    keywords: string[];
    /** 用户可以自己去补的问题（想法不成熟时帮着往前推一步） */
    questions: string[];
}

const strList = (v: unknown, max: number, len: number): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).trim().slice(0, len)).slice(0, max) : [];
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** LLM 从一段自由文本里整理出的完整记录：标的 + 倾向 + 用户提到的价位/期限 + 可检验框架 */
export interface ThesisStructured {
    symbol: string | null;
    name: string | null;
    direction: ThesisDirection;
    entryPrice: number | null;
    targetPrice: number | null;
    stopPrice: number | null;
    horizonDate: string | null;
    framing: ThesisFraming;
}

/** 容忍 ```json 围栏和前后废话；字段缺失就给空/null。fixedSymbol 优先于模型识别 */
export function parseStructured(reply: string, fixedSymbol?: string): ThesisStructured | null {
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
        const o = JSON.parse(m[0]) as Record<string, unknown>;
        const thesis = typeof o.thesis === 'string' ? o.thesis.trim().slice(0, 200) : '';
        if (!thesis) return null;
        const rawSymbol = typeof o.symbol === 'string' ? o.symbol.trim().toUpperCase() : '';
        const symbol = fixedSymbol?.toUpperCase() ?? (/^[A-Z][A-Z0-9.-]{0,9}$/.test(rawSymbol) ? rawSymbol : null);
        const direction: ThesisDirection = o.direction === 'long' || o.direction === 'short' ? o.direction : 'watch';
        const horizon = typeof o.horizonDate === 'string' && isValidIsoDate(o.horizonDate) ? o.horizonDate : null;
        return {
            symbol,
            name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : null,
            direction,
            entryPrice: numOrNull(o.entryPrice),
            targetPrice: numOrNull(o.targetPrice),
            stopPrice: numOrNull(o.stopPrice),
            horizonDate: horizon,
            framing: {
                thesis,
                confirm: strList(o.confirm, 4, 120),
                refute: strList(o.refute, 4, 120),
                keywords: strList(o.keywords, 8, 40),
                questions: strList(o.questions, 3, 120),
            },
        };
    } catch {
        return null;
    }
}

/** 新闻是否和这条想法相关：关键词子串（≥3 字符）或代码全词匹配 */
export function matchesThesisKeywords(text: string, keywords: string[], symbol: string): boolean {
    const lower = text.toLowerCase();
    if (keywords.some((k) => k.trim().length >= 3 && lower.includes(k.trim().toLowerCase()))) return true;
    return symbol.length >= 2 && new RegExp(`(^|[^A-Za-z0-9])\\$?${symbol}(?![A-Za-z0-9])`).test(text);
}

export const fmtPrice = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `$${v.toFixed(2)}`);
export const fmtPct = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

export function pctChange(from: number | null, to: number | null): number | null {
    if (from === null || to === null || from <= 0) return null;
    return (to / from - 1) * 100;
}

/** Calendar days from `today` to `date` (negative when `date` is in the past) */
export function daysUntil(today: string, date: string): number {
    return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export function shiftDate(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * Target / stop semantics follow the direction: a long (or watch) thesis
 * confirms when price rises to the target and fails when it falls to the
 * stop; a short thesis is the mirror image.
 */
export function evaluateThesis(i: ThesisEvalInput): ThesisEvaluation {
    const t: ThesisTrigger[] = [];
    const daysLeft = daysUntil(i.today, i.horizonDate);
    const changePct = pctChange(i.entryPrice, i.price);
    const short = i.direction === 'short';
    const price = i.price;

    if (price !== null) {
        if (i.stopPrice !== null && !i.hits.stop) {
            const hit = short ? price >= i.stopPrice : price <= i.stopPrice;
            if (hit) t.push({ id: 'stop', detail: `现价 ${fmtPrice(price)} ${short ? '涨破' : '跌破'}失效价 ${fmtPrice(i.stopPrice)}`, urgent: true });
        }
        if (i.targetPrice !== null && !i.hits.target) {
            const hit = short ? price <= i.targetPrice : price >= i.targetPrice;
            if (hit) t.push({ id: 'target', detail: `现价 ${fmtPrice(price)} 已${short ? '跌到' : '涨到'}目标价 ${fmtPrice(i.targetPrice)}`, urgent: false });
        }
    }

    if (daysLeft < 0) {
        t.push({ id: 'horizonPassed', detail: `截止日 ${i.horizonDate} 已过，做最终回顾并结束跟进`, urgent: false });
    } else if (daysLeft <= 1 && !i.hits.horizonSoon) {
        t.push({ id: 'horizonSoon', detail: daysLeft === 0 ? `今天（${i.horizonDate}）到期` : `明天（${i.horizonDate}）到期`, urgent: false });
    }

    const urgentItems = i.newItems.filter((n) => n.urgent);
    if (urgentItems.length > 0) {
        t.push({ id: 'urgentEvent', detail: urgentItems.map((n) => `[${n.kind}] ${n.title}`).join('；'), urgent: true });
    } else if (i.newItems.length > 0) {
        t.push({ id: 'newEvent', detail: `${i.newItems.length} 条新信息`, urgent: false });
    }

    const ref = i.lastAlertPrice ?? i.entryPrice;
    const move = pctChange(ref, price);
    if (move !== null && Math.abs(move) >= i.movePct) {
        t.push({ id: 'bigMove', detail: `较${i.lastAlertPrice !== null ? '上次提醒' : '入场'}${fmtPct(move)}`, urgent: false });
    }

    if (t.length === 0) {
        const last = i.lastFollowupAtMs ?? i.createdAtMs;
        if (i.checkinDays > 0 && i.nowMs - last >= i.checkinDays * DAY_MS) {
            t.push({ id: 'checkin', detail: `${i.checkinDays} 天没有新动静，回顾一下观点是否还成立`, urgent: false });
        }
    }

    t.sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id));
    return { triggers: t, expired: daysLeft < 0, daysLeft, changePct };
}

export interface ThesisStatusLine {
    symbol: string;
    direction: ThesisDirection;
    entryPrice: number | null;
    price: number | null;
    changePct: number | null;
    targetPrice: number | null;
    stopPrice: number | null;
    daysLeft: number;
}

/** One-line status used in pushes and as the fallback when no LLM is configured */
export function formatThesisStatus(s: ThesisStatusLine): string {
    const parts = [`${s.symbol} ${DIRECTION_ZH[s.direction]}`];
    if (s.price !== null) parts.push(`现价 ${fmtPrice(s.price)}${s.changePct !== null ? `（较入场 ${fmtPct(s.changePct)}）` : ''}`);
    const levels = [s.targetPrice !== null ? `目标 ${fmtPrice(s.targetPrice)}` : null, s.stopPrice !== null ? `失效 ${fmtPrice(s.stopPrice)}` : null].filter(Boolean);
    if (levels.length > 0) parts.push(levels.join(' / '));
    parts.push(s.daysLeft < 0 ? `已过期 ${-s.daysLeft} 天` : s.daysLeft === 0 ? '今天到期' : `剩 ${s.daysLeft} 天`);
    return parts.join('｜');
}

/** Push title: the highest-priority trigger names the reason */
export function thesisPushTitle(symbol: string, triggers: ThesisTrigger[]): string {
    const head = triggers[0] ? TRIGGER_ZH[triggers[0].id] : '跟进';
    return `洞察跟进｜${symbol} ${head}`;
}
