import { describe, expect, it } from 'vitest';
import { computeMomentumNumbers, describeTechnical, recomputeMomentum } from '@/lib/research-momentum';
import { RESEARCH_SEEDS } from '@/lib/research-seed';

// n ascending sessions, closes from `closes` (or linear ramp)
const bars = (closes: number[], startDay = 1) =>
    closes.map((c, i) => ({ date: `2026-06-${String(startDay + i).padStart(2, '0')}`.replace(/-(\d\d)$/, (_, d) => `-${d}`), c }));

const dated = (closes: number[]) => closes.map((c, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), c }));

describe('computeMomentumNumbers', () => {
    it('measures return over the last N sessions, drawdown inside the window, MA state and highs', () => {
        // 60 bars: flat 100 for 50, then 100→150 ramp with a dip
        const closes = [...Array(50).fill(100), 110, 120, 130, 140, 150, 120, 130, 140, 150, 160];
        const n = computeMomentumNumbers(dated(closes), 10)!;
        expect(n.returnPct).toBe(60); // start close is the bar 10 sessions before the last: 100 → 160
        expect(n.maxDrawdownPct).toBe(-20); // 150 → 120
        expect(n.aboveMa20).toBe(true);
        expect(n.aboveMa50).toBe(true);
        expect(n.nearHigh).toBe(true);
        expect(n.newHigh).toBe(true);
        expect(n.windowStart).toBe('2026-02-19');
        expect(n.windowEnd).toBe('2026-03-01');
    });

    it('flags below-MA and no MA50 when history is short', () => {
        const closes = [...Array(25).fill(100), 90, 80, 70];
        const n = computeMomentumNumbers(dated(closes), 45)!;
        expect(n.returnPct).toBe(-30);
        expect(n.aboveMa20).toBe(false);
        expect(n.aboveMa50).toBeNull();
        expect(n.nearHigh).toBe(false);
        expect(computeMomentumNumbers(dated([100]))).toBeNull();
        expect(bars([1]).length).toBe(1);
    });

    it('describes the flags in both languages', () => {
        expect(describeTechnical({ aboveMa20: true, aboveMa50: true, nearHigh: true, newHigh: false }, 'zh-CN')).toBe('站上20日、50日均线，接近阶段高点');
        expect(describeTechnical({ aboveMa20: false, aboveMa50: true, nearHigh: false, newHigh: false }, 'zh-CN')).toBe('跌破20日均线，仍在50日均线上方');
        expect(describeTechnical({ aboveMa20: true, aboveMa50: null, nearHigh: true, newHigh: true }, 'en')).toBe('above the 20-day MA, at a new window high');
        expect(describeTechnical({ aboveMa20: null, aboveMa50: null, nearHigh: false, newHigh: false }, 'en')).toBe('');
    });
});

describe('recomputeMomentum', () => {
    const current = RESEARCH_SEEDS[0].momentum!;

    it('refreshes numbers and technical text, re-sorts rows, keeps verdicts and analyst layer', () => {
        const up = dated([...Array(50).fill(10), ...Array(10).fill(20)]);
        const down = dated([...Array(50).fill(10), ...Array(10).fill(5)]);
        const out = recomputeMomentum({
            current,
            barsBySymbol: { VCYT: up, ABCL: down },
            benchmarkBars: dated([...Array(60).fill(10), 11]),
            lang: 'zh-CN',
            now: new Date('2026-09-19T00:00:00Z'),
        });
        expect(out.rows[0].symbol).toBe('VCYT');
        expect(out.rows[0]).toMatchObject({ returnPct: 100, maxDrawdownPct: 0, aboveMa20: true, technical: '站上20日、50日均线，创阶段新高', verdict: '暂不适合优先关注' });
        expect(out.rows[out.rows.length - 1]).toMatchObject({ symbol: 'ABCL', returnPct: -50, verdict: '强势突破，但短期涨幅已大' });
        // rows without bars keep their seed numbers
        expect(out.rows.find((r) => r.symbol === 'NTRA')).toMatchObject({ returnPct: 36.1, technical: '强势，回撤控制较好' });
        expect(out.benchmarkReturnPct).toBe(10);
        expect(out.windowEnd).toBe('2026-03-02');
        expect(out.groups).toEqual(current.groups);
        expect(out.ranking).toEqual(current.ranking);
        expect(out.spotlight).toEqual(current.spotlight);
        expect(out.summary).toBe(current.summary);
        expect(out.computedAt?.toISOString()).toBe('2026-09-19T00:00:00.000Z');
        expect(out.note).toContain('Alpaca');
    });
});
