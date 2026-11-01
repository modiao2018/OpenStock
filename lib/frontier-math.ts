/**
 * 生物科技前沿（/frontier）的纯函数：主题匹配、事件合并、原文核对、
 * 临床阶段归纳、主题篮子收益、13F 持仓对比、LLM 预算。
 * daemon 与网页端共用，不碰数据库和网络（__tests__/frontier-math.test.ts）。
 */

export type TickerTier = 'pure' | 'pharma' | 'tools';

export interface ThemeTicker {
    symbol: string;
    company: string;
    tier: TickerTier;
    /** 公司名以外的匹配词（简称、旧名） */
    aliases?: string[];
}

export interface ThemeDef {
    key: string;
    keywords: string[];
    tickers: ThemeTicker[];
}

const COMPANY_SUFFIX = /\b(inc|corp|corporation|co|company|ltd|limited|plc|llc|lp|ag|sa|nv|holdings|group)\b\.?/gi;

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 关键词命中规则：全大写的短词（ADC、AI、GLP-1）区分大小写全词匹配——
 * 否则 "ai" 会命中 "said"、"adc" 会命中 "ADCs" 以外的乱七八糟；
 * 其他词不区分大小写，按词边界匹配。
 */
export function keywordHit(text: string, keyword: string): boolean {
    const k = keyword.trim();
    if (!k) return false;
    const caseSensitive = k.length <= 6 && k === k.toUpperCase() && /[A-Z]/.test(k);
    const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(k)}(?![A-Za-z0-9])`, caseSensitive ? '' : 'i');
    return re.test(text);
}

/** 公司名去掉法律后缀后的主体（"Eli Lilly and Company" → "Eli Lilly and"→ 去尾 "and"） */
export function companyCore(company: string): string {
    return company
        .replace(COMPANY_SUFFIX, ' ')
        .replace(/[,.]/g, ' ')
        .replace(/\s+(and|&)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 新闻稿惯用的交易所标注："(Nasdaq: RXRX)"、"NYSE: LLY"、"$TEM"。
 * 这是唯一认 ticker 字面的方式——裸写的 TEM/GH 太容易撞普通单词。
 */
export function extractExchangeTickers(text: string): string[] {
    const out = new Set<string>();
    const re = /\b(?:NASDAQ|Nasdaq|NYSE(?:\s+American)?|Nasdaq\s?(?:GS|GM|CM)|NasdaqGS|NasdaqGM)\s*:\s*([A-Z]{1,5})\b/g;
    for (const m of text.matchAll(re)) out.add(m[1]);
    for (const m of text.matchAll(/(?:^|\s)\$([A-Z]{2,5})\b/g)) out.add(m[1]);
    return [...out];
}

export interface ThemeMatch {
    themes: string[];
    /** 命中的主题标的（公司名/别名或交易所标注） */
    tickers: string[];
    /** 文中出现的交易所标注 ticker（可能不在主题标的里） */
    exchangeTickers: string[];
    /** 是否有关键词命中（区别于只靠公司名命中） */
    keywordHit: boolean;
}

export function matchThemes(text: string, themes: ThemeDef[]): ThemeMatch {
    const exchangeTickers = extractExchangeTickers(text);
    const exch = new Set(exchangeTickers);
    const hitThemes = new Set<string>();
    const tickers = new Set<string>();
    let kwHit = false;
    for (const theme of themes) {
        if (theme.keywords.some((k) => keywordHit(text, k))) {
            hitThemes.add(theme.key);
            kwHit = true;
        }
        for (const t of theme.tickers) {
            const names = [companyCore(t.company), ...(t.aliases ?? [])].filter((n) => n.length >= 4);
            if (exch.has(t.symbol) || names.some((n) => keywordHit(text, n))) {
                tickers.add(t.symbol);
                // 只有纯概念股能代表主题：礼来出现在新闻里不等于这是 AI 制药新闻，
                // 大药企/工具股要靠关键词才能把条目归入主题
                if (t.tier === 'pure') hitThemes.add(theme.key);
            }
        }
    }
    return { themes: [...hitThemes], tickers: [...tickers], exchangeTickers, keywordHit: kwHit };
}

// ── 事件合并 ──────────────────────────────────────────────────────

const STOPWORDS = new Set([
    'the', 'a', 'an', 'of', 'to', 'in', 'for', 'on', 'and', 'or', 'with', 'by', 'at', 'from', 'as', 'its', 'is',
    'are', 'be', 'after', 'into', 'over', 'new', 'says', 'said', 'will', 'has', 'have', 'inc', 'announces',
    'announce', 'reports', 'report', 'update', 'updates',
]);

export function titleTokens(title: string): Set<string> {
    return new Set(
        title
            .toLowerCase()
            // 付费墙前缀（"STAT+: "）和弯引号不算内容
            .replace(/^[a-z]+\+:\s*/, '')
            .replace(/[‘’'“”]/g, '')
            .replace(/[^a-z0-9\s-]/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
            // 粗略词干：beats/beat、trials/trial 视为同词
            .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)),
    );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    return inter / (a.size + b.size - inter);
}

/** 同一件事被多家转载的判定阈值：标题词集重合度 */
export const SAME_STORY_JACCARD = 0.6;

/** 在候选事件里找与该标题讲同一件事的那个；没有返回 null */
export function findSameStory<T extends { titles: string[] }>(title: string, candidates: T[]): T | null {
    const tokens = titleTokens(title);
    let best: T | null = null;
    let bestScore = SAME_STORY_JACCARD;
    for (const c of candidates) {
        for (const t of c.titles) {
            const s = jaccard(tokens, titleTokens(t));
            if (s >= bestScore) {
                best = c;
                bestScore = s;
            }
        }
    }
    return best;
}

// ── 原文核对（防 LLM 编造） ───────────────────────────────────────

export function normalizeForMatch(s: string): string {
    return s
        .toLowerCase()
        .replace(/[‘’“”"']/g, '')
        .replace(/[‐-―]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

const SHINGLE = 6;
/** 长引文允许的转抄误差：6 词片段至少这么多比例在原文里能找到 */
export const QUOTE_SHINGLE_MIN = 0.85;

function wordsOf(s: string): string[] {
    return normalizeForMatch(s).replace(/[^\p{L}\p{N}$%.\s-]/gu, ' ').split(/\s+/).filter(Boolean);
}

/**
 * 引文是否确实出自原文：规范化空白/引号/破折号后做子串匹配；
 * 长引文（法律文书常见）LLM 偶尔漏抄一个词，按 6 词片段命中率放宽——编造的句子过不了这关
 */
export function quoteInSource(quote: string, source: string): boolean {
    const q = normalizeForMatch(quote);
    if (q.length < 8) return false;
    const src = normalizeForMatch(source);
    if (src.includes(q)) return true;
    const qw = wordsOf(quote);
    if (qw.length < SHINGLE * 2) return false;
    const srcJoined = ` ${wordsOf(source).join(' ')} `;
    let hit = 0;
    let total = 0;
    for (let i = 0; i + SHINGLE <= qw.length; i++) {
        total++;
        if (srcJoined.includes(` ${qw.slice(i, i + SHINGLE).join(' ')} `)) hit++;
    }
    return hit / total >= QUOTE_SHINGLE_MIN;
}

/** 文本里的数字（去千分位、去末尾 .0），年份也算——年份错了一样是错 */
export function numbersIn(text: string): string[] {
    return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '').replace(/\.0+$/, ''));
}

/** 短语（如金额 "$75 million"）是否原样出现在原文里；比引文核对宽松，允许短串 */
export function phraseInSource(phrase: string, source: string): boolean {
    const p = normalizeForMatch(phrase);
    if (p.length < 3) return false;
    return normalizeForMatch(source).includes(p);
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** 事实陈述里出现的每个数字都必须在引文里出现过（引文日期里的英文月份名算作对应数字："August 27" ↔ 8 月） */
export function numbersSupported(text: string, quote: string): boolean {
    const available = new Set(numbersIn(quote));
    const lower = quote.toLowerCase();
    MONTH_NAMES.forEach((m, i) => {
        // 只认紧挨日期数字的月份名（"August 27" / "27 August"），"may receive" 里的 may 不算 5 月
        if (new RegExp(`\\b${m}\\s+\\d|\\d\\s+${m}\\b`).test(lower)) available.add(String(i + 1));
    });
    return numbersIn(text).every((n) => available.has(n));
}

export interface FactCheck {
    text: string;
    quote: string;
    verified: boolean;
}

export function checkFact(fact: { text: string; quote: string }, source: string): FactCheck {
    const verified = quoteInSource(fact.quote, source) && numbersSupported(fact.text, fact.quote);
    return { text: fact.text, quote: fact.quote, verified };
}

/**
 * "$1.2 billion" / "$250M" / "US$75 million" → 美元数；认不出返回 null。
 * 只解析原文写法，中文金额（12 亿美元）不认——提示词要求金额保留原文。
 */
export function parseUsd(text: string): number | null {
    const m = text.replace(/,/g, '').match(/(?:US)?\$\s?(\d+(?:\.\d+)?)\s*(billion|bn|b|million|mm|m|thousand|k)?\b/i);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    const unit = (m[2] ?? '').toLowerCase();
    if (unit === 'billion' || unit === 'bn' || unit === 'b') return n * 1e9;
    if (unit === 'million' || unit === 'mm' || unit === 'm') return n * 1e6;
    if (unit === 'thousand' || unit === 'k') return n * 1e3;
    return n;
}

export function formatUsd(usd: number | null | undefined): string {
    if (usd === null || usd === undefined || !Number.isFinite(usd)) return '—';
    if (usd >= 1e9) return `$${(usd / 1e9).toFixed(usd >= 1e10 ? 0 : 1)}B`;
    if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
    return `$${Math.round(usd).toLocaleString('en-US')}`;
}

/** 从 LLM 回复里抠出第一个 JSON 对象/数组；解析失败返回 null */
export function parseJsonLoose<T>(reply: string): T | null {
    const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : reply;
    const start = body.search(/[[{]/);
    if (start < 0) return null;
    const open = body[start];
    const close = open === '{' ? '}' : ']';
    const end = body.lastIndexOf(close);
    if (end <= start) return null;
    try {
        return JSON.parse(body.slice(start, end + 1)) as T;
    } catch {
        return null;
    }
}

// ── FDA 专家委员会公告 ────────────────────────────────────────────


/** Federal Register 的 dates 字段："The meeting will be held on October 30, 2026, from…" → 2026-10-30 */
export function parseMeetingDate(text: string | null | undefined): string | null {
    if (!text) return null;
    const m = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i);
    if (!m) return null;
    const month = MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1;
    return `${m[3]}-${String(month).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

// ── 临床阶段归纳（AI 药物记分板） ─────────────────────────────────

const PHASE_RANK: Record<string, number> = { EARLY_PHASE1: 0.5, PHASE1: 1, PHASE2: 2, PHASE3: 3, PHASE4: 4 };
const ACTIVE_STATUSES = new Set(['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION']);
// 同一最高阶段有多个试验时报哪个状态：已完成（数据已出/待公布）最有信息量，其次是进行中
const STATUS_RANK: Record<string, number> = {
    COMPLETED: 5, ACTIVE_NOT_RECRUITING: 4, RECRUITING: 3, ENROLLING_BY_INVITATION: 2, NOT_YET_RECRUITING: 1,
};

/** 登记库日期可能只到月（2027-02），比较时按月末算 */
function endOfPeriod(date: string): string {
    return date.length === 7 ? `${date}-31` : date;
}
const DEAD_STATUSES = new Set(['WITHDRAWN', 'TERMINATED', 'SUSPENDED']);

export interface RegistryTrial {
    nctId: string;
    phases: string[];
    status: string;
    primaryCompletion?: string;
}

export interface RegistrySummary {
    /** 未终止试验里的最高阶段（0 = 无有效试验） */
    maxPhase: number;
    leadStatus: string | null;
    /** 进行中试验里最近的主要完成日（≈下次数据读出的最早时间） */
    nextReadout: string | null;
    trialCount: number;
    nctIds: string[];
}

export function trialPhase(phases: string[]): number {
    return Math.max(0, ...phases.map((p) => PHASE_RANK[p] ?? 0));
}

export function summarizeRegistry(trials: RegistryTrial[], today: string): RegistrySummary {
    let maxPhase = 0;
    let leadStatus: string | null = null;
    let nextReadout: string | null = null;
    for (const t of trials) {
        const phase = trialPhase(t.phases);
        if (!DEAD_STATUSES.has(t.status) && phase >= maxPhase) {
            if (phase > maxPhase || leadStatus === null || (STATUS_RANK[t.status] ?? 0) > (STATUS_RANK[leadStatus] ?? 0)) {
                leadStatus = t.status;
            }
            maxPhase = phase;
        }
        if (ACTIVE_STATUSES.has(t.status) && t.primaryCompletion && endOfPeriod(t.primaryCompletion) >= today) {
            if (!nextReadout || endOfPeriod(t.primaryCompletion) < endOfPeriod(nextReadout)) nextReadout = t.primaryCompletion;
        }
    }
    return { maxPhase, leadStatus, nextReadout, trialCount: trials.length, nctIds: trials.map((t) => t.nctId).sort() };
}

export function phaseLabel(phase: number): string {
    if (phase >= 4) return 'P4';
    if (phase >= 3) return 'P3';
    if (phase >= 2) return 'P2';
    if (phase >= 1) return 'P1';
    if (phase > 0) return 'P0';
    return '—';
}

// ── 主题篮子 ──────────────────────────────────────────────────────

export interface CloseBar {
    date: string;
    c: number;
}

/** 最后一根相对 n 根之前的收益率（%）；数据不够返回 null */
export function trailingReturn(bars: CloseBar[], n: number): number | null {
    if (bars.length <= n) return null;
    const last = bars[bars.length - 1].c;
    const base = bars[bars.length - 1 - n].c;
    if (!(base > 0)) return null;
    return ((last - base) / base) * 100;
}

export const BASKET_WINDOWS = [5, 20, 60] as const;
export type BasketWindow = (typeof BASKET_WINDOWS)[number];

export interface BasketStat {
    /** 等权平均收益 % */
    ret: Record<BasketWindow, number | null>;
    /** 相对基准的超额 % */
    excess: Record<BasketWindow, number | null>;
    members: Array<{ symbol: string; ret20: number | null }>;
}

export function basketStat(bars: Record<string, CloseBar[]>, members: string[], benchmark: string): BasketStat {
    const ret = {} as Record<BasketWindow, number | null>;
    const excess = {} as Record<BasketWindow, number | null>;
    for (const w of BASKET_WINDOWS) {
        const rs = members.map((s) => trailingReturn(bars[s] ?? [], w)).filter((r): r is number => r !== null);
        ret[w] = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
        const b = trailingReturn(bars[benchmark] ?? [], w);
        excess[w] = ret[w] !== null && b !== null ? ret[w]! - b : null;
    }
    return { ret, excess, members: members.map((s) => ({ symbol: s, ret20: trailingReturn(bars[s] ?? [], 20) })) };
}

// ── 13F 持仓对比 ──────────────────────────────────────────────────

export interface Holding13F {
    issuer: string;
    cusip: string;
    value: number;
    shares: number;
    /** 期权行（Put/Call）不算持股 */
    putCall?: string | null;
}

export type HoldingChangeKind = 'new' | 'add' | 'trim' | 'exit';

export interface HoldingChange {
    issuer: string;
    cusip: string;
    change: HoldingChangeKind;
    value: number;
    prevValue: number;
    shares: number;
    prevShares: number;
}

function aggregate(rows: Holding13F[]): Map<string, Holding13F> {
    const out = new Map<string, Holding13F>();
    for (const r of rows) {
        if (r.putCall) continue;
        const prev = out.get(r.cusip);
        if (prev) {
            prev.value += r.value;
            prev.shares += r.shares;
        } else {
            out.set(r.cusip, { ...r });
        }
    }
    return out;
}

/** 股数变动 ≥ 该比例才算加/减仓，避免把小幅调仓刷成信号 */
export const HOLDING_CHANGE_MIN = 0.2;

export function diffHoldings(prev: Holding13F[], cur: Holding13F[]): HoldingChange[] {
    const p = aggregate(prev);
    const c = aggregate(cur);
    const out: HoldingChange[] = [];
    for (const [cusip, h] of c) {
        const old = p.get(cusip);
        if (!old) {
            out.push({ issuer: h.issuer, cusip, change: 'new', value: h.value, prevValue: 0, shares: h.shares, prevShares: 0 });
            continue;
        }
        const delta = old.shares > 0 ? (h.shares - old.shares) / old.shares : 0;
        if (delta >= HOLDING_CHANGE_MIN || delta <= -HOLDING_CHANGE_MIN) {
            out.push({
                issuer: h.issuer, cusip, change: delta > 0 ? 'add' : 'trim',
                value: h.value, prevValue: old.value, shares: h.shares, prevShares: old.shares,
            });
        }
    }
    for (const [cusip, old] of p) {
        if (!c.has(cusip)) {
            out.push({ issuer: old.issuer, cusip, change: 'exit', value: 0, prevValue: old.value, shares: 0, prevShares: old.shares });
        }
    }
    return out.sort((a, b) => Math.abs(b.value - b.prevValue) - Math.abs(a.value - a.prevValue));
}

// ── LLM 预算 ──────────────────────────────────────────────────────

export type LlmPurpose = 'triage' | 'deep' | 'weekly';

export const DEFAULT_DAILY_LLM_BUDGET = 40;

/**
 * 分拣是"看得见"的底线，深度分析是锦上添花：深度分析给分拣和周报留出余量，
 * 周报每周只有一两次，允许在额度用尽后小幅超出，免得周一早上恰好没额度。
 */
export function canSpend(purpose: LlmPurpose, used: number, budget: number): boolean {
    if (purpose === 'weekly') return used < budget + 3;
    if (purpose === 'triage') return used < budget;
    const reserve = Math.min(6, Math.ceil(budget * 0.2));
    return used < budget - reserve;
}

// ── 推送与信号 ────────────────────────────────────────────────────

/** 只有重要度 5（改变行业格局）且是 24 小时内的新消息才即时推送 */
export function shouldPushNow(importance: number, publishedAt: Date | null, now: Date): boolean {
    if (importance < 5) return false;
    if (!publishedAt) return true;
    return now.getTime() - publishedAt.getTime() <= 24 * 3600_000;
}

export type BeneficiaryRelation = 'direct' | 'indirect' | 'hurt';

/** 记入信号账本的方向：直接受益看多、受损看空；间接受益太弱，不记 */
export function beneficiarySignals(
    items: Array<{ symbol: string; relation: BeneficiaryRelation }>,
    max = 3,
): Array<{ symbol: string; direction: 'up' | 'down' }> {
    const out: Array<{ symbol: string; direction: 'up' | 'down' }> = [];
    const seen = new Set<string>();
    for (const b of items) {
        if (b.relation === 'indirect' || seen.has(b.symbol) || !/^[A-Z]{1,5}$/.test(b.symbol)) continue;
        seen.add(b.symbol);
        out.push({ symbol: b.symbol, direction: b.relation === 'hurt' ? 'down' : 'up' });
        if (out.length >= max) break;
    }
    return out;
}

/** 美国 ticker 形状校验（LLM 输出的代码只认这个形状） */
export function isTickerShape(s: unknown): s is string {
    return typeof s === 'string' && /^[A-Z]{1,5}$/.test(s);
}

/** 北京日期 YYYY-MM-DD */
export function beijingDateOf(d: Date): string {
    return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

export function isoWeekOf(d: Date): string {
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${week}`;
}

/** 两个 YYYY-MM-DD 之间的天数（b - a） */
export function daysBetween(a: string, b: string): number {
    return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
    ndash: '–', mdash: '—', hellip: '…', reg: '®', trade: '™', copy: '©',
};

/** HTML/RSS 片段转纯文本：去标签、解实体、压空白 */
export function cleanHtmlText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!\[CDATA\[|\]\]>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
        .replace(/\s+/g, ' ')
        .trim();
}
