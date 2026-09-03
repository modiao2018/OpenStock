import { describe, expect, it } from 'vitest';

import {
    buildFundamentalsSnapshot,
    edgarHeaders,
    filingDocUrl,
    filingIndexUrl,
    isOpenMarketTrade,
    normalizeTicker,
    parseCikMap,
    parseForm4Xml,
    submissionsUrl,
    summarizeInsiderActivity,
    yoyGrowth,
    type CompanyFactsPayload,
    type InsiderTransaction,
} from '@/lib/edgar';
import { parseForm4Xml as parseForm4ForDaemon } from '../catalyst-monitor/src/form-parse';

describe('EDGAR request plumbing shared by web and daemon', () => {
    it('builds SEC URLs from padded or unpadded CIKs and strips viewer prefixes', () => {
        expect(submissionsUrl('320193')).toBe('https://data.sec.gov/submissions/CIK0000320193.json');
        expect(submissionsUrl('0000320193')).toBe('https://data.sec.gov/submissions/CIK0000320193.json');
        expect(filingDocUrl('0000097745', '0000097745-26-000167', 'xslF345X06/wk-form4_1788293473.xml')).toBe(
            'https://www.sec.gov/Archives/edgar/data/97745/000009774526000167/wk-form4_1788293473.xml',
        );
        expect(filingIndexUrl('97745', '0000097745-26-000167')).toBe(
            'https://www.sec.gov/Archives/edgar/data/97745/000009774526000167/0000097745-26-000167-index.htm',
        );
    });

    it('parses company_tickers.json into an upper-cased ticker map', () => {
        expect(parseCikMap({ '0': { cik_str: 320193, ticker: 'aapl', title: 'Apple' }, '1': { cik_str: 1717115, ticker: 'TEM' } }))
            .toEqual({ AAPL: '320193', TEM: '1717115' });
        expect(normalizeTicker(' brk.b ')).toBe('BRK-B');
    });

    it('puts the contact in the User-Agent', () => {
        expect(edgarHeaders('ops@example.com')['User-Agent']).toContain('ops@example.com');
    });
});

const META = {
    symbol: 'TMO',
    filingDate: '2026-09-01',
    accessionNumber: '0000097745-26-000167',
    filingUrl: 'https://www.sec.gov/Archives/edgar/data/97745/000009774526000167/0000097745-26-000167-index.htm',
};

const FORM4_XML = `<?xml version="1.0"?>
<ownershipDocument>
    <documentType>4</documentType>
    <periodOfReport>2026-08-28</periodOfReport>
    <issuer><issuerTradingSymbol>TMO</issuerTradingSymbol></issuer>
    <reportingOwner>
        <reportingOwnerId><rptOwnerName>CASPER MARC N</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship>
            <isDirector>1</isDirector>
            <isOfficer>1</isOfficer>
            <isTenPercentOwner>0</isTenPercentOwner>
            <officerTitle>Chairman &amp; CEO</officerTitle>
        </reportingOwnerRelationship>
    </reportingOwner>
    <aff10b5One>1</aff10b5One>
    <nonDerivativeTable>
        <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>2026-08-28</value></transactionDate>
            <transactionCoding><transactionCode>F</transactionCode></transactionCoding>
            <transactionAmounts>
                <transactionShares><value>724.766</value></transactionShares>
                <transactionPricePerShare><value>622.18</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts><sharesOwnedFollowingTransaction><value>123200.592</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
        </nonDerivativeTransaction>
        <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>2026-08-27</value></transactionDate>
            <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
            <transactionAmounts>
                <transactionShares><value>1,000</value></transactionShares>
                <transactionPricePerShare><value>600</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
        </nonDerivativeTransaction>
        <nonDerivativeHolding>
            <securityTitle><value>Common Stock</value></securityTitle>
            <postTransactionAmounts><sharesOwnedFollowingTransaction><value>11300</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
        </nonDerivativeHolding>
    </nonDerivativeTable>
    <derivativeTable>
        <derivativeTransaction>
            <securityTitle><value>Stock Option</value></securityTitle>
            <transactionDate><value>2026-08-28</value></transactionDate>
            <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
            <transactionAmounts>
                <transactionShares><value>500</value></transactionShares>
                <transactionPricePerShare><value>309.63</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
        </derivativeTransaction>
    </derivativeTable>
</ownershipDocument>`;

describe('parseForm4Xml', () => {
    it('extracts owner, role and every transaction while skipping holdings', () => {
        const rows = parseForm4Xml(FORM4_XML, META);
        expect(rows).toHaveLength(3);

        const [withholding, purchase, option] = rows;
        expect(withholding).toMatchObject({
            symbol: 'TMO',
            ownerName: 'CASPER MARC N',
            ownerTitle: 'Chairman & CEO',
            isDirector: true,
            isOfficer: true,
            isTenPercentOwner: false,
            transactionCode: 'F',
            acquiredDisposed: 'D',
            shares: 724.766,
            pricePerShare: 622.18,
            sharesOwnedAfter: 123200.592,
            isDerivative: false,
            isRule10b51: true,
            transactionDate: '2026-08-28',
            filingDate: '2026-09-01',
        });
        expect(withholding.change).toBeCloseTo(-724.766);
        expect(withholding.value).toBeCloseTo(-724.766 * 622.18);

        expect(purchase).toMatchObject({ transactionCode: 'P', shares: 1000, change: 1000, value: 600000 });
        expect(option).toMatchObject({ transactionCode: 'M', isDerivative: true, securityTitle: 'Stock Option', change: -500 });
    });

    it('falls back gracefully on a filing with no transactions', () => {
        const rows = parseForm4Xml('<ownershipDocument><reportingOwner></reportingOwner></ownershipDocument>', META);
        expect(rows).toEqual([]);
    });

    it('joins multiple reporting owners on joint filings', () => {
        const joint = FORM4_XML.replace(
            '</reportingOwner>',
            '</reportingOwner><reportingOwner><reportingOwnerId><rptOwnerName>CASPER FAMILY TRUST</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isTenPercentOwner>1</isTenPercentOwner></reportingOwnerRelationship></reportingOwner>',
        );
        const [row] = parseForm4Xml(joint, META);
        expect(row.ownerName).toBe('CASPER MARC N / CASPER FAMILY TRUST');
        expect(row.ownerTitle).toBe('Chairman & CEO');
        expect(row.isTenPercentOwner).toBe(true);
    });

    it('feeds the daemon the same rows in its legacy shape', () => {
        const rows = parseForm4ForDaemon(FORM4_XML);
        expect(rows).toEqual([
            { name: 'CASPER MARC N', transactionCode: 'F', change: -724.766, price: 622.18, transactionDate: '2026-08-28' },
            { name: 'CASPER MARC N', transactionCode: 'P', change: 1000, price: 600, transactionDate: '2026-08-27' },
        ]);
        expect(parseForm4ForDaemon('<html>not a form</html>')).toEqual([]);
    });

    it('treats an empty officerTitle as null', () => {
        const xml = FORM4_XML.replace('<officerTitle>Chairman &amp; CEO</officerTitle>', '<officerTitle></officerTitle>');
        expect(parseForm4Xml(xml, META)[0].ownerTitle).toBeNull();
    });
});

describe('summarizeInsiderActivity', () => {
    const base = (over: Partial<InsiderTransaction>): InsiderTransaction => ({
        symbol: 'X',
        filingDate: '2026-09-01',
        transactionDate: '2026-08-28',
        accessionNumber: 'acc-1',
        filingUrl: '',
        ownerName: 'A',
        ownerTitle: null,
        isDirector: false,
        isOfficer: true,
        isTenPercentOwner: false,
        securityTitle: 'Common Stock',
        transactionCode: 'S',
        acquiredDisposed: 'D',
        shares: 100,
        pricePerShare: 10,
        change: -100,
        value: -1000,
        sharesOwnedAfter: null,
        isDerivative: false,
        isRule10b51: false,
        ...over,
    });

    it('counts only open-market P/S trades toward the signal', () => {
        const summary = summarizeInsiderActivity('X', [
            base({ transactionCode: 'S', value: -50_000, ownerName: 'Seller' }),
            base({ transactionCode: 'F', value: -900_000, ownerName: 'Withheld', accessionNumber: 'acc-2' }),
            base({ transactionCode: 'P', acquiredDisposed: 'A', change: 100, value: 10_000, ownerName: 'Buyer', accessionNumber: 'acc-3' }),
            base({ transactionCode: 'S', isDerivative: true, value: -5_000_000, ownerName: 'Deriv', accessionNumber: 'acc-4' }),
        ], 30);

        expect(summary).toMatchObject({
            filingCount: 4,
            transactionCount: 4,
            openMarketBuys: 1,
            openMarketSells: 1,
            buyValue: 10_000,
            sellValue: 50_000,
            netValue: -40_000,
            buyers: ['Buyer'],
            sellers: ['Seller'],
            signal: 'net selling',
            latestFilingDate: '2026-09-01',
        });
    });

    it('reports no activity when nothing is open-market', () => {
        const summary = summarizeInsiderActivity('X', [base({ transactionCode: 'A' }), base({ transactionCode: 'M' })], 30);
        expect(summary.signal).toBe('no open-market activity');
        expect(summary.netValue).toBe(0);
    });

    it('flags mixed when buys and sells roughly offset', () => {
        const summary = summarizeInsiderActivity('X', [
            base({ transactionCode: 'P', acquiredDisposed: 'A', value: 100_000 }),
            base({ transactionCode: 'S', value: -90_000, accessionNumber: 'acc-2' }),
        ], 30);
        expect(summary.signal).toBe('mixed');
    });

    it('isOpenMarketTrade excludes derivative rows', () => {
        expect(isOpenMarketTrade({ transactionCode: 'P', isDerivative: false })).toBe(true);
        expect(isOpenMarketTrade({ transactionCode: 'P', isDerivative: true })).toBe(false);
        expect(isOpenMarketTrade({ transactionCode: 'F', isDerivative: false })).toBe(false);
    });
});

describe('buildFundamentalsSnapshot', () => {
    const row = (start: string, end: string, val: number, form: string, filed: string, fp: string) => ({ start, end, val, form, filed, fp, fy: Number(end.slice(0, 4)), accn: `acc-${end}` });

    const payload: CompanyFactsPayload = {
        cik: 1,
        entityName: 'Example Corp',
        facts: {
            'us-gaap': {
                // Legacy concept that stopped being used in 2018 must lose to the newer one.
                Revenues: { label: 'Revenues', units: { USD: [row('2018-01-01', '2018-03-31', 1, '10-Q', '2018-05-01', 'Q1')] } },
                RevenueFromContractWithCustomerExcludingAssessedTax: {
                    label: 'Revenue',
                    units: {
                        USD: [
                            row('2025-01-01', '2025-03-31', 100, '10-Q', '2025-05-01', 'Q1'),
                            row('2025-04-01', '2025-06-30', 110, '10-Q', '2025-08-01', 'Q2'),
                            row('2025-07-01', '2025-09-30', 120, '10-Q', '2025-11-01', 'Q3'),
                            row('2025-01-01', '2025-12-31', 460, '10-K', '2026-02-15', 'FY'),
                            row('2026-01-01', '2026-03-31', 125, '10-Q', '2026-05-01', 'Q1'),
                            // Restated Q1 2026 in a later filing wins.
                            row('2026-01-01', '2026-03-31', 126, '10-Q', '2026-08-01', 'Q1'),
                            row('2026-04-01', '2026-06-30', 140, '10-Q', '2026-08-01', 'Q2'),
                        ],
                    },
                },
                NetIncomeLoss: { label: 'Net income', units: { USD: [row('2026-04-01', '2026-06-30', 14, '10-Q', '2026-08-01', 'Q2')] } },
                Assets: { label: 'Assets', units: { USD: [{ end: '2026-06-30', val: 1000, form: '10-Q', filed: '2026-08-01', fp: 'Q2', fy: 2026, accn: 'acc-a' }] } },
            },
        },
    };

    it('picks the concept with the freshest data and derives Q4 from the annual figure', () => {
        const snap = buildFundamentalsSnapshot('EX', payload);
        expect(snap.revenue?.concept).toBe('RevenueFromContractWithCustomerExcludingAssessedTax');
        expect(snap.revenue?.value).toBe(140);
        expect(snap.quarterlyRevenue.map((q) => [q.periodEnd, q.value, q.fiscalPeriod])).toEqual([
            ['2026-06-30', 140, 'Q2'],
            ['2026-03-31', 126, 'Q1'],
            ['2025-12-31', 130, 'Q4'],
            ['2025-09-30', 120, 'Q3'],
            ['2025-06-30', 110, 'Q2'],
            ['2025-03-31', 100, 'Q1'],
        ]);
        expect(snap.totalAssets?.value).toBe(1000);
        expect(snap.latestFiling).toMatchObject({ form: '10-Q', filed: '2026-08-01' });
    });

    it('computes year-over-year growth by matching period end dates', () => {
        const snap = buildFundamentalsSnapshot('EX', payload);
        expect(yoyGrowth(snap.quarterlyRevenue)).toBeCloseTo((140 - 110) / 110);
        expect(yoyGrowth(snap.quarterlyRevenue.slice(0, 2))).toBeNull();
    });
});
