import { describe, expect, it } from 'vitest';
import { SOURCES, inferSourceByHost, rssSourceId, sourceIdOf } from '@/lib/sources-registry';
import { COLLECTOR_NAMES, COLLECTOR_SPECS, collectorIntervals } from '../catalyst-monitor/src/collector-registry';

describe('sources registry', () => {
    it('has unique ids', () => {
        const ids = SOURCES.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('infers every known host', () => {
        expect(inferSourceByHost('https://finnhub.io/api/v1/quote?symbol=AAPL')).toBe('finnhub');
        expect(inferSourceByHost('https://data.alpaca.markets/v2/stocks/bars')).toBe('alpaca');
        expect(inferSourceByHost('https://paper-api.alpaca.markets/v2/clock')).toBe('alpaca');
        expect(inferSourceByHost('https://api.twelvedata.com/quote')).toBe('twelvedata');
        expect(inferSourceByHost('https://data.sec.gov/submissions/CIK0000320193.json')).toBe('sec-data');
        expect(inferSourceByHost('https://www.sec.gov/files/company_tickers.json')).toBe('sec-www');
        expect(inferSourceByHost('https://clinicaltrials.gov/api/v2/studies')).toBe('clinicaltrials');
        expect(inferSourceByHost('https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts')).toBe('nasdaq-halts');
        expect(inferSourceByHost('https://open.er-api.com/v6/latest/USD')).toBe('er-api');
        expect(inferSourceByHost('https://www.prnewswire.com/rss/x.rss')).toBeNull();
        expect(inferSourceByHost('not a url')).toBeNull();
    });

    it('maps dynamic rss ids back to the rss entry', () => {
        expect(rssSourceId('PR Newswire Health')).toBe('rss:pr-newswire-health');
        expect(sourceIdOf('rss:pr-newswire-health')).toBe('rss');
        expect(sourceIdOf('finnhub')).toBe('finnhub');
        expect(sourceIdOf('nope')).toBeNull();
    });
});

describe('collector registry', () => {
    it('specs and names agree', () => {
        expect(COLLECTOR_SPECS.map((s) => s.name).sort()).toEqual([...COLLECTOR_NAMES].sort());
        for (const s of COLLECTOR_SPECS) expect(Boolean(s.pollKey) !== Boolean(s.fixedMinutes)).toBe(true);
    });

    it('applies yaml poll overrides with defaults for the rest', () => {
        const i = collectorIntervals({ marketMinutes: 7 });
        expect(i.market).toBe(7);
        expect(i.edgar).toBe(5);
        expect(i['insider-edgar']).toBe(10);
        expect(i.sources).toBe(30);
    });
});
