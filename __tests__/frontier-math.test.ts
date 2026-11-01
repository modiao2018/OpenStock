import { describe, expect, it } from 'vitest';
import {
    basketStat,
    beneficiarySignals,
    canSpend,
    checkFact,
    cleanHtmlText,
    companyCore,
    diffHoldings,
    extractExchangeTickers,
    findSameStory,
    isoWeekOf,
    keywordHit,
    matchThemes,
    numbersSupported,
    parseJsonLoose,
    parseMeetingDate,
    parseUsd,
    phaseLabel,
    phraseInSource,
    quoteInSource,
    shouldPushNow,
    summarizeRegistry,
    type ThemeDef,
} from '@/lib/frontier-math';
import { SEED_THEMES } from '@/lib/frontier-seed';
import { keepItem } from '../catalyst-monitor/src/frontier/sources/news';
import { parseDisplayName } from '../catalyst-monitor/src/frontier/sources/deals';
import { acceptTickers, ruleTriage } from '../catalyst-monitor/src/frontier/triage';
import { reassess, validateAnalysis } from '../catalyst-monitor/src/frontier/analyze';

const THEMES: ThemeDef[] = SEED_THEMES.map((t) => ({ key: t.key, keywords: t.keywords, tickers: t.tickers }));

describe('keywordHit', () => {
    it('matches short all-caps keywords case-sensitively on word boundaries', () => {
        expect(keywordHit('Novel ADC shows response', 'ADC')).toBe(true);
        expect(keywordHit('the adc pathway', 'ADC')).toBe(false);
        expect(keywordHit('Company said it would', 'AI')).toBe(false);
        expect(keywordHit('An AI-designed molecule', 'AI')).toBe(true);
        expect(keywordHit('GLP-1 agonist', 'GLP-1')).toBe(true);
    });

    it('matches longer keywords case-insensitively', () => {
        expect(keywordHit('Machine Learning model', 'machine learning')).toBe(true);
        expect(keywordHit('alphafold3 release', 'AlphaFold')).toBe(false);
    });
});

describe('companyCore', () => {
    it('strips legal suffixes and a dangling "and"', () => {
        expect(companyCore('Eli Lilly and Company')).toBe('Eli Lilly');
        expect(companyCore('Schrödinger, Inc.')).toBe('Schrödinger');
        expect(companyCore('Merck & Co.')).toBe('Merck');
    });
});

describe('extractExchangeTickers', () => {
    it('reads exchange annotations and cashtags only', () => {
        const text = 'Recursion (Nasdaq: RXRX) and Lilly (NYSE: LLY) partner; $TEM rallies. TEM is not counted alone.';
        expect(extractExchangeTickers(text).sort()).toEqual(['LLY', 'RXRX', 'TEM']);
        expect(extractExchangeTickers('A TEM scan')).toEqual([]);
    });
});

describe('matchThemes', () => {
    it('tags themes by keyword and by company name', () => {
        const m = matchThemes('Eli Lilly reports Phase 3 orforglipron obesity data', THEMES);
        expect(m.themes).toContain('obesity');
        expect(m.tickers).toContain('LLY');
        expect(m.keywordHit).toBe(true);
    });

    it('does not let a big-pharma name alone pull an item into a theme', () => {
        const m = matchThemes('Lilly again far surpasses revenue expectations', THEMES);
        expect(m.tickers).toContain('LLY');
        expect(m.themes).toEqual([]);
        expect(matchThemes('Recursion cuts staff', THEMES).themes).toEqual(['ai-drug']);
    });

    it('does not tag unrelated text', () => {
        const m = matchThemes('Hospital opens new parking garage', THEMES);
        expect(m.themes).toEqual([]);
        expect(m.tickers).toEqual([]);
    });
});

describe('news prefilter', () => {
    const strict = { name: 'PR Newswire Health', url: 'x', strict: true };
    const normal = { name: 'STAT Biotech', url: 'x' };
    const fda = { name: 'FDA Press Releases', url: 'x' };

    it('keeps theme hits from normal feeds', () => {
        expect(keepItem(normal, 'New CRISPR therapy shows durable response', THEMES).keep).toBe(true);
        expect(keepItem(normal, 'Hospital mergers in Ohio', THEMES).keep).toBe(false);
    });

    it('requires a ticker on strict (wire) feeds', () => {
        expect(keepItem(strict, 'Dental clinic adopts AI scheduling', THEMES).keep).toBe(false);
        expect(keepItem(strict, 'Acme Bio (Nasdaq: ACME) announces AI drug discovery pact', THEMES).keep).toBe(true);
    });

    it('keeps drug-related FDA items only', () => {
        expect(keepItem(fda, 'FDA approves first treatment for rare disease', THEMES).keep).toBe(true);
        expect(keepItem(fda, 'FDA warns about contaminated pet food', THEMES).keep).toBe(false);
        expect(keepItem(fda, 'Drugs@FDA Data Files', THEMES).keep).toBe(false);
        expect(keepItem(fda, 'FDA Approves First Plasmid DNA-based Immunotherapy', THEMES).keep).toBe(true);
    });
});

describe('story clustering', () => {
    it('groups near-identical headlines', () => {
        const events = [{ id: 'a', titles: ['Lilly to acquire Verve Therapeutics for $1.3 billion'] }];
        expect(findSameStory('Lilly to acquire Verve Therapeutics in $1.3 billion deal', events)?.id).toBe('a');
        expect(findSameStory('Novo Nordisk cuts guidance on Wegovy sales', events)).toBeNull();
        const stat = [{ id: 'b', titles: ['STAT+: Lilly says ‘triple-G’ drug beat Novo’s Ozempic in diabetes study'] }];
        expect(findSameStory('STAT+: Lilly’s triple-G drug beats Ozempic in head-to-head study', stat)?.id).toBe('b');
    });
});

describe('fact checking', () => {
    const source = 'Under the agreement, Acme will receive an upfront payment of $250 million and is eligible for up to $1.2 billion in milestones.';

    it('verifies quotes present in the source', () => {
        expect(quoteInSource('Acme will receive an upfront payment of $250 million', source)).toBe(true);
        expect(quoteInSource('Acme will receive an upfront payment of $300 million', source)).toBe(false);
    });

    it('rejects facts whose numbers are not in the quote', () => {
        const quote = 'Acme will receive an upfront payment of $250 million';
        expect(numbersSupported('首付款 $250 million', quote)).toBe(true);
        expect(numbersSupported('首付款 $250 million，总额 $2 billion', quote)).toBe(false);
        expect(checkFact({ text: '首付 $250 million', quote }, source).verified).toBe(true);
        expect(checkFact({ text: '首付 $350 million', quote }, source).verified).toBe(false);
    });

    it('accepts English month names for Chinese dates', () => {
        expect(numbersSupported('协议日期为 2026 年 8 月 27 日', 'Agreement dated as of August 27, 2026')).toBe(true);
        expect(numbersSupported('协议日期为 2026 年 9 月 27 日', 'Agreement dated as of August 27, 2026')).toBe(false);
        expect(numbersSupported('可获 5 项里程碑', 'Acme may receive milestone payments')).toBe(false);
    });

    it('tolerates a dropped word in long quotes but not invented sentences', () => {
        const legal =
            'authorizing and approving the sale of the Purchased Assets to Teva Pharmaceuticals International GmbH in accordance with the terms and conditions contained in that certain Asset Purchase Agreement free and clear of all liens claims encumbrances and other interests';
        const slightlyOff =
            'authorizing and approving the sale of the Purchased Assets to Teva Pharmaceuticals International GmbH in accordance with the terms and conditions contained in that certain Asset Purchase Agreement free and clear of all liens claims and encumbrances and other interests';
        expect(quoteInSource(slightlyOff, legal)).toBe(true);
        expect(quoteInSource('the sale of the Purchased Assets to Pfizer Inc for cash consideration of two billion dollars in total', legal)).toBe(false);
    });

    it('checks short amount phrases', () => {
        expect(phraseInSource('$1.2 billion', source)).toBe(true);
        expect(phraseInSource('$1.5 billion', source)).toBe(false);
    });
});

describe('parseUsd', () => {
    it('parses common amount spellings', () => {
        expect(parseUsd('$1.2 billion')).toBe(1.2e9);
        expect(parseUsd('US$75 million')).toBe(75e6);
        expect(parseUsd('$250M')).toBe(250e6);
        expect(parseUsd('$1,500,000')).toBe(1.5e6);
        expect(parseUsd('12 亿美元')).toBeNull();
    });
});

describe('parseJsonLoose', () => {
    it('extracts JSON from fenced or chatty replies', () => {
        expect(parseJsonLoose<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
        expect(parseJsonLoose<number[]>('Here you go: [1,2] done')).toEqual([1, 2]);
        expect(parseJsonLoose('no json')).toBeNull();
    });
});

describe('parseMeetingDate', () => {
    it('reads Federal Register meeting dates', () => {
        expect(parseMeetingDate('The meeting will be held on October 30, 2026, from 8:30 a.m.')).toBe('2026-10-30');
        expect(parseMeetingDate(null)).toBeNull();
    });
});

describe('summarizeRegistry', () => {
    it('takes the highest non-terminated phase and the nearest active readout', () => {
        const s = summarizeRegistry(
            [
                { nctId: 'NCT1', phases: ['PHASE1'], status: 'COMPLETED' },
                { nctId: 'NCT2', phases: ['PHASE2'], status: 'RECRUITING', primaryCompletion: '2027-03-01' },
                { nctId: 'NCT3', phases: ['PHASE3'], status: 'TERMINATED', primaryCompletion: '2026-12-01' },
                { nctId: 'NCT4', phases: ['PHASE1', 'PHASE2'], status: 'ACTIVE_NOT_RECRUITING', primaryCompletion: '2026-12-15' },
            ],
            '2026-11-01',
        );
        expect(s.maxPhase).toBe(2);
        expect(phaseLabel(s.maxPhase)).toBe('P2');
        expect(s.nextReadout).toBe('2026-12-15');
        expect(s.leadStatus).toBe('ACTIVE_NOT_RECRUITING');
        expect(summarizeRegistry([{ nctId: 'N', phases: ['PHASE2'], status: 'RECRUITING', primaryCompletion: '2026-11' }], '2026-11-15').nextReadout).toBe('2026-11');
        expect(s.nctIds).toEqual(['NCT1', 'NCT2', 'NCT3', 'NCT4']);
    });
});

describe('basketStat', () => {
    const series = (start: number, step: number, n = 70) =>
        Array.from({ length: n }, (_, i) => ({ date: `d${i}`, c: start + step * i }));

    it('averages member returns and subtracts the benchmark', () => {
        const bars = { A: series(100, 1), B: series(100, 0), XBI: series(100, 0) };
        const s = basketStat(bars, ['A', 'B', 'MISSING'], 'XBI');
        // A: (169-149)/149 over 20 bars, B: 0 → average
        expect(s.ret[20]).toBeCloseTo(((169 - 149) / 149) * 100 / 2, 6);
        expect(s.excess[20]).toBeCloseTo(s.ret[20]!, 6);
        expect(s.members.find((m) => m.symbol === 'MISSING')?.ret20).toBeNull();
    });
});

describe('diffHoldings', () => {
    it('classifies new/add/trim/exit and ignores options and small changes', () => {
        const prev = [
            { issuer: 'A', cusip: '1', value: 100, shares: 100 },
            { issuer: 'B', cusip: '2', value: 100, shares: 100 },
            { issuer: 'C', cusip: '3', value: 100, shares: 100 },
            { issuer: 'D', cusip: '4', value: 100, shares: 100 },
        ];
        const cur = [
            { issuer: 'A', cusip: '1', value: 300, shares: 150 },
            { issuer: 'B', cusip: '2', value: 50, shares: 50 },
            { issuer: 'D', cusip: '4', value: 110, shares: 110 },
            { issuer: 'E', cusip: '5', value: 500, shares: 10 },
            { issuer: 'F', cusip: '6', value: 999, shares: 10, putCall: 'Call' },
        ];
        const d = diffHoldings(prev, cur);
        const kind = Object.fromEntries(d.map((c) => [c.issuer, c.change]));
        expect(kind).toEqual({ A: 'add', B: 'trim', C: 'exit', E: 'new' });
        expect(d[0].issuer).toBe('E');
    });
});

describe('LLM budget', () => {
    it('reserves room for triage and weekly when deep analysis competes', () => {
        expect(canSpend('triage', 39, 40)).toBe(true);
        expect(canSpend('triage', 40, 40)).toBe(false);
        expect(canSpend('deep', 33, 40)).toBe(true);
        expect(canSpend('deep', 34, 40)).toBe(false);
        expect(canSpend('weekly', 42, 40)).toBe(true);
    });
});

describe('push and signals', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    it('pushes only fresh importance-5 events', () => {
        expect(shouldPushNow(5, new Date('2026-11-01T02:00:00Z'), now)).toBe(true);
        expect(shouldPushNow(5, new Date('2026-10-30T02:00:00Z'), now)).toBe(false);
        expect(shouldPushNow(4, null, now)).toBe(false);
    });

    it('records direct beneficiaries as up and hurt as down', () => {
        expect(
            beneficiarySignals([
                { symbol: 'LLY', relation: 'direct' },
                { symbol: 'NVO', relation: 'hurt' },
                { symbol: 'TMO', relation: 'indirect' },
                { symbol: 'LLY', relation: 'direct' },
                { symbol: 'bad', relation: 'direct' },
            ]),
        ).toEqual([
            { symbol: 'LLY', direction: 'up' },
            { symbol: 'NVO', direction: 'down' },
        ]);
    });
});

describe('triage helpers', () => {
    it('accepts LLM tickers only when they appear in the text', () => {
        const it = { title: 'Recursion and Exscientia update', snippet: 'RXRX shares rose', ruleTickers: [] };
        expect(acceptTickers(it, ['RXRX', 'NVDA', 'lower'])).toEqual(['RXRX']);
    });

    it('falls back to rule-based labels', () => {
        const r = ruleTriage({ source: 'approval', title: 'FDA approves X', ruleThemes: ['adc'], ruleTickers: [], raw: null }, new Set());
        expect(r).toMatchObject({ eventType: 'approval', importance: 4, mode: 'rule' });
        const crl = ruleTriage({ source: 'fda', title: 'FDA complete response letter (not approved): Acme', ruleThemes: [], ruleTickers: [], raw: null }, new Set());
        expect(crl.eventType).toBe('rejection');
    });

    it('parses EDGAR display names', () => {
        expect(parseDisplayName('Zymeworks Inc.  (ZYME)  (CIK 0001937653)')).toEqual({ name: 'Zymeworks Inc.', ticker: 'ZYME' });
        expect(parseDisplayName('KIORA PHARMACEUTICALS INC  (KPRX, KPHMW)  (CIK 0001372514)').ticker).toBe('KPRX');
        expect(parseDisplayName('Private Co  (CIK 0000000001)')).toEqual({ name: 'Private Co', ticker: null });
    });
});

describe('validateAnalysis', () => {
    it('marks unsupported facts and drops malformed beneficiaries', () => {
        const corpus = 'Acme will receive an upfront payment of $250 million from BigPharma.';
        const a = validateAnalysis(
            {
                summary: 's',
                facts: [
                    { text: '首付 $250 million', quote: 'Acme will receive an upfront payment of $250 million' },
                    { text: '总额 $5 billion', quote: 'total deal value of $5 billion' },
                ],
                stance: 'weird',
                beneficiaries: [
                    { symbol: 'acme', relation: 'direct' },
                    { symbol: 'BPH', relation: 'direct', name: 'BigPharma', reason: 'r' },
                    { symbol: 'XYZ', relation: 'sideways' },
                ],
            },
            corpus,
            true,
        );
        expect(a.facts.map((f) => f.verified)).toEqual([true, false]);
        expect(a.stance).toBe('neutral');
        expect(a.beneficiaries.map((b) => b.symbol)).toEqual(['ACME', 'BPH']);
    });
});

describe('reassess', () => {
    it('lets full-text analysis move importance by at most two stars', () => {
        expect(reassess(2, 5)).toBe(4);
        expect(reassess(4, 1)).toBe(2);
        expect(reassess(3, '4')).toBe(4);
        expect(reassess(3, undefined)).toBe(3);
    });
});

describe('misc', () => {
    it('cleans html and entities', () => {
        expect(cleanHtmlText('<p>Lilly&#8217;s <b>drug</b> &amp; more</p>')).toBe('Lilly’s drug & more');
    });

    it('computes ISO weeks', () => {
        expect(isoWeekOf(new Date('2026-11-02T01:00:00Z'))).toBe('2026-W45');
    });
});
