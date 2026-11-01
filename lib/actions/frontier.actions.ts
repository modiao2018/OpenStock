'use server';

import mongoose from 'mongoose';
import { revalidatePath } from 'next/cache';
import { connectToDatabase } from '@/database/mongoose';
import { CatalystKv, CatalystWatchItem } from '@/database/models/catalyst.model';
import {
    FrontierConference,
    FrontierDeal,
    FrontierEvent,
    FrontierFund,
    FrontierItem,
    FrontierMilestone,
    FrontierReport,
    FrontierTheme,
    type DealAmountDoc,
    type FrontierAnalysisDoc,
    type FrontierEventType,
    type FundChangeDoc,
    type IFrontierMilestone,
} from '@/database/models/frontier.model';
import { ensureFrontierSeed } from '@/lib/frontier-db';
import { beijingDateOf, companyCore, DEFAULT_DAILY_LLM_BUDGET, type BasketStat, type TickerTier } from '@/lib/frontier-math';
import { resolveLlmConfig } from '@/lib/llm-config';
import { getSession } from '@/lib/get-session';

/**
 * 生物科技前沿页（/frontier）的读写入口。数据由 catalyst-monitor 的 frontier 采集器写入；
 * 这里只读展示，以及管理主题、AI 药物记分板、会议日历和 LLM 每日额度。
 */

// 与 catalyst-monitor/src/frontier 下的 KV 键保持一致
const BUDGET_KEY = 'frontier_llm_budget';
const usageKey = (date: string) => `frontier_llm_usage:${date}`;
const BASKETS_KEY = 'frontier_baskets';
const PAPERS_KEY = 'frontier_papers';
const SOURCE_IDS = ['news', 'deals', 'fda', 'baskets', 'trials', 'papers', 'funds'] as const;
const COLLECTORS = ['frontier-ingest', 'frontier-brain', 'frontier-weekly'] as const;

async function requireUser(): Promise<void> {
    const session = await getSession();
    if (!session?.user?.id) throw new Error('Not signed in');
}

async function kv(key: string): Promise<string | null> {
    const doc = await CatalystKv.findOne({ key }).lean();
    return doc?.value ?? null;
}

function parse<T>(raw: string | null): T | null {
    if (!raw) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

// ── 总览 ──────────────────────────────────────────────────────────

export interface ThemeTickerData {
    symbol: string;
    company: string;
    tier: TickerTier;
    aliases: string[];
}

export interface FrontierThemeData {
    id: string;
    key: string;
    name: string;
    nameEn: string;
    description: string;
    keywords: string[];
    trialTerm: string;
    trialField: 'query.intr' | 'query.cond';
    tickers: ThemeTickerData[];
    enabled: boolean;
    basket: BasketStat | null;
    /** 近 7 天事件数 / 其中 4–5 星 */
    weekCount: number;
    hotCount: number;
}

export interface SourceStatusData {
    id: string;
    at: string | null;
    ok: boolean | null;
    added: number;
    seen: number;
    error: string | null;
}

export interface FrontierOverview {
    themes: FrontierThemeData[];
    benchmark: string;
    basketsAt: string | null;
    llm: { configured: boolean; used: number; budget: number; triage: number; deep: number; weekly: number };
    sources: SourceStatusData[];
    collectors: Array<{ name: string; lastRun: string | null; error: string | null }>;
    pendingProposals: number;
    proposedDrugs: number;
}

export async function getFrontierOverview(): Promise<FrontierOverview> {
    await connectToDatabase();
    await ensureFrontierSeed();
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [themes, counts, basketsRaw, budgetRaw, usageRaw, llm, milestones, proposedDrugs] = await Promise.all([
        FrontierTheme.find().sort({ order: 1, key: 1 }).lean(),
        FrontierEvent.aggregate<{ _id: string; n: number; hot: number }>([
            { $match: { firstSeenAt: { $gte: since }, dismissed: false } },
            { $unwind: '$themes' },
            { $group: { _id: '$themes', n: { $sum: 1 }, hot: { $sum: { $cond: [{ $gte: ['$importance', 4] }, 1, 0] } } } },
        ]),
        kv(BASKETS_KEY),
        kv(BUDGET_KEY),
        kv(usageKey(beijingDateOf(new Date()))),
        resolveLlmConfig().catch(() => null),
        FrontierMilestone.find({ status: 'active' }).select({ proposals: 1 }).lean(),
        FrontierMilestone.countDocuments({ status: 'proposed' }),
    ]);
    const baskets = parse<{ computedAt: string; benchmark: string; themes: Record<string, BasketStat> }>(basketsRaw);
    const usage = parse<{ total: number; triage: number; deep: number; weekly: number }>(usageRaw);
    const countMap = new Map(counts.map((c) => [c._id, c]));
    const budget = Number(budgetRaw) > 0 ? Number(budgetRaw) : DEFAULT_DAILY_LLM_BUDGET;

    const sources: SourceStatusData[] = [];
    for (const id of SOURCE_IDS) {
        const s = parse<{ at: string; ok: boolean; added: number; seen: number; error?: string }>(await kv(`frontier_src:${id}`));
        sources.push({ id, at: s?.at ?? null, ok: s ? s.ok : null, added: s?.added ?? 0, seen: s?.seen ?? 0, error: s?.error ?? null });
    }
    const collectors = [];
    for (const name of COLLECTORS) {
        const err = parse<{ message: string }>(await kv(`collector_last_error:${name}`));
        collectors.push({ name, lastRun: await kv(`collector_last_run:${name}`), error: err?.message ?? null });
    }

    return {
        themes: themes.map((t) => ({
            id: String(t._id),
            key: t.key,
            name: t.name,
            nameEn: t.nameEn ?? '',
            description: t.description ?? '',
            keywords: t.keywords ?? [],
            trialTerm: t.trialQuery?.term ?? '',
            trialField: t.trialQuery?.field ?? 'query.intr',
            tickers: (t.tickers ?? []).map((x) => ({ symbol: x.symbol, company: x.company, tier: x.tier, aliases: x.aliases ?? [] })),
            enabled: t.enabled,
            basket: baskets?.themes?.[t.key] ?? null,
            weekCount: countMap.get(t.key)?.n ?? 0,
            hotCount: countMap.get(t.key)?.hot ?? 0,
        })),
        benchmark: baskets?.benchmark ?? 'XBI',
        basketsAt: baskets?.computedAt ?? null,
        llm: {
            configured: Boolean(llm),
            used: usage?.total ?? 0,
            budget,
            triage: usage?.triage ?? 0,
            deep: usage?.deep ?? 0,
            weekly: usage?.weekly ?? 0,
        },
        sources,
        collectors,
        pendingProposals: milestones.reduce((n, m) => n + (m.proposals?.length ?? 0), 0),
        proposedDrugs,
    };
}

// ── 事件流 ────────────────────────────────────────────────────────

export interface FrontierEventData {
    id: string;
    title: string;
    titleZh: string;
    eventType: FrontierEventType;
    themes: string[];
    tickers: string[];
    importance: number | null;
    why: string;
    triageMode: 'llm' | 'rule';
    sources: Array<{ source: string; feed: string; title: string; url: string | null; publishedAt: string | null }>;
    sourceCount: number;
    firstSeenAt: string;
    publishedAt: string | null;
    analysis: FrontierAnalysisDoc | null;
    pushed: boolean;
}

export async function getFrontierEvents(opts: { theme?: string; minImportance?: number; days?: number; limit?: number } = {}): Promise<FrontierEventData[]> {
    try {
        await connectToDatabase();
        const filter: Record<string, unknown> = {
            dismissed: false,
            firstSeenAt: { $gte: new Date(Date.now() - (opts.days ?? 14) * 86_400_000) },
        };
        if (opts.theme) filter.themes = opts.theme;
        if (opts.minImportance) filter.importance = { $gte: opts.minImportance };
        const docs = await FrontierEvent.find(filter).sort({ firstSeenAt: -1 }).limit(opts.limit ?? 200).lean();
        return docs.map((d) => ({
            id: String(d._id),
            title: d.title,
            titleZh: d.titleZh || d.title,
            eventType: d.eventType,
            themes: d.themes ?? [],
            tickers: d.tickers ?? [],
            importance: d.importance ?? null,
            why: d.why ?? '',
            triageMode: d.triageMode ?? 'llm',
            sources: (d.sources ?? []).map((s) => ({
                source: s.source,
                feed: s.feed,
                title: s.title,
                url: s.url ?? null,
                publishedAt: iso(s.publishedAt),
            })),
            sourceCount: d.sourceCount ?? 1,
            firstSeenAt: new Date(d.firstSeenAt).toISOString(),
            publishedAt: iso(d.publishedAt),
            analysis: (d.analysis as FrontierAnalysisDoc | null) ?? null,
            pushed: Boolean(d.pushedAt),
        }));
    } catch (error) {
        console.error('getFrontierEvents failed', error);
        return [];
    }
}

export async function dismissFrontierEvent(id: string): Promise<{ success: true }> {
    await requireUser();
    await connectToDatabase();
    await FrontierEvent.updateOne({ _id: id }, { $set: { dismissed: true } });
    revalidatePath('/frontier');
    return { success: true };
}

/** 从前沿事件一键加进催化剂监控清单；已在清单里的不覆盖（保留用户配好的试验与预案） */
export async function addToCatalystWatch(symbol: string, company: string): Promise<{ status: 'added' | 'exists' }> {
    await requireUser();
    await connectToDatabase();
    const sym = symbol.toUpperCase().trim();
    if (!/^[A-Z]{1,5}$/.test(sym)) throw new Error('invalid symbol');
    if (await CatalystWatchItem.exists({ symbol: sym })) return { status: 'exists' };
    const name = company.trim() || sym;
    const core = companyCore(name);
    await CatalystWatchItem.create({
        symbol: sym,
        company: name,
        nctIds: [],
        keywords: core && core !== name ? [core] : [],
        autoDiscover: true,
    });
    revalidatePath('/catalyst');
    return { status: 'added' };
}

// ── AI 药物记分板 ─────────────────────────────────────────────────

export interface MilestoneData {
    id: string;
    drug: string;
    aliases: string[];
    company: string;
    symbol: string | null;
    approach: string;
    indication: string;
    status: 'active' | 'proposed' | 'archived';
    source: 'seed' | 'manual' | 'ai';
    registry: { maxPhase: number; leadStatus: string | null; nextReadout: string | null; trialCount: number; nctIds: string[]; checkedAt: string | null } | null;
    history: Array<{ at: string; kind: string; text: string; url: string | null }>;
    proposals: Array<{ id: string; text: string; url: string | null; createdAt: string }>;
}

function toMilestone(d: IFrontierMilestone & { _id: unknown }): MilestoneData {
    return {
        id: String(d._id),
        drug: d.drug,
        aliases: d.aliases ?? [],
        company: d.company ?? '',
        symbol: d.symbol ?? null,
        approach: d.approach ?? '',
        indication: d.indication ?? '',
        status: d.status,
        source: d.source,
        registry: d.registry
            ? {
                  maxPhase: d.registry.maxPhase ?? 0,
                  leadStatus: d.registry.leadStatus ?? null,
                  nextReadout: d.registry.nextReadout ?? null,
                  trialCount: d.registry.trialCount ?? 0,
                  nctIds: d.registry.nctIds ?? [],
                  checkedAt: iso(d.registry.checkedAt),
              }
            : null,
        history: [...(d.history ?? [])]
            .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
            .slice(0, 10)
            .map((h) => ({ at: new Date(h.at).toISOString(), kind: h.kind, text: h.text, url: h.url ?? null })),
        proposals: (d.proposals ?? []).map((p) => ({ id: String(p._id), text: p.text, url: p.url ?? null, createdAt: new Date(p.createdAt).toISOString() })),
    };
}

export async function getFrontierMilestones(): Promise<MilestoneData[]> {
    try {
        await connectToDatabase();
        await ensureFrontierSeed();
        const docs = await FrontierMilestone.find({ status: { $in: ['active', 'proposed'] } }).lean<Array<IFrontierMilestone & { _id: unknown }>>();
        return docs
            .map(toMilestone)
            .sort((a, b) => (b.registry?.maxPhase ?? 0) - (a.registry?.maxPhase ?? 0) || a.drug.localeCompare(b.drug));
    } catch (error) {
        console.error('getFrontierMilestones failed', error);
        return [];
    }
}

export interface MilestoneInput {
    id?: string;
    drug: string;
    aliases: string[];
    company: string;
    symbol: string;
    approach: string;
    indication: string;
}

export async function saveMilestone(input: MilestoneInput): Promise<{ success: true }> {
    await requireUser();
    await connectToDatabase();
    const drug = input.drug.trim();
    if (!drug) throw new Error('drug is required');
    const aliases = [...new Set([drug, ...input.aliases.map((a) => a.trim()).filter(Boolean)])];
    const symbol = input.symbol.trim().toUpperCase();
    const $set = {
        drug,
        aliases,
        company: input.company.trim(),
        symbol: /^[A-Z]{1,5}$/.test(symbol) ? symbol : null,
        approach: input.approach.trim(),
        indication: input.indication.trim(),
    };
    if (input.id) {
        // 别名变了，下一轮刷新要按新名字重查登记库——清空旧快照，避免把"查询口径变化"当成升期
        const prev = await FrontierMilestone.findById(input.id).select({ aliases: 1 }).lean();
        const aliasChanged = prev && prev.aliases.join('|') !== aliases.join('|');
        await FrontierMilestone.updateOne({ _id: input.id }, { $set: aliasChanged ? { ...$set, registry: null } : $set });
    } else {
        await FrontierMilestone.create({ ...$set, status: 'active', source: 'manual', history: [], proposals: [] });
    }
    revalidatePath('/frontier');
    return { success: true };
}

export async function deleteMilestone(id: string): Promise<{ success: true }> {
    await requireUser();
    await connectToDatabase();
    await FrontierMilestone.deleteOne({ _id: id });
    revalidatePath('/frontier');
    return { success: true };
}

/** 处理 AI 的进展提议：采纳 = 记入历史；忽略 = 直接移除 */
export async function resolveMilestoneProposal(id: string, proposalId: string, accept: boolean): Promise<{ success: true }> {
    await requireUser();
    await connectToDatabase();
    const doc = await FrontierMilestone.findById(id);
    if (!doc) throw new Error('not found');
    const p = doc.proposals.find((x) => String(x._id) === proposalId);
    if (p && accept) doc.history.push({ at: new Date(), kind: 'note', text: p.text, url: p.url });
    doc.proposals = doc.proposals.filter((x) => String(x._id) !== proposalId);
    await doc.save();
    revalidatePath('/frontier');
    return { success: true };
}

/** AI 发现的候选药物：确认 = 进入记分板（下一轮自动查登记库）；拒绝 = 归档，不再提议 */
export async function resolveProposedDrug(id: string, accept: boolean): Promise<{ success: true }> {
    await requireUser();
    await connectToDatabase();
    await FrontierMilestone.updateOne({ _id: id, status: 'proposed' }, { $set: { status: accept ? 'active' : 'archived' } });
    revalidatePath('/frontier');
    return { success: true };
}

// ── 交易 ──────────────────────────────────────────────────────────

export interface DealData {
    id: string;
    eventId: string;
    date: string;
    dealType: string;
    buyer: string;
    seller: string;
    buyerSymbol: string | null;
    sellerSymbol: string | null;
    asset: string;
    themes: string[];
    upfront: DealAmountDoc | null;
    total: DealAmountDoc | null;
    summary: string;
    url: string | null;
}

export async function getFrontierDeals(days = 180): Promise<DealData[]> {
    try {
        await connectToDatabase();
        const docs = await FrontierDeal.find({ date: { $gte: new Date(Date.now() - days * 86_400_000) } }).sort({ date: -1 }).limit(200).lean();
        return docs.map((d) => ({
            id: String(d._id),
            eventId: String(d.eventId),
            date: new Date(d.date).toISOString(),
            dealType: d.dealType,
            buyer: d.buyer,
            seller: d.seller,
            buyerSymbol: d.buyerSymbol ?? null,
            sellerSymbol: d.sellerSymbol ?? null,
            asset: d.asset,
            themes: d.themes ?? [],
            upfront: d.upfront?.text ? { text: d.upfront.text, usd: d.upfront.usd ?? null, verified: Boolean(d.upfront.verified) } : null,
            total: d.total?.text ? { text: d.total.text, usd: d.total.usd ?? null, verified: Boolean(d.total.verified) } : null,
            summary: d.summary,
            url: d.url ?? null,
        }));
    } catch (error) {
        console.error('getFrontierDeals failed', error);
        return [];
    }
}

// ── 机构动向 ──────────────────────────────────────────────────────

export interface FundData {
    cik: string;
    name: string;
    period: string;
    prevPeriod: string | null;
    filedAt: string;
    totalValue: number;
    holdingsCount: number;
    changes: FundChangeDoc[];
}

export async function getFrontierFunds(): Promise<FundData[]> {
    try {
        await connectToDatabase();
        const docs = await FrontierFund.find().sort({ filedAt: -1, name: 1 }).lean();
        return docs.map((d) => ({
            cik: d.cik,
            name: d.name,
            period: d.period,
            prevPeriod: d.prevPeriod ?? null,
            filedAt: d.filedAt,
            totalValue: d.totalValue,
            holdingsCount: d.holdingsCount,
            changes: (d.changes ?? []).map((c) => ({
                issuer: c.issuer, cusip: c.cusip, symbol: c.symbol ?? null, change: c.change,
                value: c.value, prevValue: c.prevValue, shares: c.shares, prevShares: c.prevShares,
            })),
        }));
    } catch (error) {
        console.error('getFrontierFunds failed', error);
        return [];
    }
}

// ── 会议日历 ──────────────────────────────────────────────────────

export interface ConferenceData {
    id: string;
    name: string;
    startDate: string;
    precision: 'day' | 'month';
    dateText: string;
    themes: string[];
    note: string;
    verified: boolean;
}

export async function getFrontierConferences(): Promise<ConferenceData[]> {
    try {
        await connectToDatabase();
        await ensureFrontierSeed();
        // 月精度的会议锚点是当月 1 日：当月内仍然显示
        const cutoff = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
        const docs = await FrontierConference.find({ startDate: { $gte: cutoff } }).sort({ startDate: 1 }).lean();
        const today = new Date().toISOString().slice(0, 10);
        return docs
            .filter((d) => d.startDate >= today || (d.precision === 'month' && d.startDate.slice(0, 7) === today.slice(0, 7)))
            .map((d) => ({
                id: String(d._id),
                name: d.name,
                startDate: d.startDate,
                precision: d.precision,
                dateText: d.dateText,
                themes: d.themes ?? [],
                note: d.note,
                verified: d.verified,
            }));
    } catch (error) {
        console.error('getFrontierConferences failed', error);
        return [];
    }
}

export async function saveConference(input: { id?: string; name: string; startDate: string; precision: 'day' | 'month'; dateText: string; note: string; themes: string[]; verified: boolean }): Promise<{ success: true }> {
    await requireUser();
    await connectToDatabase();
    if (!input.name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) throw new Error('invalid conference');
    const $set = {
        name: input.name.trim(),
        startDate: input.startDate,
        precision: input.precision,
        dateText: input.dateText.trim(),
        note: input.note.trim(),
        themes: input.themes,
        verified: input.verified,
    };
    if (input.id) await FrontierConference.updateOne({ _id: input.id }, { $set });
    else await FrontierConference.create($set);
    revalidatePath('/frontier');
    return { success: true };
}

export async function deleteConference(id: string): Promise<{ success: true }> {
    await requireUser();
    await connectToDatabase();
    await FrontierConference.deleteOne({ _id: id });
    revalidatePath('/frontier');
    return { success: true };
}

// ── 论文与周报 ────────────────────────────────────────────────────

export interface PapersData {
    week: string | null;
    picks: Array<{ title: string; url?: string; feed: string; zh: string }>;
    recent: Array<{ id: string; title: string; url: string | null; feed: string; fetchedAt: string }>;
}

export async function getFrontierPapers(): Promise<PapersData> {
    try {
        await connectToDatabase();
        const picks = parse<{ week: string; picks: PapersData['picks'] }>(await kv(PAPERS_KEY));
        const recent = await FrontierItem.find({ status: 'paper' }).sort({ fetchedAt: -1 }).limit(60).lean();
        return {
            week: picks?.week ?? null,
            picks: picks?.picks ?? [],
            recent: recent.map((p) => ({ id: String(p._id), title: p.title, url: p.url ?? null, feed: p.feed, fetchedAt: new Date(p.fetchedAt).toISOString() })),
        };
    } catch (error) {
        console.error('getFrontierPapers failed', error);
        return { week: null, picks: [], recent: [] };
    }
}

export interface ReportData {
    week: string;
    subject: string;
    text: string;
    createdAt: string;
}

export async function getFrontierReports(limit = 8): Promise<ReportData[]> {
    try {
        await connectToDatabase();
        const docs = await FrontierReport.find().sort({ createdAt: -1 }).limit(limit).lean();
        return docs.map((d) => ({ week: d.week, subject: d.subject, text: d.text, createdAt: new Date((d as { createdAt?: Date }).createdAt ?? Date.now()).toISOString() }));
    } catch (error) {
        console.error('getFrontierReports failed', error);
        return [];
    }
}

// ── 主题管理 ──────────────────────────────────────────────────────

export interface ThemeInput {
    id?: string;
    key: string;
    name: string;
    nameEn: string;
    description: string;
    keywords: string[];
    trialField: 'query.intr' | 'query.cond';
    trialTerm: string;
    tickers: ThemeTickerData[];
    enabled: boolean;
}

export async function saveFrontierTheme(input: ThemeInput): Promise<{ success: true }> {
    await requireUser();
    await connectToDatabase();
    const key = input.key.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    if (!key || !input.name.trim()) throw new Error('key and name are required');
    const tickers = input.tickers
        .map((t) => ({
            symbol: t.symbol.trim().toUpperCase(),
            company: t.company.trim(),
            tier: t.tier,
            aliases: t.aliases.map((a) => a.trim()).filter(Boolean),
        }))
        .filter((t) => /^[A-Z]{1,5}$/.test(t.symbol) && t.company);
    const $set = {
        key,
        name: input.name.trim(),
        nameEn: input.nameEn.trim(),
        description: input.description.trim(),
        keywords: [...new Set(input.keywords.map((k) => k.trim()).filter(Boolean))],
        trialQuery: input.trialTerm.trim() ? { field: input.trialField, term: input.trialTerm.trim() } : null,
        tickers,
        enabled: input.enabled,
    };
    if (input.id) {
        await FrontierTheme.updateOne({ _id: input.id }, { $set });
    } else {
        const order = (await FrontierTheme.countDocuments()) + 1;
        await FrontierTheme.create({ ...$set, order });
    }
    revalidatePath('/frontier');
    return { success: true };
}

export async function deleteFrontierTheme(id: string): Promise<{ success: true }> {
    await requireUser();
    await connectToDatabase();
    if (!mongoose.isValidObjectId(id)) throw new Error('invalid id');
    await FrontierTheme.deleteOne({ _id: id });
    revalidatePath('/frontier');
    return { success: true };
}

export async function setFrontierLlmBudget(budget: number): Promise<{ success: true }> {
    await requireUser();
    const n = Math.round(budget);
    if (!Number.isFinite(n) || n < 1 || n > 500) throw new Error('budget out of range');
    await connectToDatabase();
    await CatalystKv.findOneAndUpdate({ key: BUDGET_KEY }, { $set: { value: String(n) } }, { upsert: true });
    revalidatePath('/frontier');
    return { success: true };
}
