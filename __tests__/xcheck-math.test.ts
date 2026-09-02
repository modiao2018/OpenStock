import { describe, expect, it } from 'vitest';
import { alertSignature, compareQuote, findMissingFilings, rotateSample, type FilingKey } from '@/lib/xcheck-math';

// 2026-09-01 20:00 UTC = 16:00 ET, inside the session date 2026-09-01
const SAME_DAY_T = Date.parse('2026-09-01T20:00:00Z') / 1000;
const NEXT_DAY_T = Date.parse('2026-09-02T14:00:00Z') / 1000;

describe('compareQuote', () => {
    const base = { symbol: 'NVDA', date: '2026-09-01', alpaca: 100, finnhub: null, twelve: { date: '2026-09-01', close: 100.5 } };

    it('agrees within the threshold (exactly 1% is fine)', () => {
        expect(compareQuote(base)).toBeNull();
        expect(compareQuote({ ...base, twelve: { date: '2026-09-01', close: 101 } })).toBeNull();
    });

    it('flags a price mismatch above the threshold', () => {
        const m = compareQuote({ ...base, twelve: { date: '2026-09-01', close: 101.01 } })!;
        expect(m.reason).toBe('priceMismatch');
        expect(m.deviationPct).toBeCloseTo(1.01, 6);
    });

    it('flags a date mismatch before comparing prices', () => {
        const m = compareQuote({ ...base, twelve: { date: '2026-08-31', close: 100 } })!;
        expect(m.reason).toBe('dateMismatch');
        expect(m.twelveDate).toBe('2026-08-31');
    });

    it('finnhub only annotates and only when its last trade is on the session day', () => {
        const off = compareQuote({ ...base, finnhub: { c: 110, t: SAME_DAY_T } });
        expect(off).toBeNull(); // finnhub being off never creates a mismatch on its own
        const m = compareQuote({ ...base, twelve: { date: '2026-09-01', close: 103 }, finnhub: { c: 110, t: SAME_DAY_T } })!;
        expect(m.finnhubOff).toBe(true);
        expect(m.finnhub).toBe(110);
        const stale = compareQuote({ ...base, twelve: { date: '2026-09-01', close: 103 }, finnhub: { c: 110, t: NEXT_DAY_T } })!;
        expect(stale.finnhub).toBeNull();
        expect(stale.finnhubOff).toBe(false);
    });

    it('returns null when a source has no data', () => {
        expect(compareQuote({ ...base, alpaca: null })).toBeNull();
        expect(compareQuote({ ...base, twelve: null })).toBeNull();
    });
});

describe('rotateSample', () => {
    it('wraps around the pool and advances the cursor', () => {
        const pool = ['A', 'B', 'C', 'D', 'E'];
        expect(rotateSample(pool, 3, 3)).toEqual({ picked: ['D', 'E', 'A'], next: 1 });
        expect(rotateSample(pool, 0, 10)).toEqual({ picked: pool, next: 0 });
        expect(rotateSample([], 0, 3)).toEqual({ picked: [], next: 0 });
    });
});

describe('alertSignature', () => {
    it('is order independent and deduped', () => {
        expect(alertSignature(['b', 'a', 'b'])).toBe('a,b');
        expect(alertSignature([])).toBe('');
    });
});

describe('findMissingFilings', () => {
    const today = '2026-09-10';
    const filing = (over: Partial<FilingKey>): FilingKey => ({
        symbol: 'NVDA', filingDate: '2026-09-05', accessionNumber: 'acc-1', txCodes: ['S'], ...over,
    });

    it('reports a P/S filing with no trade in ±1 day', () => {
        expect(findMissingFilings([filing({})], [], today)).toHaveLength(1);
        expect(findMissingFilings([filing({})], [{ symbol: 'NVDA', filingDate: '2026-09-06' }], today)).toHaveLength(0);
        expect(findMissingFilings([filing({})], [{ symbol: 'NVDA', filingDate: '2026-09-04' }], today)).toHaveLength(0);
        expect(findMissingFilings([filing({})], [{ symbol: 'NVDA', filingDate: '2026-09-07' }], today)).toHaveLength(1);
    });

    it('ignores filings inside the grace period or outside the lookback', () => {
        expect(findMissingFilings([filing({ filingDate: '2026-09-09' })], [], today)).toHaveLength(0); // 1 day old
        expect(findMissingFilings([filing({ filingDate: '2026-09-08' })], [], today)).toHaveLength(1); // exactly grace
        expect(findMissingFilings([filing({ filingDate: '2026-09-02' })], [], today)).toHaveLength(0); // 8 days old
    });

    it('skips filings that only contain option/grant codes but keeps unparsed ones', () => {
        expect(findMissingFilings([filing({ txCodes: ['M', 'F'] })], [], today)).toHaveLength(0);
        expect(findMissingFilings([filing({ txCodes: null })], [], today)).toHaveLength(1);
    });

    it('does not match trades of another symbol', () => {
        expect(findMissingFilings([filing({})], [{ symbol: 'AMD', filingDate: '2026-09-05' }], today)).toHaveLength(1);
    });
});
