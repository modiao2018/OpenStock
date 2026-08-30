import { describe, expect, it } from 'vitest';
import { abnormalSeries, rollingWindows, stddev, WINDOW_MS } from '@/catalyst-monitor/src/market-math';
import type { Bar } from '@/catalyst-monitor/src/store';

const T0 = Date.parse('2026-08-28T14:00:00Z');

function mkBars(closes: number[], opts: { gapAt?: number; vol?: number } = {}): Bar[] {
    return closes.map((c, i) => ({
        symbol: 'TEST',
        t: new Date(T0 + i * 60_000 + (opts.gapAt !== undefined && i >= opts.gapAt ? 60 * 60_000 : 0)),
        o: c,
        h: c,
        l: c,
        c,
        v: opts.vol ?? 100,
    }));
}

describe('rollingWindows', () => {
    it('computes 5-minute returns once the window fills', () => {
        // 10 根分钟线，价格从 100 匀速涨到 109
        const bars = mkBars(Array.from({ length: 10 }, (_, i) => 100 + i));
        const windows = rollingWindows(bars);
        expect(windows.length).toBeGreaterThan(0);
        // 每个窗口收益 = c_i / c_{i-5} - 1
        const last = windows[windows.length - 1];
        expect(last.ret).toBeCloseTo(109 / 104 - 1, 10);
        // 窗口成交量 = 5 根 bar 的量之和附近（窗口边界为 (t-5m, t]）
        expect(last.vol).toBeGreaterThan(0);
    });

    it('flat prices give zero returns', () => {
        const windows = rollingWindows(mkBars(Array(10).fill(50)));
        for (const w of windows) expect(w.ret).toBe(0);
    });

    it('skips windows across overnight gaps', () => {
        // 第 6 根开始跳空 1 小时——跨断档的窗口应被剔除
        const bars = mkBars(Array.from({ length: 12 }, (_, i) => 100 + i), { gapAt: 6 });
        const windows = rollingWindows(bars);
        for (const w of windows) {
            // 所有产出窗口的基准 bar 距窗口结束不超过 15 分钟
            expect(w.ret).toBeLessThan(0.1);
        }
        // gap 之后前几根不足 5 分钟窗口，序列应比无 gap 时短
        const noGap = rollingWindows(mkBars(Array.from({ length: 12 }, (_, i) => 100 + i)));
        expect(windows.length).toBeLessThan(noGap.length);
    });
});

describe('abnormalSeries', () => {
    it('subtracts benchmark returns at matching timestamps', () => {
        const stock = rollingWindows(mkBars([100, 100, 100, 100, 100, 100, 110])); // 末窗口 +10%
        const bench = rollingWindows(mkBars([100, 100, 100, 100, 100, 100, 102])); // 末窗口 +2%
        const ar = abnormalSeries(stock, bench);
        expect(ar.length).toBe(stock.length);
        expect(ar[ar.length - 1].ret).toBeCloseTo(0.1 - 0.02, 10);
    });

    it('drops timestamps missing from the benchmark', () => {
        const stock = rollingWindows(mkBars([100, 100, 100, 100, 100, 100, 110]));
        const ar = abnormalSeries(stock, []);
        expect(ar.length).toBe(0);
    });
});

describe('stddev', () => {
    it('computes population standard deviation', () => {
        expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 10);
        expect(stddev([1, 1, 1])).toBe(0);
    });
});

describe('WINDOW_MS', () => {
    it('is five minutes', () => {
        expect(WINDOW_MS).toBe(5 * 60_000);
    });
});
