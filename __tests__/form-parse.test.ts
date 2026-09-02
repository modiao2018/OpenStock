import { describe, expect, it } from 'vitest';
import { parseForm4Xml, parseForm144Xml } from '../catalyst-monitor/src/form-parse';

const FORM4_XML = `<?xml version="1.0"?>
<ownershipDocument>
    <issuer><issuerCik>0001045810</issuerCik><issuerTradingSymbol>NVDA</issuerTradingSymbol></issuer>
    <reportingOwner>
        <reportingOwnerId><rptOwnerCik>0001234567</rptOwnerCik><rptOwnerName>HUANG JEN HSUN</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>1</isOfficer></reportingOwnerRelationship>
    </reportingOwner>
    <nonDerivativeTable>
        <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>2026-08-28</value></transactionDate>
            <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>S</transactionCode><equitySwapInvolved>0</equitySwapInvolved></transactionCoding>
            <transactionAmounts>
                <transactionShares><value>75000</value></transactionShares>
                <transactionPricePerShare><value>178.4321</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts><sharesOwnedFollowingTransaction><value>75000000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
        </nonDerivativeTransaction>
        <nonDerivativeTransaction>
            <transactionDate><value>2026-08-28</value></transactionDate>
            <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
            <transactionAmounts>
                <transactionShares><value>75000</value></transactionShares>
                <transactionPricePerShare><value>4.00</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
        </nonDerivativeTransaction>
    </nonDerivativeTable>
</ownershipDocument>`;

const FORM4_SINGLE_BUY = `<?xml version="1.0"?>
<ownershipDocument>
    <reportingOwner>
        <reportingOwnerId><rptOwnerName>BURKE JAMES A</rptOwnerName></reportingOwnerId>
    </reportingOwner>
    <nonDerivativeTable>
        <nonDerivativeTransaction>
            <transactionDate><value>2026-08-24</value></transactionDate>
            <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
            <transactionAmounts>
                <transactionShares><value>2000</value></transactionShares>
                <transactionPricePerShare><value>135</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
        </nonDerivativeTransaction>
    </nonDerivativeTable>
</ownershipDocument>`;

const FORM144_XML = `<?xml version="1.0"?>
<edgarSubmission>
    <formData>
        <issuerInfo>
            <issuerCik>0001045810</issuerCik>
            <nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold>HUANG JEN HSUN</nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold>
        </issuerInfo>
        <securitiesInformation>
            <brokerOrMarketmakerDetails><name>Morgan Stanley</name></brokerOrMarketmakerDetails>
            <noOfUnitsSold>75000</noOfUnitsSold>
            <aggregateMarketValue>13382407.50</aggregateMarketValue>
            <approxSaleDate>09/01/2026</approxSaleDate>
            <securitiesExchangeName>NASDAQ</securitiesExchangeName>
        </securitiesInformation>
    </formData>
</edgarSubmission>`;

describe('parseForm4Xml', () => {
    it('extracts open-market transactions with signed share change', () => {
        const txs = parseForm4Xml(FORM4_XML);
        expect(txs).toHaveLength(2); // caller filters codes; parser returns all rows
        const sell = txs.find((t) => t.transactionCode === 'S')!;
        expect(sell.name).toBe('HUANG JEN HSUN');
        expect(sell.change).toBe(-75000);
        expect(sell.price).toBeCloseTo(178.4321, 4);
        expect(sell.transactionDate).toBe('2026-08-28');
        const exercise = txs.find((t) => t.transactionCode === 'M')!;
        expect(exercise.change).toBe(75000); // acquired
    });

    it('parses a single-transaction buy (non-array node)', () => {
        const txs = parseForm4Xml(FORM4_SINGLE_BUY);
        expect(txs).toHaveLength(1);
        expect(txs[0]).toMatchObject({
            name: 'BURKE JAMES A',
            transactionCode: 'P',
            change: 2000,
            price: 135,
            transactionDate: '2026-08-24',
        });
    });

    it('returns [] for non-Form-4 documents', () => {
        expect(parseForm4Xml('<html>not a form</html>')).toEqual([]);
        expect(parseForm4Xml(FORM144_XML)).toEqual([]);
    });
});

describe('parseForm144Xml', () => {
    it('extracts person, shares, value and normalized sale date', () => {
        const parsed = parseForm144Xml(FORM144_XML);
        expect(parsed.person).toBe('HUANG JEN HSUN');
        expect(parsed.shares).toBe(75000);
        expect(parsed.valueUsd).toBeCloseTo(13382407.5, 1);
        expect(parsed.approxSaleDate).toBe('2026-09-01');
    });

    it('degrades to nulls on unknown structure', () => {
        const parsed = parseForm144Xml('<edgarSubmission><formData/></edgarSubmission>');
        expect(parsed).toEqual({ person: null, shares: null, valueUsd: null, approxSaleDate: null });
    });
});
