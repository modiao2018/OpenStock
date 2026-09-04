import { describe, expect, it } from 'vitest';
import { matchWatchItem } from '../catalyst-monitor/src/rss-match';
import type { WatchItem } from '../catalyst-monitor/src/types';

const MRNA: WatchItem = { symbol: 'MRNA', company: 'Moderna Inc', nctIds: [], keywords: [] };
const ABCL: WatchItem = { symbol: 'ABCL', company: 'AbCellera Biologics', nctIds: [], keywords: ['AbCellera', 'ABCL635'] };
const LIST = [MRNA, ABCL];

describe('matchWatchItem', () => {
    it('matches company name, its stem and keywords case-insensitively', () => {
        expect(matchWatchItem('Moderna reports Q3', LIST)?.symbol).toBe('MRNA');
        expect(matchWatchItem('MODERNA, INC. announces', LIST)?.symbol).toBe('MRNA');
        expect(matchWatchItem('abcl635 12-week data', LIST)?.symbol).toBe('ABCL');
    });

    it('matches the ticker only as an uppercase whole word', () => {
        expect(matchWatchItem('Shares of MRNA fell 5%', LIST)?.symbol).toBe('MRNA');
        expect(matchWatchItem('$MRNA breaks out', LIST)?.symbol).toBe('MRNA');
        // The 2026-09-02 false positive: a third-party PR about mRNA lab technique
        expect(matchWatchItem('New Study Identifies RT-qPCR Artifact in CRISPR Knockdown; mRNA quantification improved', LIST)).toBeNull();
        expect(matchWatchItem('ABCL635', LIST)?.symbol).toBe('ABCL'); // keyword still hits
        expect(matchWatchItem('XMRNAX', LIST)).toBeNull();
    });

    it('ignores needles shorter than 4 chars so short company stems cannot spray', () => {
        const ai: WatchItem = { symbol: 'AI', company: 'C3 AI', nctIds: [], keywords: [] };
        expect(matchWatchItem('AI adoption accelerates across enterprises', [ai])?.symbol).toBe('AI'); // ticker word match
        expect(matchWatchItem('c3 partners with retail chain', [ai])).toBeNull();
    });
});
