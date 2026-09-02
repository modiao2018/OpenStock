// Pure math for the /status page: hour-bucket keys, trailing-window
// summaries and the health classification. No I/O — unit-tested in
// __tests__/source-stats-math.test.ts.

export interface HourBucket {
    ok: number;
    fail: number;
    latencySum: number;
}

// UTC hour key without dots so it can be a Mongo field name: 2026-09-02T13
export function hourBucketKey(now: number = Date.now()): string {
    return new Date(now).toISOString().slice(0, 13);
}

export interface SourceWindow {
    calls: number;
    // null when there were no calls in the window
    okRate: number | null;
    avgLatencyMs: number | null;
}

export function summarizeWindow(
    hours: Record<string, HourBucket> | null | undefined,
    now: number = Date.now(),
    windowHours = 24,
): SourceWindow {
    const cutoff = hourBucketKey(now - windowHours * 3600_000);
    let ok = 0, fail = 0, latencySum = 0;
    for (const [key, b] of Object.entries(hours ?? {})) {
        if (key < cutoff) continue;
        ok += b.ok ?? 0;
        fail += b.fail ?? 0;
        latencySum += b.latencySum ?? 0;
    }
    const calls = ok + fail;
    return {
        calls,
        okRate: calls > 0 ? ok / calls : null,
        avgLatencyMs: calls > 0 ? latencySum / calls : null,
    };
}

export type SourceLevel = 'ok' | 'warn' | 'down' | 'idle' | 'unconfigured';

export interface SourceHealthInput {
    consecutiveFails: number;
    lastOkAt: number | null;
    lastFailAt: number | null;
    lastProbe: { at: number; ok: boolean } | null;
    window: SourceWindow;
}

// down: 3+ consecutive failures, or the latest probe failed after the last
// success; warn: a couple of recent failures or <90% success in the window;
// idle: never called and never probed.
export function classifySource(input: SourceHealthInput | null, configured: boolean): SourceLevel {
    if (!configured) return 'unconfigured';
    if (!input) return 'idle';
    const neverCalled = input.lastOkAt === null && input.lastFailAt === null;
    if (neverCalled && !input.lastProbe) return 'idle';
    if (input.consecutiveFails >= 3) return 'down';
    if (input.lastProbe && !input.lastProbe.ok && (input.lastOkAt === null || input.lastProbe.at > input.lastOkAt)) {
        return 'down';
    }
    if (input.consecutiveFails > 0) return 'warn';
    if (input.window.okRate !== null && input.window.okRate < 0.9) return 'warn';
    return 'ok';
}

// Bucket keys older than `keepHours` — for the periodic $unset cleanup
export function staleBucketKeys(hours: Record<string, HourBucket> | null | undefined, now: number, keepHours = 48): string[] {
    const cutoff = hourBucketKey(now - keepHours * 3600_000);
    return Object.keys(hours ?? {}).filter((k) => k < cutoff);
}
