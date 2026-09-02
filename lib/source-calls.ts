// Per-source call ledger shared by the web app and the monitor daemon.
// Every outbound call records ok/fail + latency into one document per source
// (a single upsert with $inc/$set, no read-before-write). Never throws and is
// a no-op without MONGODB_URI, so unit tests that stub fetch stay side-effect
// free; mongoose is loaded lazily for the same reason.

import { hourBucketKey } from '@/lib/source-stats-math';

let warned = false;

function errorMessage(err: unknown): string {
    if (err === undefined || err === null) return '';
    const msg = err instanceof Error ? err.message : String(err);
    return msg.slice(0, 300);
}

export async function recordSourceCall(
    source: string,
    ok: boolean,
    latencyMs: number,
    error?: unknown,
    opts: { probe?: boolean } = {},
): Promise<void> {
    if (!process.env.MONGODB_URI || !source) return;
    try {
        const [{ connectToDatabase }, { SourceStats }] = await Promise.all([
            import('@/database/mongoose'),
            import('@/database/models/source-stats.model'),
        ]);
        await connectToDatabase();
        const now = new Date();
        const bucket = `hours.${hourBucketKey(now.getTime())}`;
        const latency = Math.max(0, Math.round(latencyMs));
        const inc: Record<string, number> = {
            [`${bucket}.${ok ? 'ok' : 'fail'}`]: 1,
            [`${bucket}.latencySum`]: latency,
            [ok ? 'totalOk' : 'totalFail']: 1,
        };
        const set: Record<string, unknown> = { lastLatencyMs: latency };
        if (ok) {
            set.lastOkAt = now;
            set.consecutiveFails = 0;
        } else {
            set.lastFailAt = now;
            set.lastError = { at: now, message: errorMessage(error) || 'failed' };
            inc.consecutiveFails = 1;
        }
        if (opts.probe) {
            set.lastProbe = { at: now, ok, latencyMs: latency, ...(ok ? {} : { error: errorMessage(error) || 'failed' }) };
        }
        await SourceStats.updateOne({ source }, { $inc: inc, $set: set }, { upsert: true });
    } catch (e) {
        if (!warned) {
            warned = true;
            console.warn('[source-calls] recording disabled after error:', e instanceof Error ? e.message : e);
        }
    }
}

// Wraps a call: times it, records the outcome, rethrows so callers keep their
// own error handling
export async function timed<T>(source: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
        const result = await fn();
        void recordSourceCall(source, true, Date.now() - start);
        return result;
    } catch (err) {
        void recordSourceCall(source, false, Date.now() - start, err);
        throw err;
    }
}
