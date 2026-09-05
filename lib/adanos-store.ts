// Persistence for the Adanos integration: the per-symbol snapshot cache and
// the last-seen monthly quota. Server/daemon only. Every function is a no-op
// (returns null / resolves) without MONGODB_URI so the fetch-mocking unit
// tests stay side-effect free; mongoose is loaded lazily for the same reason.

import { type AdanosQuota, pickTighterQuota } from '@/lib/adanos-quota';
import type { StockSentimentInsights } from '@/lib/actions/adanos.helpers';

export const ADANOS_QUOTA_KV_KEY = 'adanos_quota';

let warned = false;

function warnOnce(where: string, err: unknown): void {
    if (warned) return;
    warned = true;
    console.warn(`[adanos-store] ${where} failed, continuing without persistence:`, err instanceof Error ? err.message : err);
}

async function db() {
    if (!process.env.MONGODB_URI) return null;
    const [{ connectToDatabase }, { SentimentSnapshot }, { CatalystKv }] = await Promise.all([
        import('@/database/mongoose'),
        import('@/database/models/sentiment-snapshot.model'),
        import('@/database/models/catalyst.model'),
    ]);
    await connectToDatabase();
    return { SentimentSnapshot, CatalystKv };
}

export interface SnapshotRecord {
    insights: StockSentimentInsights | null;
    sources: string[];
    fetchedAt: number;
}

export async function readSnapshot(symbol: string): Promise<SnapshotRecord | null> {
    try {
        const m = await db();
        if (!m) return null;
        const doc = await m.SentimentSnapshot.findOne({ symbol }).lean();
        if (!doc) return null;
        return {
            insights: (doc.insights as StockSentimentInsights | null) ?? null,
            sources: doc.sources ?? [],
            fetchedAt: new Date(doc.fetchedAt).getTime(),
        };
    } catch (err) {
        warnOnce('readSnapshot', err);
        return null;
    }
}

export async function writeSnapshot(symbol: string, record: SnapshotRecord): Promise<void> {
    try {
        const m = await db();
        if (!m) return;
        await m.SentimentSnapshot.updateOne(
            { symbol },
            { $set: { insights: record.insights, sources: record.sources, fetchedAt: new Date(record.fetchedAt) } },
            { upsert: true },
        );
    } catch (err) {
        warnOnce('writeSnapshot', err);
    }
}

export async function readQuota(): Promise<AdanosQuota | null> {
    try {
        const m = await db();
        if (!m) return null;
        const doc = await m.CatalystKv.findOne({ key: ADANOS_QUOTA_KV_KEY }).lean();
        if (!doc?.value) return null;
        const parsed = JSON.parse(doc.value) as Partial<AdanosQuota>;
        if (typeof parsed.limit !== 'number' || typeof parsed.remaining !== 'number') return null;
        return {
            limit: parsed.limit,
            remaining: parsed.remaining,
            used: typeof parsed.used === 'number' ? parsed.used : Math.max(0, parsed.limit - parsed.remaining),
            resetAt: typeof parsed.resetAt === 'number' ? parsed.resetAt : null,
            at: typeof parsed.at === 'number' ? parsed.at : 0,
        };
    } catch (err) {
        warnOnce('readQuota', err);
        return null;
    }
}

// Stores the snapshot unless a stricter one from the same window is already
// on record (parallel requests can land out of order)
export async function writeQuota(quota: AdanosQuota): Promise<void> {
    try {
        const m = await db();
        if (!m) return;
        const current = await readQuota();
        const next = pickTighterQuota(current, quota);
        if (!next || next === current) return;
        await m.CatalystKv.findOneAndUpdate(
            { key: ADANOS_QUOTA_KV_KEY },
            { $set: { value: JSON.stringify(next) } },
            { upsert: true },
        );
    } catch (err) {
        warnOnce('writeQuota', err);
    }
}
