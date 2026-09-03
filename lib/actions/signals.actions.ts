'use server';

import { connectToDatabase } from '@/database/mongoose';
import { Signal, type ISignal } from '@/database/models/signal.model';
import { buildScorecard, type HorizonKey, type ScoreRow, type SignalDirection } from '@/lib/signal-math';

/** 记分卡按信号类型 / AI 操作建议两个维度分组；近期记录逐条列出 */

export interface SignalRowData {
    id: string;
    kind: string;
    symbol: string;
    direction: SignalDirection;
    action: string | null;
    title: string;
    firedAt: string;
    entryDate: string;
    entryClose: number | null;
    benchmark: string;
    status: ISignal['status'];
    delivered: boolean;
    horizons: Partial<Record<HorizonKey, { date: string; returnPct: number; excessPct: number | null }>>;
}

export interface ScorecardData {
    byKind: ScoreRow[];
    byAction: ScoreRow[];
    recent: SignalRowData[];
    total: number;
    pending: number;
    /** 未回补且已超期的信号数 */
    expired: number;
    windowDays: number;
}

const WINDOW_DAYS = 180;

export async function getScorecard(): Promise<ScorecardData> {
    const empty: ScorecardData = { byKind: [], byAction: [], recent: [], total: 0, pending: 0, expired: 0, windowDays: WINDOW_DAYS };
    try {
        await connectToDatabase();
        const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
        const docs = await Signal.find({ firedAt: { $gte: since } }).sort({ firedAt: -1 }).lean();

        const samples = docs
            .filter((d) => d.status === 'partial' || d.status === 'complete')
            .map((d) => ({
                kind: d.kind,
                action: d.action ?? '—',
                direction: d.direction,
                horizons: d.horizons ?? {},
            }));

        return {
            byKind: buildScorecard(samples, (s) => s.kind),
            // 只有带 AI 建议的信号才进"按建议"维度
            byAction: buildScorecard(samples.filter((s) => s.action !== '—'), (s) => s.action),
            recent: docs.slice(0, 60).map((d) => ({
                id: String(d._id),
                kind: d.kind,
                symbol: d.symbol,
                direction: d.direction,
                action: d.action ?? null,
                title: d.title,
                firedAt: new Date(d.firedAt).toISOString(),
                entryDate: d.entryDate,
                entryClose: d.entryClose ?? null,
                benchmark: d.benchmark,
                status: d.status,
                delivered: d.delivered,
                horizons: Object.fromEntries(
                    Object.entries(d.horizons ?? {}).filter(([, v]) => v).map(([k, v]) => [k, { date: v!.date, returnPct: v!.returnPct, excessPct: v!.excessPct }])
                ),
            })),
            total: docs.length,
            pending: docs.filter((d) => d.status === 'pending').length,
            expired: docs.filter((d) => d.status === 'expired').length,
            windowDays: WINDOW_DAYS,
        };
    } catch (e) {
        console.error('getScorecard failed', e);
        return empty;
    }
}
