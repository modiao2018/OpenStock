'use server';

import { connectToDatabase } from '@/database/mongoose';
import { FocusEntry, FocusDigestItem, type FocusFactorDoc } from '@/database/models/focus.model';
import { CatalystKv } from '@/database/models/catalyst.model';
import type { Stance } from '@/lib/focus-math';

export interface FocusRowData {
    symbol: string;
    name: string;
    universe: 'ai' | 'catalyst' | 'both';
    score: number;
    stance: Stance;
    bullPoints: number;
    bearPoints: number;
    factors: FocusFactorDoc[];
    caution: 'notPulledBack' | null;
    lastClose: number | null;
    streakDays: number | null;
    drawdownFromHighPct: number | null;
    nextCatalyst: { title: string; date: string; days: number } | null;
    sessionDate: string;
}

export interface DeferredItemData {
    id: string;
    symbol: string;
    kind: string;
    title: string;
    body: string;
    scoreAtDefer: number;
    createdAt: string;
    sentAt: string | null;
}

export interface FocusPageData {
    rows: FocusRowData[];
    /** Deferred pushes from the trailing 3 days, newest first */
    deferred: DeferredItemData[];
    computedAt: string | null;
    /** Threshold as the daemon last saw it; null until the focus collector has run */
    threshold: number | null;
}

export async function getFocusQueue(): Promise<FocusPageData> {
    const out: FocusPageData = { rows: [], deferred: [], computedAt: null, threshold: null };
    try {
        await connectToDatabase();
        const [entries, deferred, kv] = await Promise.all([
            FocusEntry.find().sort({ score: -1, symbol: 1 }).lean(),
            FocusDigestItem.find({ createdAt: { $gte: new Date(Date.now() - 3 * 86_400_000) } }).sort({ createdAt: -1 }).limit(100).lean(),
            CatalystKv.findOne({ key: 'focus_threshold' }).lean(),
        ]);
        out.rows = entries.map((e) => ({
            symbol: e.symbol,
            name: e.name,
            universe: e.universe,
            score: e.score,
            stance: e.stance,
            bullPoints: e.bullPoints,
            bearPoints: e.bearPoints,
            factors: (e.factors ?? []).map((f) => ({ id: f.id, group: f.group, points: f.points, lean: f.lean, detail: f.detail })),
            caution: e.caution ?? null,
            lastClose: e.lastClose ?? null,
            streakDays: e.streakDays ?? null,
            drawdownFromHighPct: e.drawdownFromHighPct ?? null,
            nextCatalyst: e.nextCatalyst ?? null,
            sessionDate: e.sessionDate,
        }));
        out.deferred = deferred.map((d) => ({
            id: String(d._id),
            symbol: d.symbol,
            kind: d.kind,
            title: d.title,
            body: d.body,
            scoreAtDefer: d.scoreAtDefer,
            createdAt: new Date(d.createdAt).toISOString(),
            sentAt: d.sentAt ? new Date(d.sentAt).toISOString() : null,
        }));
        const latest = entries.reduce<Date | null>((m, e) => (!m || e.computedAt > m ? e.computedAt : m), null);
        out.computedAt = latest ? new Date(latest).toISOString() : null;
        out.threshold = kv ? Number(kv.value) : null;
    } catch (e) {
        console.error('getFocusQueue failed', e);
    }
    return out;
}
