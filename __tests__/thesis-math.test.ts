import { describe, expect, it } from 'vitest';
import {
    daysUntil,
    evaluateThesis,
    formatThesisStatus,
    matchesThesisKeywords,
    parseStructured,
    pctChange,
    shiftDate,
    thesisPushTitle,
    type ThesisEvalInput,
} from '@/lib/thesis-math';

const NOW = Date.parse('2026-09-06T14:00:00Z');
const DAY = 86_400_000;
const base = (over: Partial<ThesisEvalInput> = {}): ThesisEvalInput => ({
    direction: 'long',
    entryPrice: 100,
    targetPrice: 120,
    stopPrice: 90,
    horizonDate: '2026-09-20',
    today: '2026-09-06',
    price: 105,
    lastAlertPrice: null,
    hits: {},
    newItems: [],
    createdAtMs: NOW - DAY,
    lastFollowupAtMs: null,
    nowMs: NOW,
    checkinDays: 3,
    movePct: 7,
    ...over,
});
const ids = (i: ThesisEvalInput) => evaluateThesis(i).triggers.map((t) => t.id);

describe('evaluateThesis', () => {
    it('stays quiet when nothing has happened yet', () => {
        const r = evaluateThesis(base());
        expect(r.triggers).toEqual([]);
        expect(r.expired).toBe(false);
        expect(r.daysLeft).toBe(14);
        expect(r.changePct).toBeCloseTo(5);
    });

    it('fires target / stop by direction', () => {
        // lastAlertPrice pinned next to the price so the move itself does not also fire
        expect(ids(base({ price: 121, lastAlertPrice: 119 }))).toEqual(['target']);
        expect(ids(base({ price: 89, lastAlertPrice: 91 }))).toEqual(['stop']);
        // short thesis mirrors the levels
        expect(ids(base({ direction: 'short', targetPrice: 80, stopPrice: 110, price: 79, lastAlertPrice: 81 }))).toEqual(['target']);
        expect(ids(base({ direction: 'short', targetPrice: 80, stopPrice: 110, price: 111, lastAlertPrice: 109 }))).toEqual(['stop']);
        // watch behaves like long
        expect(ids(base({ direction: 'watch', price: 121, lastAlertPrice: 119 }))).toEqual(['target']);
    });

    it('marks the stop as urgent and only once', () => {
        const r = evaluateThesis(base({ price: 85 }));
        expect(r.triggers[0].id).toBe('stop');
        expect(r.triggers[0].urgent).toBe(true);
        // A stop-sized drop also counts as a big move, but the stop leads
        expect(ids(base({ price: 85 }))).toEqual(['stop', 'bigMove']);
        expect(ids(base({ price: 85, hits: { stop: true }, lastAlertPrice: 85 }))).toEqual([]);
    });

    it('does not compare prices when no quote is available', () => {
        expect(ids(base({ price: null }))).toEqual([]);
        expect(evaluateThesis(base({ price: null })).changePct).toBeNull();
    });

    it('warns the day before the deadline, then retires after it', () => {
        expect(ids(base({ horizonDate: '2026-09-07' }))).toEqual(['horizonSoon']);
        expect(ids(base({ horizonDate: '2026-09-06' }))).toEqual(['horizonSoon']);
        expect(ids(base({ horizonDate: '2026-09-07', hits: { horizonSoon: true } }))).toEqual([]);
        const r = evaluateThesis(base({ horizonDate: '2026-09-05' }));
        expect(r.expired).toBe(true);
        expect(r.triggers.map((t) => t.id)).toEqual(['horizonPassed']);
    });

    it('surfaces urgent events ahead of ordinary news', () => {
        const news = [{ kind: '新闻', title: 'a', urgent: false }];
        expect(ids(base({ newItems: news }))).toEqual(['newEvent']);
        const halt = [{ kind: '停牌', title: 'h', urgent: true }, ...news];
        const r = evaluateThesis(base({ newItems: halt }));
        expect(r.triggers.map((t) => t.id)).toEqual(['urgentEvent']);
        expect(r.triggers[0].urgent).toBe(true);
        expect(r.triggers[0].detail).toContain('停牌');
    });

    it('measures big moves from the last alert, not the entry', () => {
        expect(ids(base({ price: 108 }))).toEqual(['bigMove']);
        expect(ids(base({ price: 108, lastAlertPrice: 107 }))).toEqual([]);
        expect(ids(base({ price: 99, lastAlertPrice: 108 }))).toEqual(['bigMove']);
        expect(evaluateThesis(base({ price: 99, lastAlertPrice: 108 })).triggers[0].detail).toContain('上次提醒');
    });

    it('only asks for a check-in when nothing else fired and enough quiet days passed', () => {
        expect(ids(base({ createdAtMs: NOW - 3 * DAY }))).toEqual(['checkin']);
        expect(ids(base({ createdAtMs: NOW - 10 * DAY, lastFollowupAtMs: NOW - DAY }))).toEqual([]);
        expect(ids(base({ createdAtMs: NOW - 10 * DAY, checkinDays: 0 }))).toEqual([]);
        expect(ids(base({ createdAtMs: NOW - 10 * DAY, price: 121, lastAlertPrice: 119 }))).toEqual(['target']);
    });

    it('orders triggers by priority', () => {
        const r = evaluateThesis(base({ price: 121, horizonDate: '2026-09-07', newItems: [{ kind: 'x', title: 'y', urgent: false }] }));
        expect(r.triggers.map((t) => t.id)).toEqual(['target', 'horizonSoon', 'bigMove', 'newEvent']);
    });
});

describe('helpers', () => {
    it('pctChange guards bad inputs', () => {
        expect(pctChange(100, 110)).toBeCloseTo(10);
        expect(pctChange(null, 110)).toBeNull();
        expect(pctChange(0, 110)).toBeNull();
    });

    it('date math is calendar based', () => {
        expect(daysUntil('2026-09-06', '2026-09-20')).toBe(14);
        expect(daysUntil('2026-09-06', '2026-09-05')).toBe(-1);
        expect(shiftDate('2026-12-30', 3)).toBe('2027-01-02');
    });

    it('formats a compact status line and push title', () => {
        const line = formatThesisStatus({ symbol: 'NVDA', direction: 'long', entryPrice: 100, price: 105, changePct: 5, targetPrice: 120, stopPrice: 90, daysLeft: 14 });
        expect(line).toBe('NVDA 偏多｜现价 $105.00（较入场 +5.0%）｜目标 $120.00 / 失效 $90.00｜剩 14 天');
        expect(formatThesisStatus({ symbol: 'X', direction: 'watch', entryPrice: null, price: null, changePct: null, targetPrice: null, stopPrice: null, daysLeft: -2 })).toBe('X 方向未定｜已过期 2 天');
        expect(thesisPushTitle('NVDA', evaluateThesis(base({ price: 85 })).triggers)).toBe('洞察跟进｜NVDA 触及失效价');
        expect(thesisPushTitle('NVDA', [])).toBe('洞察跟进｜NVDA 跟进');
    });
});

describe('parseStructured', () => {
    it('reads a fenced JSON reply and normalises fields', () => {
        const reply = '```json\n{"symbol":"vst","name":"Vistra","direction":"long","entryPrice":null,"targetPrice":"x","stopPrice":120,"horizonDate":"2026-10-15","thesis":"AI 电力需求利好 Vistra","confirm":["新签数据中心供电合同"],"refute":["电价管制"],"keywords":["data center","PPA"],"questions":["Vistra 有多少产能是合同锁定的"]}\n```';
        const r = parseStructured(reply)!;
        expect(r.symbol).toBe('VST');
        expect(r.direction).toBe('long');
        expect(r.targetPrice).toBeNull();
        expect(r.stopPrice).toBe(120);
        expect(r.horizonDate).toBe('2026-10-15');
        expect(r.framing.keywords).toEqual(['data center', 'PPA']);
    });

    it('keeps the fixed symbol, defaults the direction, rejects junk', () => {
        const r = parseStructured('{"symbol":"AAPL","direction":"maybe","horizonDate":"next week","thesis":"x"}', 'nvda')!;
        expect(r.symbol).toBe('NVDA');
        expect(r.direction).toBe('watch');
        expect(r.horizonDate).toBeNull();
        expect(parseStructured('{"symbol":"not a ticker","thesis":"x"}')!.symbol).toBeNull();
        expect(parseStructured('{"symbol":"NVDA"}')).toBeNull();
        expect(parseStructured('no json here')).toBeNull();
    });
});

describe('matchesThesisKeywords', () => {
    it('matches keywords case-insensitively and tickers as whole words', () => {
        expect(matchesThesisKeywords('Vistra signs Data Center PPA', ['data center'], 'VST')).toBe(true);
        expect(matchesThesisKeywords('Analysts on $VST outlook', [], 'VST')).toBe(true);
        expect(matchesThesisKeywords('INVESTOR update', [], 'VST')).toBe(false);
        expect(matchesThesisKeywords('unrelated', ['ai'], 'VST')).toBe(false);
    });
});
