// Pure helpers for thematic research notes: the LLM revision prompt, reply
// validation, and symbol bookkeeping. No IO so it is unit-testable and
// shared by the web action and the daemon collector.

import type {
    MomentumGroup,
    MomentumRank,
    MomentumRow,
    ResearchEntry,
    ResearchMomentum,
    ResearchThemeContent,
    ResearchTier,
    ResearchTierTone,
    TrackingCard,
} from '@/database/models/research-theme.model';

export const RESEARCH_TONES: ResearchTierTone[] = ['core', 'validation', 'speculative', 'tools'];
/** How many previous snapshots a theme keeps */
export const MAX_REVISIONS = 6;
/** The daemon re-checks a theme at most this often */
export const RESEARCH_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_CHANGES = 12;
const TEXT_MAX = 400;
const SHORT_MAX = 120;

/** Serialisable theme for the client */
export interface ResearchThemeData extends Omit<ResearchThemeContent, 'momentum'> {
    momentum: (Omit<ResearchMomentum, 'computedAt'> & { computedAt: string | null }) | null;
    slug: string;
    lang: string;
    version: number;
    updatedAt: string;
    updatedBy: 'seed' | 'llm' | 'admin';
    changes: string[];
    checkedAt: string | null;
    revisions: { version: number; updatedAt: string; updatedBy: 'seed' | 'llm' | 'admin'; changes: string[] }[];
}

export function themeSymbols(t: Pick<ResearchThemeContent, 'tiers'>): string[] {
    const seen = new Set<string>();
    for (const tier of t.tiers) for (const e of tier.entries) seen.add(e.symbol.toUpperCase());
    return [...seen];
}

// ── Prompt ────────────────────────────────────────────────────────

export interface RevisionInput {
    theme: ResearchThemeContent;
    /** Per-symbol fact lines (market data, recent headlines); missing symbols are fine */
    facts: Map<string, string[]>;
    /** YYYY-MM-DD */
    today: string;
    lang: string;
}

export function buildRevisionPrompt(i: RevisionInput): string {
    const factBlock = themeSymbols(i.theme)
        .map((s) => {
            const lines = i.facts.get(s) ?? [];
            return `${s}:\n${lines.length ? lines.map((l) => `  - ${l}`).join('\n') : '  - (no new data)'}`;
        })
        .join('\n');
    // Framework sections are static text; numbers are never the model's to
    // change (they go in as a read-only table); only prose is in the editable JSON
    const { momentum, sections: _sections, ...rest } = i.theme;
    void _sections;
    const content = JSON.stringify(momentum ? { ...rest, momentum: momentumProse(momentum) } : rest);
    const momentumBlock = momentum ? `\n\n${i.lang === 'zh-CN' ? '走势数据（只读，已由系统按日线重算）' : 'Momentum data (read-only, recomputed from daily bars)'}:\n${momentumTable(momentum)}` : '';
    if (i.lang === 'zh-CN') {
        return (
            '你是一位跟踪 AI 与生物科技交叉领域的卖方分析师，负责维护下面这份结构化研究笔记，读者是中国个人投资者。' +
            `今天是 ${i.today}。请根据"最新事实"复核笔记，只在事实支持时修改：\n` +
            '1. 每家公司的 thesis（关注理由）和 risk（主要风险）要反映最新进展：新的收入数字、临床数据、获批、指引变化、重大合作、融资或安全性事件。' +
            '没有新事实的条目原样保留，不要为了改而改，不要改写措辞。\n' +
            '2. 只有当事实明显改变了"已兑现进展 / 未来弹性"的判断时才把公司在梯队间移动，并在 changes 里说明原因；不要新增或删除公司；tiers 的 key、tone、顺序和 shortlist.groups 的 key 必须原样保留。\n' +
            '3. 不要编造数字；不确定的不写。文字用大白话，thesis/risk 各不超过 120 字。\n' +
            '4. changes 用 1 句话一条描述你改了什么（含公司代码）。cards 是公司跟踪卡片：progress（最新进展）和 catalysts（后续催化剂）要随新事实更新，' +
            'failConditions（失效条件）只在出现新的失效风险时补充；触发了失效条件要在 verdict 里明确写出。\n' +
            (momentum
                ? '5. momentum 块里的数字由系统重算，你只维护文字：每行的 verdict（一句判断）、groups 的成员和 note、ranking 的顺序和 reason、spotlight。' +
                  '按"成长性、近期动量、回撤控制"综合判断；一家公司只能在一个 group 里；ranking 和 groups 只能用 momentum 表里出现的代码。\n'
                : '') +
            '只输出一个 JSON 对象，且只包含需要修改的部分（补丁），不要复述整份笔记；没有实质修改就只输出 {"changes": []}。补丁格式（各字段都可省略）：\n' +
            PATCH_SCHEMA_ZH +
            '\n\n' +
            `当前笔记（JSON）:\n${content}${momentumBlock}\n\n最新事实:\n${factBlock}`
        );
    }
    return (
        'You are a sell-side analyst covering the intersection of AI and biotech, maintaining the structured research note below for retail investors. ' +
        `Today is ${i.today}. Review the note against the "latest facts" and edit only where the facts support it:\n` +
        '1. Each company\'s thesis and risk must reflect new developments: revenue figures, clinical data, approvals, guidance changes, major partnerships, financing or safety events. Leave entries without new facts untouched; do not reword for its own sake.\n' +
        '2. Move a company between tiers only when the facts clearly change the "delivered progress / future upside" judgement, and explain why in changes; never add or remove companies; keep tier keys, tones, order and shortlist group keys exactly as given.\n' +
        '3. Never invent numbers; omit what you are unsure of. Plain language, thesis/risk under 80 words each.\n' +
        '4. changes: one sentence per edit (with the ticker). cards are per-company tracking cards: update progress and catalysts as facts arrive; ' +
        'extend failConditions only for genuinely new failure risks; if a fail condition has triggered, say so in verdict.\n' +
        (momentum
            ? '5. The numbers in the momentum block are recomputed by the system; you maintain only the prose: each row\'s verdict, group membership and notes, ranking order and reasons, and the spotlight. ' +
              'Judge on growth, recent momentum and drawdown control together; a company belongs to at most one group; ranking and groups may only use tickers from the momentum table.\n'
            : '') +
        'Output exactly one JSON object containing only what changes (a patch); never repeat the whole note. When nothing material changed output just {"changes": []}. Patch format (every field optional):\n' +
        PATCH_SCHEMA_EN +
        '\n\n' +
        `Current note (JSON):\n${content}${momentumBlock}\n\nLatest facts:\n${factBlock}`
    );
}

const PATCH_SCHEMA_ZH =
    '{"changes": ["一句话一条"],' +
    ' "entries": [{"symbol": "代码", "thesis": "新的关注理由", "risk": "新的主要风险", "tier": "要移到的梯队 key"}],' +
    ' "tiers": [{"key": "梯队 key", "subtitle": "新副标题", "note": "新结语"}],' +
    ' "shortlist": {"symbols": ["完整新名单"], "groups": [{"key": "分组 key", "symbols": ["完整新成员"]}]},' +
    ' "caveats": ["完整新列表"],' +
    ' "cards": [{"symbol": "代码", "progress": "新的最新进展", "catalysts": "新的后续催化剂", "failConditions": "新的失效条件", "verdict": "新判断"}],' +
    ' "momentum": {"summary": "新的走势解读", "rows": [{"symbol": "代码", "verdict": "新判断"}],' +
    ' "groups": [{"key": "组 key", "symbols": ["完整新成员"], "note": "新说明"}],' +
    ' "ranking": [{"symbol": "代码", "reason": "理由"}], "spotlight": {"symbol": "代码", "text": "新聚焦说明"}}}';

const PATCH_SCHEMA_EN =
    '{"changes": ["one sentence each"],' +
    ' "entries": [{"symbol": "TICKER", "thesis": "new thesis", "risk": "new risks", "tier": "tier key to move to"}],' +
    ' "tiers": [{"key": "tier key", "subtitle": "new subtitle", "note": "new closing note"}],' +
    ' "shortlist": {"symbols": ["full new list"], "groups": [{"key": "group key", "symbols": ["full new members"]}]},' +
    ' "caveats": ["full new list"],' +
    ' "cards": [{"symbol": "TICKER", "progress": "new latest progress", "catalysts": "new upcoming catalysts", "failConditions": "new fail conditions", "verdict": "new verdict"}],' +
    ' "momentum": {"summary": "new reading of the table", "rows": [{"symbol": "TICKER", "verdict": "new verdict"}],' +
    ' "groups": [{"key": "group key", "symbols": ["full new members"], "note": "new note"}],' +
    ' "ranking": [{"symbol": "TICKER", "reason": "why"}], "spotlight": {"symbol": "TICKER", "text": "new spotlight"}}}';

/** The editable (prose) half of the momentum block */
function momentumProse(m: ResearchMomentum) {
    return {
        title: m.title,
        summary: m.summary,
        rows: m.rows.map((r) => ({ symbol: r.symbol, verdict: r.verdict })),
        groups: m.groups.map((g) => ({ key: g.key, title: g.title, subtitle: g.subtitle, symbols: g.symbols, note: g.note })),
        ranking: m.ranking,
        spotlight: m.spotlight,
    };
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const ma = (v: boolean | null) => (v === null ? '?' : v ? 'above' : 'below');

export function momentumTable(m: ResearchMomentum): string {
    const head = `window ${m.windowStart} → ${m.windowEnd} (${m.sessions} sessions); benchmark ${m.benchmarkSymbol} ${pct(m.benchmarkReturnPct)}`;
    const rows = m.rows.map(
        (r) => `${r.symbol}: return ${pct(r.returnPct)}, max drawdown ${pct(r.maxDrawdownPct)}, MA20 ${ma(r.aboveMa20)}, MA50 ${ma(r.aboveMa50)}${r.nearHigh ? ', near window high' : ''}; ${r.technical}`,
    );
    return [head, ...rows].join('\n');
}

// ── Reply validation ──────────────────────────────────────────────

export interface RevisionResult {
    theme: ResearchThemeContent;
    changes: string[];
}

function text(v: unknown, max: number, fallback = ''): string {
    return typeof v === 'string' ? v.trim().slice(0, max) : fallback;
}

function strings(v: unknown, max: number, limit: number): string[] {
    return Array.isArray(v) ? v.map((s) => text(s, max)).filter(Boolean).slice(0, limit) : [];
}

/**
 * Parse the model reply against the current theme. The structure (tier keys,
 * tones, order, company set, group keys) is enforced from `current`; only
 * the prose and the tier/group membership of known symbols may change. Any
 * structural drift returns null so a broken rewrite never replaces the note.
 */
export function parseRevisionReply(reply: string, current: ResearchThemeContent): RevisionResult | null {
    const match = reply.match(/\{[\s\S]*\}/);
    if (!match) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(match[0]);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as { theme?: unknown; changes?: unknown; tiers?: unknown };
    // A full note (wrapped in {theme} or bare) is still accepted; anything
    // else is treated as a patch — the format the prompt asks for
    const wrapped = !!o.theme && typeof o.theme === 'object';
    const bareNote = Array.isArray(o.tiers) && (o.tiers as unknown[]).some((t) => Array.isArray((t as { entries?: unknown })?.entries));
    if (!wrapped && !bareNote) return applyPatch(o as RevisionPatch, current);
    const t = (wrapped ? o.theme : o) as Partial<ResearchThemeContent>;
    if (!Array.isArray(t.tiers)) return null;

    const known = new Map<string, ResearchEntry>();
    for (const tier of current.tiers) for (const e of tier.entries) known.set(e.symbol.toUpperCase(), e);

    // Tiers: same keys in the same order; entries only from the known set, each at most once
    if (t.tiers.length !== current.tiers.length) return null;
    const placed = new Set<string>();
    const tiers: ResearchTier[] = [];
    for (let i = 0; i < current.tiers.length; i++) {
        const cur = current.tiers[i];
        const nt = t.tiers[i] as Partial<ResearchTier> | undefined;
        if (!nt || nt.key !== cur.key || !Array.isArray(nt.entries)) return null;
        const entries: ResearchEntry[] = [];
        for (const raw of nt.entries as Partial<ResearchEntry>[]) {
            const symbol = text(raw?.symbol, 12).toUpperCase();
            const prev = known.get(symbol);
            if (!prev || placed.has(symbol)) return null;
            placed.add(symbol);
            entries.push({
                symbol,
                name: text(raw?.name, SHORT_MAX, prev.name) || prev.name,
                thesis: text(raw?.thesis, TEXT_MAX, prev.thesis) || prev.thesis,
                risk: text(raw?.risk, TEXT_MAX, prev.risk),
                tag: text(raw?.tag, SHORT_MAX, prev.tag),
            });
        }
        tiers.push({
            key: cur.key,
            tone: cur.tone,
            title: text(nt.title, SHORT_MAX, cur.title) || cur.title,
            subtitle: text(nt.subtitle, TEXT_MAX, cur.subtitle),
            entries,
            note: text(nt.note, TEXT_MAX, cur.note),
            thesisLabel: cur.thesisLabel,
            riskLabel: cur.riskLabel,
        });
    }
    if (placed.size !== known.size) return null;

    // Shortlist: symbols must be known; groups keep their keys and order
    const sl = (t.shortlist ?? {}) as Partial<ResearchThemeContent['shortlist']>;
    const shortSymbols = strings(sl.symbols, 12, 40)
        .map((s) => s.toUpperCase())
        .filter((s) => known.has(s));
    const groupsIn = Array.isArray(sl.groups) ? (sl.groups as Partial<ResearchThemeContent['shortlist']['groups'][number]>[]) : [];
    const groups = current.shortlist.groups.map((g, i) => {
        const ng = groupsIn[i];
        const symbols = ng && ng.key === g.key ? strings(ng.symbols, 12, 40).map((s) => s.toUpperCase()).filter((s) => known.has(s)) : g.symbols;
        return { key: g.key, label: (ng && ng.key === g.key ? text(ng.label, SHORT_MAX, g.label) : g.label) || g.label, symbols };
    });

    const momentum = current.momentum ? mergeMomentumProse(current.momentum, t.momentum) : null;
    if (current.momentum && !momentum) return null;
    const cards = mergeCards(current.cards, t.cards);

    return {
        theme: {
            title: text(t.title, SHORT_MAX, current.title) || current.title,
            intro: text(t.intro, TEXT_MAX * 2, current.intro) || current.intro,
            tiers,
            shortlist: {
                title: text(sl.title, SHORT_MAX, current.shortlist.title) || current.shortlist.title,
                symbols: shortSymbols.length > 0 ? shortSymbols : current.shortlist.symbols,
                groups,
                reasons: mergeReasons(current.shortlist.reasons, sl.reasons, known),
                note: typeof sl.note === 'string' ? text(sl.note, TEXT_MAX * 2) : current.shortlist.note,
            },
            caveats: strings(t.caveats, TEXT_MAX, 10).length > 0 ? strings(t.caveats, TEXT_MAX, 10) : current.caveats,
            momentum,
            sections: current.sections,
            cards,
        },
        changes: wrapped ? strings(o.changes, TEXT_MAX, MAX_CHANGES) : [],
    };
}

/** Card prose from the model onto the current cards; the card set itself is fixed */
function mergeCards(cur: TrackingCard[], raw: unknown): TrackingCard[] {
    if (!Array.isArray(raw)) return cur;
    const byKey = new Map<string, Partial<TrackingCard>>();
    for (const c of raw as Partial<TrackingCard>[]) {
        const symbol = text(c?.symbol, 12).toUpperCase();
        if (symbol) byKey.set(symbol, c);
    }
    return cur.map((c) => {
        const n = byKey.get(c.symbol);
        if (!n) return c;
        const field = (k: keyof TrackingCard, max: number) => (typeof n[k] === 'string' ? text(n[k], max) : c[k]);
        return {
            symbol: c.symbol,
            title: field('title', SHORT_MAX) || c.title,
            coreAsset: field('coreAsset', TEXT_MAX) || c.coreAsset,
            progress: field('progress', TEXT_MAX * 2),
            catalysts: field('catalysts', TEXT_MAX * 2),
            failConditions: field('failConditions', TEXT_MAX * 2),
            verdict: field('verdict', TEXT_MAX),
        };
    });
}

function mergeReasons(cur: { symbol: string; reason: string }[], raw: unknown, known: Map<string, unknown> | Set<string>): { symbol: string; reason: string }[] {
    if (!Array.isArray(raw)) return cur;
    const out: { symbol: string; reason: string }[] = [];
    const seen = new Set<string>();
    for (const r of raw as Partial<{ symbol: string; reason: string }>[]) {
        const symbol = text(r?.symbol, 12).toUpperCase();
        if (!known.has(symbol) || seen.has(symbol)) continue;
        seen.add(symbol);
        out.push({ symbol, reason: text(r?.reason, TEXT_MAX) });
    }
    return out.length > 0 ? out : cur;
}

/** What the model is asked to return: only the fields that change */
interface RevisionPatch {
    changes?: unknown;
    title?: unknown;
    intro?: unknown;
    entries?: unknown;
    tiers?: unknown;
    shortlist?: unknown;
    caveats?: unknown;
    momentum?: unknown;
    cards?: unknown;
}

function applyPatch(p: RevisionPatch, current: ResearchThemeContent): RevisionResult | null {
    const theme: ResearchThemeContent = JSON.parse(JSON.stringify(current)) as ResearchThemeContent;
    if (current.momentum?.computedAt) theme.momentum!.computedAt = new Date(current.momentum.computedAt);
    const tierByKey = new Map(theme.tiers.map((t) => [t.key, t]));
    const entryTier = new Map<string, ResearchTier>();
    for (const t of theme.tiers) for (const e of t.entries) entryTier.set(e.symbol, t);

    if (text(p.title, SHORT_MAX)) theme.title = text(p.title, SHORT_MAX);
    if (text(p.intro, TEXT_MAX * 2)) theme.intro = text(p.intro, TEXT_MAX * 2);

    // Company prose and moves; unknown tickers and tier keys are ignored
    if (Array.isArray(p.entries)) {
        for (const raw of p.entries as Partial<ResearchEntry & { tier: string }>[]) {
            const symbol = text(raw?.symbol, 12).toUpperCase();
            const from = entryTier.get(symbol);
            if (!from) continue;
            const entry = from.entries.find((e) => e.symbol === symbol)!;
            if (text(raw?.thesis, TEXT_MAX)) entry.thesis = text(raw.thesis, TEXT_MAX);
            if (typeof raw?.risk === 'string') entry.risk = text(raw.risk, TEXT_MAX);
            if (text(raw?.name, SHORT_MAX)) entry.name = text(raw.name, SHORT_MAX);
            const to = text(raw?.tier, 40) ? tierByKey.get(text(raw.tier, 40)) : undefined;
            if (to && to !== from) {
                from.entries = from.entries.filter((e) => e.symbol !== symbol);
                to.entries.push(entry);
                entryTier.set(symbol, to);
            }
        }
    }

    if (Array.isArray(p.tiers)) {
        for (const raw of p.tiers as Partial<ResearchTier>[]) {
            const tier = tierByKey.get(text(raw?.key, 40));
            if (!tier) continue;
            if (text(raw?.title, SHORT_MAX)) tier.title = text(raw.title, SHORT_MAX);
            if (typeof raw?.subtitle === 'string') tier.subtitle = text(raw.subtitle, TEXT_MAX);
            if (typeof raw?.note === 'string') tier.note = text(raw.note, TEXT_MAX);
        }
    }

    const known = new Set(entryTier.keys());
    if (p.shortlist && typeof p.shortlist === 'object') {
        const sl = p.shortlist as Partial<ResearchThemeContent['shortlist']>;
        const symbols = strings(sl.symbols, 12, 40).map((x) => x.toUpperCase()).filter((x) => known.has(x));
        if (symbols.length > 0) theme.shortlist.symbols = symbols;
        theme.shortlist.reasons = mergeReasons(theme.shortlist.reasons, sl.reasons, known);
        if (typeof sl.note === 'string') theme.shortlist.note = text(sl.note, TEXT_MAX * 2);
        if (Array.isArray(sl.groups)) {
            for (const raw of sl.groups as Partial<ResearchThemeContent['shortlist']['groups'][number]>[]) {
                const g = theme.shortlist.groups.find((x) => x.key === text(raw?.key, 40));
                if (!g) continue;
                if (Array.isArray(raw?.symbols)) g.symbols = strings(raw.symbols, 12, 40).map((x) => x.toUpperCase()).filter((x) => known.has(x));
                if (text(raw?.label, SHORT_MAX)) g.label = text(raw.label, SHORT_MAX);
            }
        }
    }

    if (Array.isArray(p.caveats) && strings(p.caveats, TEXT_MAX, 10).length > 0) theme.caveats = strings(p.caveats, TEXT_MAX, 10);

    if (theme.momentum && p.momentum && typeof p.momentum === 'object') {
        const merged = mergeMomentumProse(theme.momentum, { ...p.momentum, rows: (p.momentum as { rows?: unknown }).rows ?? [] });
        if (merged) theme.momentum = merged;
    }

    theme.cards = mergeCards(theme.cards, p.cards);

    return { theme, changes: strings(p.changes, TEXT_MAX, MAX_CHANGES) };
}

/**
 * Take only the prose of the model's momentum block onto the current one:
 * numbers, row set, session window and group keys stay as they are. Returns
 * null when the model dropped the block or used unknown tickers.
 */
function mergeMomentumProse(cur: ResearchMomentum, raw: unknown): ResearchMomentum | null {
    if (!raw || typeof raw !== 'object') return null;
    const m = raw as { title?: unknown; summary?: unknown; rows?: unknown; groups?: unknown; ranking?: unknown; spotlight?: unknown };
    const known = new Set(cur.rows.map((r) => r.symbol));
    const verdicts = new Map<string, string>();
    if (Array.isArray(m.rows)) {
        for (const r of m.rows as Partial<MomentumRow>[]) {
            const symbol = text(r?.symbol, 12).toUpperCase();
            if (known.has(symbol)) verdicts.set(symbol, text(r?.verdict, TEXT_MAX));
        }
    }
    const rows = cur.rows.map((r) => ({ ...r, verdict: verdicts.get(r.symbol) || r.verdict }));

    const groupsIn = Array.isArray(m.groups) ? (m.groups as Partial<MomentumGroup>[]) : [];
    const placed = new Set<string>();
    const groups = cur.groups.map((g) => {
        const ng = groupsIn.find((x) => x?.key === g.key);
        const symbols = (ng && Array.isArray(ng.symbols) ? strings(ng.symbols, 12, 40).map((s) => s.toUpperCase()) : g.symbols)
            .filter((s) => known.has(s) && !placed.has(s));
        for (const s of symbols) placed.add(s);
        if (!ng) return { ...g, symbols };
        return {
            key: g.key,
            title: text(ng.title, SHORT_MAX, g.title) || g.title,
            subtitle: typeof ng.subtitle === 'string' ? text(ng.subtitle, TEXT_MAX) : g.subtitle,
            symbols,
            note: typeof ng.note === 'string' ? text(ng.note, TEXT_MAX * 2) : g.note,
        };
    });

    const seen = new Set<string>();
    const ranking: MomentumRank[] = [];
    if (Array.isArray(m.ranking)) {
        for (const r of m.ranking as Partial<MomentumRank>[]) {
            const symbol = text(r?.symbol, 12).toUpperCase();
            if (!known.has(symbol) || seen.has(symbol)) continue;
            seen.add(symbol);
            ranking.push({ symbol, reason: text(r?.reason, TEXT_MAX) });
        }
    }

    let spotlight = cur.spotlight;
    if (m.spotlight === null) spotlight = null;
    else if (m.spotlight && typeof m.spotlight === 'object') {
        const sp = m.spotlight as Partial<{ symbol: string; text: string }>;
        const symbol = text(sp.symbol, 12).toUpperCase();
        if (known.has(symbol) && text(sp.text, TEXT_MAX * 2)) spotlight = { symbol, text: text(sp.text, TEXT_MAX * 2) };
    }

    return {
        ...cur,
        title: text(m.title, SHORT_MAX, cur.title) || cur.title,
        summary: typeof m.summary === 'string' && text(m.summary, TEXT_MAX * 2) ? text(m.summary, TEXT_MAX * 2) : cur.summary,
        rows,
        groups,
        ranking: ranking.length > 0 ? ranking : cur.ranking,
        spotlight,
    };
}

// Key-order-insensitive serialisation: the parsers rebuild objects in their
// own field order, which must not count as a change
function stableStringify(v: unknown): string {
    if (v instanceof Date) return JSON.stringify(v.toISOString());
    if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
    if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
    }
    return JSON.stringify(v) ?? 'null';
}

/** True when the revised content differs from the current one in any field */
export function contentChanged(a: ResearchThemeContent, b: ResearchThemeContent): boolean {
    return stableStringify(a) !== stableStringify(b);
}

/** Human-readable diff of tier membership, used when the model forgot to list a move */
export function tierMoves(before: ResearchThemeContent, after: ResearchThemeContent): string[] {
    const tierOf = (t: ResearchThemeContent) => {
        const m = new Map<string, string>();
        for (const tier of t.tiers) for (const e of tier.entries) m.set(e.symbol, tier.title);
        return m;
    };
    const b = tierOf(before);
    const a = tierOf(after);
    const out: string[] = [];
    for (const [symbol, tier] of a) {
        const prev = b.get(symbol);
        if (prev && prev !== tier) out.push(`${symbol}: ${prev} → ${tier}`);
    }
    return out;
}
