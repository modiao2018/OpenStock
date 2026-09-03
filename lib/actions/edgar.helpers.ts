/**
 * Pure helpers for SEC EDGAR data (Form 4 insider filings, XBRL company facts).
 * No network access here so everything is unit-testable.
 */

export type InsiderTransactionCode =
    | 'P' // open-market purchase
    | 'S' // open-market sale
    | 'A' // grant / award
    | 'M' // option exercise / conversion
    | 'F' // tax withholding
    | 'G' // gift
    | 'D' // disposition to issuer
    | 'C' // conversion of derivative
    | 'X' // exercise of in-the-money derivative
    | 'J' // other
    | string;

export interface InsiderTransaction {
    symbol: string;
    filingDate: string;
    transactionDate: string;
    accessionNumber: string;
    filingUrl: string;
    ownerName: string;
    ownerTitle: string | null;
    isDirector: boolean;
    isOfficer: boolean;
    isTenPercentOwner: boolean;
    securityTitle: string;
    transactionCode: InsiderTransactionCode;
    acquiredDisposed: 'A' | 'D' | null;
    shares: number | null;
    pricePerShare: number | null;
    /** Signed share change: positive when acquired, negative when disposed. */
    change: number | null;
    /** Signed dollar value of the transaction (shares * price), null when price unknown/zero. */
    value: number | null;
    sharesOwnedAfter: number | null;
    isDerivative: boolean;
    /** True for scheduled 10b5-1 plan trades. */
    isRule10b51: boolean;
}

export interface InsiderActivitySummary {
    symbol: string;
    lookbackDays: number;
    filingCount: number;
    transactionCount: number;
    openMarketBuys: number;
    openMarketSells: number;
    buyValue: number;
    sellValue: number;
    netValue: number;
    buyers: string[];
    sellers: string[];
    /** Heuristic read of the tape. */
    signal: 'net buying' | 'net selling' | 'mixed' | 'no open-market activity';
    latestFilingDate: string | null;
}

export const TRANSACTION_CODE_LABELS: Record<string, string> = {
    P: 'Open-market purchase',
    S: 'Open-market sale',
    A: 'Grant / award',
    M: 'Option exercise',
    F: 'Tax withholding',
    G: 'Gift',
    D: 'Disposition to issuer',
    C: 'Conversion',
    X: 'Exercise (in the money)',
    J: 'Other',
    W: 'Will / inheritance',
    I: 'Discretionary transaction',
    Z: 'Voting trust',
    U: 'Tender of shares',
    L: 'Small acquisition',
};

export function describeTransactionCode(code: string): string {
    return TRANSACTION_CODE_LABELS[code] ?? `Code ${code}`;
}

/** Only P and S reflect an insider's own conviction with their own money. */
export function isOpenMarketTrade(tx: Pick<InsiderTransaction, 'transactionCode' | 'isDerivative'>): boolean {
    return !tx.isDerivative && (tx.transactionCode === 'P' || tx.transactionCode === 'S');
}

// ---------------------------------------------------------------------------
// Minimal XML helpers. Form 4 XML is flat and predictable, so a regex-based
// extractor is enough and avoids pulling in a parser dependency.
// ---------------------------------------------------------------------------

function decodeEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function tagContent(xml: string, tag: string): string | null {
    const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
    return match ? match[1] : null;
}

function tagText(xml: string, tag: string): string | null {
    const content = tagContent(xml, tag);
    if (content === null) return null;
    return decodeEntities(content.replace(/<[^>]+>/g, '').trim());
}

/** Reads `<tag><value>x</value></tag>` blocks, falling back to plain `<tag>x</tag>`. */
function valueText(xml: string, tag: string): string | null {
    const content = tagContent(xml, tag);
    if (content === null) return null;
    const inner = tagContent(content, 'value');
    const raw = inner !== null ? inner : content;
    const text = decodeEntities(raw.replace(/<[^>]+>/g, '').trim());
    return text === '' ? null : text;
}

function valueNumber(xml: string, tag: string): number | null {
    const text = valueText(xml, tag);
    if (text === null) return null;
    const parsed = Number(text.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function allBlocks(xml: string, tag: string): string[] {
    const blocks: string[] = [];
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml)) !== null) {
        blocks.push(match[1]);
    }
    return blocks;
}

function flag(xml: string, tag: string): boolean {
    const text = tagText(xml, tag);
    return text === '1' || text?.toLowerCase() === 'true';
}

export interface Form4FilingMeta {
    symbol: string;
    filingDate: string;
    accessionNumber: string;
    filingUrl: string;
}

/**
 * Parses a Form 4 / Form 4-A ownership document into flat transactions.
 * Holdings-only rows (no transaction) are skipped.
 */
export function parseForm4Xml(xml: string, meta: Form4FilingMeta): InsiderTransaction[] {
    const ownerBlock = tagContent(xml, 'reportingOwner') ?? '';
    const ownerName = tagText(ownerBlock, 'rptOwnerName') ?? 'Unknown insider';
    const ownerTitle = tagText(ownerBlock, 'officerTitle') || null;
    const isDirector = flag(ownerBlock, 'isDirector');
    const isOfficer = flag(ownerBlock, 'isOfficer');
    const isTenPercentOwner = flag(ownerBlock, 'isTenPercentOwner');
    const isRule10b51 = flag(xml, 'aff10b5One');
    const periodOfReport = tagText(xml, 'periodOfReport');

    const rows: InsiderTransaction[] = [];

    const collect = (block: string, isDerivative: boolean) => {
        const code = valueText(block, 'transactionCode') ?? tagText(block, 'transactionCode') ?? 'J';
        const shares = valueNumber(block, 'transactionShares');
        const price = valueNumber(block, 'transactionPricePerShare');
        const adRaw = valueText(block, 'transactionAcquiredDisposedCode');
        const acquiredDisposed: 'A' | 'D' | null = adRaw === 'A' || adRaw === 'D' ? adRaw : null;
        const sign = acquiredDisposed === 'D' ? -1 : acquiredDisposed === 'A' ? 1 : 0;
        const change = shares !== null && sign !== 0 ? sign * shares : null;
        const value = change !== null && price !== null && price > 0 ? change * price : null;

        rows.push({
            symbol: meta.symbol,
            filingDate: meta.filingDate,
            transactionDate: valueText(block, 'transactionDate') ?? periodOfReport ?? meta.filingDate,
            accessionNumber: meta.accessionNumber,
            filingUrl: meta.filingUrl,
            ownerName,
            ownerTitle,
            isDirector,
            isOfficer,
            isTenPercentOwner,
            securityTitle: valueText(block, 'securityTitle') ?? (isDerivative ? 'Derivative' : 'Common Stock'),
            transactionCode: code,
            acquiredDisposed,
            shares,
            pricePerShare: price,
            change,
            value,
            sharesOwnedAfter: valueNumber(block, 'sharesOwnedFollowingTransaction'),
            isDerivative,
            isRule10b51,
        });
    };

    for (const block of allBlocks(xml, 'nonDerivativeTransaction')) collect(block, false);
    for (const block of allBlocks(xml, 'derivativeTransaction')) collect(block, true);

    return rows;
}

export function summarizeInsiderActivity(
    symbol: string,
    transactions: InsiderTransaction[],
    lookbackDays: number,
): InsiderActivitySummary {
    const filings = new Set(transactions.map((t) => t.accessionNumber));
    const buyers = new Set<string>();
    const sellers = new Set<string>();
    let openMarketBuys = 0;
    let openMarketSells = 0;
    let buyValue = 0;
    let sellValue = 0;

    for (const tx of transactions) {
        if (!isOpenMarketTrade(tx)) continue;
        const absValue = Math.abs(tx.value ?? 0);
        if (tx.transactionCode === 'P') {
            openMarketBuys += 1;
            buyValue += absValue;
            buyers.add(tx.ownerName);
        } else {
            openMarketSells += 1;
            sellValue += absValue;
            sellers.add(tx.ownerName);
        }
    }

    const netValue = buyValue - sellValue;
    let signal: InsiderActivitySummary['signal'];
    if (openMarketBuys === 0 && openMarketSells === 0) {
        signal = 'no open-market activity';
    } else if (buyValue > 0 && sellValue > 0 && Math.abs(netValue) < Math.max(buyValue, sellValue) * 0.25) {
        signal = 'mixed';
    } else if (netValue >= 0) {
        signal = 'net buying';
    } else {
        signal = 'net selling';
    }

    const latestFilingDate = transactions.reduce<string | null>(
        (latest, tx) => (latest === null || tx.filingDate > latest ? tx.filingDate : latest),
        null,
    );

    return {
        symbol,
        lookbackDays,
        filingCount: filings.size,
        transactionCount: transactions.length,
        openMarketBuys,
        openMarketSells,
        buyValue: Math.round(buyValue),
        sellValue: Math.round(sellValue),
        netValue: Math.round(netValue),
        buyers: [...buyers],
        sellers: [...sellers],
        signal,
        latestFilingDate,
    };
}

// ---------------------------------------------------------------------------
// XBRL company facts (fundamentals straight from 10-Q / 10-K filings)
// ---------------------------------------------------------------------------

export interface XbrlFactRow {
    start?: string;
    end: string;
    val: number;
    accn: string;
    fy: number;
    fp: string;
    form: string;
    filed: string;
    frame?: string;
}

export interface CompanyFactsPayload {
    cik: number;
    entityName: string;
    facts: Record<string, Record<string, { label?: string; units: Record<string, XbrlFactRow[]> }>>;
}

export interface FundamentalPoint {
    concept: string;
    label: string;
    unit: string;
    value: number;
    periodEnd: string;
    periodStart: string | null;
    fiscalYear: number;
    fiscalPeriod: string;
    form: string;
    filed: string;
    frame: string | null;
}

export interface FundamentalsSnapshot {
    symbol: string;
    entityName: string;
    revenue: FundamentalPoint | null;
    netIncome: FundamentalPoint | null;
    dilutedEps: FundamentalPoint | null;
    operatingCashFlow: FundamentalPoint | null;
    totalAssets: FundamentalPoint | null;
    totalLiabilities: FundamentalPoint | null;
    stockholdersEquity: FundamentalPoint | null;
    cashAndEquivalents: FundamentalPoint | null;
    longTermDebt: FundamentalPoint | null;
    sharesOutstanding: FundamentalPoint | null;
    /** Trailing four quarters of revenue, most recent first. */
    quarterlyRevenue: FundamentalPoint[];
    quarterlyNetIncome: FundamentalPoint[];
    latestFiling: { form: string; filed: string; accessionNumber: string } | null;
}

const CONCEPT_ALIASES: Record<keyof Omit<FundamentalsSnapshot, 'symbol' | 'entityName' | 'quarterlyRevenue' | 'quarterlyNetIncome' | 'latestFiling'>, string[]> = {
    revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
    netIncome: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
    dilutedEps: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'],
    operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
    totalAssets: ['Assets'],
    totalLiabilities: ['Liabilities'],
    stockholdersEquity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    cashAndEquivalents: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
    longTermDebt: ['LongTermDebtNoncurrent', 'LongTermDebt', 'LongTermDebtAndCapitalLeaseObligations'],
    sharesOutstanding: ['CommonStockSharesOutstanding', 'EntityCommonStockSharesOutstanding'],
};

const DURATION_CONCEPTS = new Set(['revenue', 'netIncome', 'dilutedEps', 'operatingCashFlow']);

function toPoint(concept: string, label: string, unit: string, row: XbrlFactRow): FundamentalPoint {
    return {
        concept,
        label,
        unit,
        value: row.val,
        periodEnd: row.end,
        periodStart: row.start ?? null,
        fiscalYear: row.fy,
        fiscalPeriod: row.fp,
        form: row.form,
        filed: row.filed,
        frame: row.frame ?? null,
    };
}

function daysBetween(a: string, b: string): number {
    return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

/** A "quarterly" duration is roughly 80-100 days; annual is 350-380. */
function isQuarterDuration(row: XbrlFactRow): boolean {
    if (!row.start) return false;
    const days = daysBetween(row.start, row.end);
    return days >= 75 && days <= 105;
}

/**
 * Pick the alias with the most recent data point. Companies migrate between
 * concepts over time (e.g. `Revenues` -> `RevenueFromContractWithCustomer...`),
 * so the first alias that exists is often stale.
 */
function collectRows(payload: CompanyFactsPayload, aliases: string[]): { concept: string; label: string; unit: string; rows: XbrlFactRow[] } | null {
    let best: { concept: string; label: string; unit: string; rows: XbrlFactRow[]; latestEnd: string } | null = null;
    for (const taxonomy of ['us-gaap', 'ifrs-full', 'dei']) {
        const group = payload.facts?.[taxonomy];
        if (!group) continue;
        for (const concept of aliases) {
            const entry = group[concept];
            if (!entry) continue;
            const unit = Object.keys(entry.units)[0];
            const rows = entry.units[unit];
            if (!rows || rows.length === 0) continue;
            const latestEnd = rows.reduce((max, row) => (row.end > max ? row.end : max), '');
            if (!best || latestEnd > best.latestEnd) {
                best = { concept, label: entry.label ?? concept, unit, rows, latestEnd };
            }
        }
    }
    return best ? { concept: best.concept, label: best.label, unit: best.unit, rows: best.rows } : null;
}

function latestOf(rows: XbrlFactRow[], predicate: (row: XbrlFactRow) => boolean): XbrlFactRow | null {
    let best: XbrlFactRow | null = null;
    for (const row of rows) {
        if (!predicate(row)) continue;
        if (!best || row.end > best.end || (row.end === best.end && row.filed > best.filed)) {
            best = row;
        }
    }
    return best;
}

function isAnnualDuration(row: XbrlFactRow): boolean {
    if (!row.start) return false;
    const days = daysBetween(row.start, row.end);
    return days >= 350 && days <= 380;
}

/**
 * Quarterly series, newest first. 10-K filings only tag the full-year duration, so
 * the fourth quarter is derived as annual minus the three quarters inside that year.
 */
function quarterlySeries(concept: string, label: string, unit: string, rows: XbrlFactRow[], limit: number): FundamentalPoint[] {
    const byEnd = new Map<string, XbrlFactRow>();
    for (const row of rows) {
        if (!isQuarterDuration(row)) continue;
        const existing = byEnd.get(row.end);
        if (!existing || row.filed > existing.filed) {
            byEnd.set(row.end, row);
        }
    }

    const annuals = new Map<string, XbrlFactRow>();
    for (const row of rows) {
        if (!isAnnualDuration(row)) continue;
        const existing = annuals.get(row.end);
        if (!existing || row.filed > existing.filed) {
            annuals.set(row.end, row);
        }
    }

    for (const annual of annuals.values()) {
        if (byEnd.has(annual.end) || !annual.start) continue;
        const inside = [...byEnd.values()].filter((q) => q.start && q.start >= annual.start! && q.end <= annual.end);
        if (inside.length !== 3) continue;
        const lastQuarterEnd = inside.reduce((max, q) => (q.end > max ? q.end : max), '');
        byEnd.set(annual.end, {
            ...annual,
            start: lastQuarterEnd,
            val: annual.val - inside.reduce((sum, q) => sum + q.val, 0),
            fp: 'Q4',
            frame: undefined,
        });
    }

    return [...byEnd.values()]
        .sort((a, b) => (a.end < b.end ? 1 : -1))
        .slice(0, limit)
        .map((row) => toPoint(concept, label, unit, row));
}

export function buildFundamentalsSnapshot(symbol: string, payload: CompanyFactsPayload): FundamentalsSnapshot {
    const snapshot: FundamentalsSnapshot = {
        symbol,
        entityName: payload.entityName,
        revenue: null,
        netIncome: null,
        dilutedEps: null,
        operatingCashFlow: null,
        totalAssets: null,
        totalLiabilities: null,
        stockholdersEquity: null,
        cashAndEquivalents: null,
        longTermDebt: null,
        sharesOutstanding: null,
        quarterlyRevenue: [],
        quarterlyNetIncome: [],
        latestFiling: null,
    };

    for (const key of Object.keys(CONCEPT_ALIASES) as (keyof typeof CONCEPT_ALIASES)[]) {
        const found = collectRows(payload, CONCEPT_ALIASES[key]);
        if (!found) continue;
        const { concept, label, unit, rows } = found;
        const predicate = DURATION_CONCEPTS.has(key) ? isQuarterDuration : () => true;
        const latest = latestOf(rows, predicate);
        if (latest) {
            snapshot[key] = toPoint(concept, label, unit, latest);
        }
        if (key === 'revenue') snapshot.quarterlyRevenue = quarterlySeries(concept, label, unit, rows, 8);
        if (key === 'netIncome') snapshot.quarterlyNetIncome = quarterlySeries(concept, label, unit, rows, 8);
    }

    const candidates = [snapshot.revenue, snapshot.netIncome, snapshot.totalAssets].filter(
        (p): p is FundamentalPoint => Boolean(p),
    );
    if (candidates.length > 0) {
        const latest = candidates.reduce((a, b) => (a.filed >= b.filed ? a : b));
        const row = collectRows(payload, [latest.concept])?.rows.find((r) => r.filed === latest.filed && r.end === latest.periodEnd);
        snapshot.latestFiling = { form: latest.form, filed: latest.filed, accessionNumber: row?.accn ?? '' };
    }

    return snapshot;
}

/** Year-over-year growth of the newest point versus the point ending ~1 year earlier. */
export function yoyGrowth(series: FundamentalPoint[]): number | null {
    if (series.length < 2) return null;
    const current = series[0];
    const target = new Date(current.periodEnd);
    target.setUTCFullYear(target.getUTCFullYear() - 1);
    const yearAgo = series.find((p) => Math.abs(daysBetween(p.periodEnd, target.toISOString().slice(0, 10))) <= 20);
    if (!yearAgo || !yearAgo.value) return null;
    return (current.value - yearAgo.value) / Math.abs(yearAgo.value);
}
