'use server';

import { revalidatePath } from 'next/cache';
import { connectToDatabase } from '@/database/mongoose';
import { Thesis, type IThesis } from '@/database/models/thesis.model';
import { getSession } from '@/lib/get-session';
import { getQuote } from '@/lib/actions/finnhub.actions';
import { structureThesis } from '@/lib/thesis-framing';
import {
    DEFAULT_CHECKIN_DAYS,
    DEFAULT_HORIZON_DAYS,
    DEFAULT_MOVE_PCT,
    MAX_NOTE_CHARS,
    pctChange,
    shiftDate,
    type ThesisDirection,
    type ThesisFraming,
    type ThesisOutcome,
    type ThesisStatus,
    type ThesisTriggerId,
} from '@/lib/thesis-math';

export interface ThesisFollowupData {
    at: string;
    triggers: ThesisTriggerId[];
    price: number | null;
    note: string;
    delivered: boolean;
}

export interface ThesisData {
    id: string;
    symbol: string;
    name: string;
    direction: ThesisDirection;
    note: string;
    /** AI 梳理的可检验框架；尚未生成时为 null */
    framing: ThesisFraming | null;
    entryPrice: number | null;
    targetPrice: number | null;
    stopPrice: number | null;
    horizonDate: string;
    checkinDays: number;
    movePct: number;
    status: ThesisStatus;
    outcome: ThesisOutcome | null;
    closingNote: string | null;
    closedAt: string | null;
    followups: ThesisFollowupData[];
    lastAlertPrice: number | null;
    createdAt: string;
    /** 最近一次跟进时的价格；没有跟进则为 null */
    lastPrice: number | null;
    /** 较入场的涨跌幅（用最近跟进价） */
    changePct: number | null;
}

export interface ThesisInput {
    /** 用户的一段话：想法、方向、点子，随便写 */
    text: string;
    /** 个股页：标的已知；或 AI 没认出标的、用户补填的代码 */
    symbol?: string;
    name?: string;
}

export type CreateThesisResult =
    | { status: 'created'; id: string; symbol: string; framed: boolean }
    /** AI 没从文字里认出是哪只股票（或 LLM 未配置），让用户补个代码再提交 */
    | { status: 'needsSymbol' };

function toData(d: IThesis): ThesisData {
    const followups = (d.followups ?? []).map((f) => ({
        at: new Date(f.at).toISOString(),
        triggers: f.triggers ?? [],
        price: f.price ?? null,
        note: f.note,
        delivered: f.delivered ?? false,
    }));
    const lastPrice = followups.length > 0 ? followups[followups.length - 1].price : null;
    return {
        id: String(d._id),
        symbol: d.symbol,
        name: d.name,
        direction: d.direction,
        note: d.note,
        framing: d.framing ?? null,
        entryPrice: d.entryPrice ?? null,
        targetPrice: d.targetPrice ?? null,
        stopPrice: d.stopPrice ?? null,
        horizonDate: d.horizonDate,
        checkinDays: d.checkinDays,
        movePct: d.movePct,
        status: d.status,
        outcome: d.outcome ?? null,
        closingNote: d.closingNote ?? null,
        closedAt: d.closedAt ? new Date(d.closedAt).toISOString() : null,
        followups,
        lastAlertPrice: d.lastAlertPrice ?? null,
        createdAt: new Date(d.createdAt).toISOString(),
        lastPrice,
        changePct: pctChange(d.entryPrice ?? null, lastPrice),
    };
}

async function requireUserId(): Promise<string> {
    const session = await getSession();
    const id = session?.user?.id;
    if (!id) throw new Error('Not signed in');
    return id;
}

const num = (v: number | null | undefined): number | null =>
    v === null || v === undefined || !Number.isFinite(v) || v <= 0 ? null : Number(v);

/** 当前用户的跟进：进行中在前（按创建倒序），之后是最近关闭的 */
export async function getTheses(opts: { symbol?: string; includeClosed?: boolean; limit?: number } = {}): Promise<ThesisData[]> {
    try {
        const userId = await requireUserId();
        await connectToDatabase();
        const filter: Record<string, unknown> = { userId };
        if (opts.symbol) filter.symbol = opts.symbol.toUpperCase();
        if (!opts.includeClosed) filter.status = 'active';
        const docs = await Thesis.find(filter).sort({ createdAt: -1 }).limit(opts.limit ?? 200).lean<IThesis[]>();
        const rank = (s: ThesisStatus) => (s === 'active' ? 0 : 1);
        return docs.map(toData).sort((a, b) => rank(a.status) - rank(b.status) || b.createdAt.localeCompare(a.createdAt));
    } catch (error) {
        console.error('getTheses failed', error);
        return [];
    }
}

export async function createThesis(input: ThesisInput): Promise<CreateThesisResult> {
    const userId = await requireUserId();
    const text = input.text.trim().slice(0, MAX_NOTE_CHARS);
    if (!text) throw new Error('text is required');
    const today = new Date().toISOString().slice(0, 10);
    const fixedSymbol = input.symbol?.trim().toUpperCase() || undefined;

    // AI 先把这段话整理成结构：标的、倾向、用户提到的价位/期限、可检验框架。
    // 限时——表单不能卡太久；超时就按"没框架"入库，daemon 下一轮补
    const structured = await structureThesis({ text, fixedSymbol, fixedName: input.name?.trim() || undefined, today }, 40_000).catch((e) => {
        console.error('structureThesis failed', e);
        return null;
    });
    const symbol = fixedSymbol ?? structured?.symbol ?? null;
    if (!symbol) return { status: 'needsSymbol' };

    const direction: ThesisDirection = structured?.direction ?? 'watch';
    let horizonDate = structured?.horizonDate ?? shiftDate(today, DEFAULT_HORIZON_DAYS);
    if (horizonDate < today) horizonDate = shiftDate(today, DEFAULT_HORIZON_DAYS);

    // 用户没提入场价就取当前报价，跟进时才有涨跌幅可比
    let entryPrice = num(structured?.entryPrice);
    if (entryPrice === null) {
        const q = await getQuote(symbol);
        entryPrice = num(q?.c);
    }

    await connectToDatabase();
    const doc = await Thesis.create({
        userId,
        symbol,
        name: input.name?.trim() || structured?.name || symbol,
        direction,
        note: text,
        framing: structured?.framing ?? null,
        entryPrice,
        targetPrice: num(structured?.targetPrice),
        stopPrice: num(structured?.stopPrice),
        horizonDate,
        checkinDays: DEFAULT_CHECKIN_DAYS,
        movePct: DEFAULT_MOVE_PCT,
        status: 'active',
        hits: {},
        followups: [],
    });
    revalidatePath('/focus');
    revalidatePath(`/stocks/${symbol}`);
    return { status: 'created', id: String(doc._id), symbol, framed: Boolean(structured) };
}

/** 关闭跟进（用户主动）：daemon 下一轮起不再检查 */
export async function closeThesis(id: string, outcome: ThesisOutcome = 'abandoned', closingNote?: string): Promise<{ success: true }> {
    const userId = await requireUserId();
    await connectToDatabase();
    const doc = await Thesis.findOneAndUpdate(
        { _id: id, userId, status: 'active' },
        { $set: { status: 'closed', outcome, closingNote: closingNote?.trim().slice(0, 500) || null, closedAt: new Date() } }
    );
    if (doc) {
        revalidatePath('/focus');
        revalidatePath(`/stocks/${doc.symbol}`);
    }
    return { success: true };
}

/** 重新打开已关闭/过期的跟进：截止日不合法时顺延默认周期 */
export async function reopenThesis(id: string): Promise<{ success: true }> {
    const userId = await requireUserId();
    await connectToDatabase();
    const doc = await Thesis.findOne({ _id: id, userId });
    if (!doc) throw new Error('not found');
    const today = new Date().toISOString().slice(0, 10);
    doc.status = 'active';
    doc.outcome = null;
    doc.closedAt = null;
    doc.closingNote = null;
    if (doc.horizonDate < today) doc.horizonDate = shiftDate(today, DEFAULT_HORIZON_DAYS);
    doc.hits = {};
    await doc.save();
    revalidatePath('/focus');
    revalidatePath(`/stocks/${doc.symbol}`);
    return { success: true };
}

export async function deleteThesis(id: string): Promise<{ success: true }> {
    const userId = await requireUserId();
    await connectToDatabase();
    const doc = await Thesis.findOneAndDelete({ _id: id, userId });
    if (doc) {
        revalidatePath('/focus');
        revalidatePath(`/stocks/${doc.symbol}`);
    }
    return { success: true };
}

/** 追加思考（进行中的跟进）：新想法接在原文后，带时间戳，AI 下次跟进能看到 */
export async function appendThesisNote(id: string, text: string): Promise<{ success: true }> {
    const userId = await requireUserId();
    const extra = text.trim();
    if (!extra) throw new Error('empty note');
    await connectToDatabase();
    const doc = await Thesis.findOne({ _id: id, userId, status: 'active' });
    if (!doc) throw new Error('not found');
    const stamp = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' });
    doc.note = `${doc.note}\n\n【${stamp} 补充】${extra}`.slice(-MAX_NOTE_CHARS);
    // 想法变了，框架重新梳理（daemon 下一轮补）
    doc.framing = null;
    await doc.save();
    revalidatePath('/focus');
    revalidatePath(`/stocks/${doc.symbol}`);
    return { success: true };
}
