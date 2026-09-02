import { describe, expect, it } from 'vitest';
import { classifySource, hourBucketKey, staleBucketKeys, summarizeWindow } from '@/lib/source-stats-math';

const NOW = Date.parse('2026-09-02T13:30:00Z');

describe('hourBucketKey', () => {
    it('formats a UTC hour without dots', () => {
        expect(hourBucketKey(NOW)).toBe('2026-09-02T13');
        expect(hourBucketKey(NOW)).not.toContain('.');
    });
});

describe('summarizeWindow', () => {
    it('only counts buckets inside the trailing window', () => {
        const hours = {
            '2026-09-01T12': { ok: 10, fail: 0, latencySum: 1000 }, // 25h ago — out
            '2026-09-01T13': { ok: 5, fail: 5, latencySum: 2000 },  // exactly 24h — in
            '2026-09-02T13': { ok: 3, fail: 1, latencySum: 400 },
        };
        const w = summarizeWindow(hours, NOW);
        expect(w.calls).toBe(14);
        expect(w.okRate).toBeCloseTo(8 / 14, 6);
        expect(w.avgLatencyMs).toBeCloseTo(2400 / 14, 6);
    });

    it('returns null rates for empty windows', () => {
        expect(summarizeWindow({}, NOW)).toEqual({ calls: 0, okRate: null, avgLatencyMs: null });
        expect(summarizeWindow(undefined, NOW).okRate).toBeNull();
    });
});

describe('classifySource', () => {
    const base = { consecutiveFails: 0, lastOkAt: NOW - 1000, lastFailAt: null, lastProbe: null, window: { calls: 10, okRate: 1, avgLatencyMs: 100 } };

    it('unconfigured wins over everything', () => {
        expect(classifySource(base, false)).toBe('unconfigured');
    });

    it('idle when never called and never probed', () => {
        expect(classifySource(null, true)).toBe('idle');
        expect(classifySource({ ...base, lastOkAt: null, lastFailAt: null, window: { calls: 0, okRate: null, avgLatencyMs: null } }, true)).toBe('idle');
    });

    it('down at 3 consecutive failures, warn below that', () => {
        expect(classifySource({ ...base, consecutiveFails: 3 }, true)).toBe('down');
        expect(classifySource({ ...base, consecutiveFails: 2 }, true)).toBe('warn');
        expect(classifySource({ ...base, consecutiveFails: 1 }, true)).toBe('warn');
    });

    it('a failed probe newer than the last success is down; older is not', () => {
        expect(classifySource({ ...base, lastProbe: { at: NOW, ok: false } }, true)).toBe('down');
        expect(classifySource({ ...base, lastProbe: { at: NOW - 5000, ok: false } }, true)).toBe('ok');
    });

    it('warns on a low 24h success rate', () => {
        expect(classifySource({ ...base, window: { calls: 10, okRate: 0.89, avgLatencyMs: 1 } }, true)).toBe('warn');
        expect(classifySource({ ...base, window: { calls: 10, okRate: 0.9, avgLatencyMs: 1 } }, true)).toBe('ok');
    });
});

describe('staleBucketKeys', () => {
    it('lists keys older than the retention', () => {
        const hours = { '2026-08-31T12': { ok: 1, fail: 0, latencySum: 0 }, '2026-09-02T13': { ok: 1, fail: 0, latencySum: 0 } };
        expect(staleBucketKeys(hours, NOW)).toEqual(['2026-08-31T12']);
    });
});
