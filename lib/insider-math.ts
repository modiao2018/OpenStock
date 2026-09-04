// Pure logic for insider (Form 3/4/5) transactions on the AI dips universe:
// filtering, aggregation and alert decisions. No I/O — unit-tested in
// __tests__/insider-math.test.ts.

// An open-market insider transaction after filtering. Sourced from Finnhub
// /stock/insider-transactions (SEC Form 3/4/5 data).
export interface InsiderTx {
    symbol: string;
    // Reporting insider's name as filed
    name: string;
    // Share delta: positive = bought, negative = sold
    change: number;
    // Average transaction price; 0 when the filing omits it
    transactionPrice: number;
    // 'P' = open-market purchase, 'S' = open-market sale
    transactionCode: 'P' | 'S';
    // YYYY-MM-DD
    transactionDate: string;
    // YYYY-MM-DD; filings lag the trade by up to 2 business days (T+2)
    filingDate: string;
}

export interface RawInsiderTx {
    name?: string;
    change?: number;
    transactionPrice?: number;
    transactionCode?: string;
    transactionDate?: string;
    filingDate?: string;
}

// Keeps only real open-market buys (P) and sells (S) — option exercises,
// grants, tax withholding etc. (A/M/F/G/…) are routine noise, not conviction.
// Records without a usable date or with a zero share delta are dropped;
// a missing transactionDate falls back to filingDate.
export function filterOpenMarketTxs(symbol: string, raw: RawInsiderTx[]): InsiderTx[] {
    const out: InsiderTx[] = [];
    for (const tx of raw) {
        if (tx.transactionCode !== 'P' && tx.transactionCode !== 'S') continue;
        if (!tx.change) continue;
        const transactionDate = tx.transactionDate || tx.filingDate || '';
        if (!transactionDate) continue;
        out.push({
            symbol,
            name: tx.name ?? '',
            change: tx.change,
            transactionPrice: tx.transactionPrice ?? 0,
            transactionCode: tx.transactionCode,
            transactionDate,
            filingDate: tx.filingDate || transactionDate,
        });
    }
    return out;
}

// Dollar value of a transaction; null when the filing omitted the price —
// callers must not treat unknown as zero (a large sell without a price would
// otherwise silently dodge the large-sell alert AND look like $0 on the page).
export function txAmountUsd(tx: InsiderTx): number | null {
    if (tx.transactionPrice <= 0) return null;
    return Math.abs(tx.change) * tx.transactionPrice;
}

// Stable dedup identity for a filed transaction. An amended filing changes
// filingDate and is treated as a new record — acceptable for alerting.
export function txExternalKey(tx: InsiderTx): string {
    return [
        tx.symbol,
        tx.name,
        tx.transactionDate,
        tx.transactionCode,
        tx.change,
        tx.transactionPrice,
        tx.filingDate,
    ].join('|');
}

export interface InsiderSummary {
    buyCount: number;
    sellCount: number;
    // Dollar totals exclude transactions with unknown price (they still count
    // toward buyCount/sellCount)
    buyUsd: number;
    sellUsd: number;
    netUsd: number;
    netShares: number;
    lastTxDate: string | null;
    unknownPriceCount: number;
}

// Aggregates transactions inside a trailing window ending at `today`
// (YYYY-MM-DD, passed in so the function stays pure and testable).
export function summarizeInsiderTxs(txs: InsiderTx[], today: string, windowDays = 90): InsiderSummary {
    const cutoff = shiftDate(today, -windowDays);
    const summary: InsiderSummary = {
        buyCount: 0, sellCount: 0, buyUsd: 0, sellUsd: 0,
        netUsd: 0, netShares: 0, lastTxDate: null, unknownPriceCount: 0,
    };
    for (const tx of txs) {
        if (tx.transactionDate < cutoff || tx.transactionDate > today) continue;
        const amount = txAmountUsd(tx);
        if (tx.transactionCode === 'P') {
            summary.buyCount++;
            if (amount !== null) summary.buyUsd += amount;
        } else {
            summary.sellCount++;
            if (amount !== null) summary.sellUsd += amount;
        }
        if (amount === null) summary.unknownPriceCount++;
        summary.netShares += tx.change;
        if (!summary.lastTxDate || tx.transactionDate > summary.lastTxDate) {
            summary.lastTxDate = tx.transactionDate;
        }
    }
    summary.netUsd = summary.buyUsd - summary.sellUsd;
    return summary;
}

// Brokers report one insider's single-day sale as a dozen price-bucket rows
// (ALAB 2026-09-01: 24 rows, $51M). Alert thresholds must see the day's total,
// so rows sharing symbol / insider / date / code / filingDate are folded into
// one transaction with summed shares and a share-weighted average price.
// Rows without a price keep their shares but contribute nothing to the VWAP.
export function aggregateSameDayTxs(txs: InsiderTx[]): InsiderTx[] {
    const groups = new Map<string, { tx: InsiderTx; pricedShares: number; value: number }>();
    for (const tx of txs) {
        const key = [tx.symbol, tx.name, tx.transactionDate, tx.transactionCode, tx.filingDate].join('|');
        const priced = tx.transactionPrice > 0 ? Math.abs(tx.change) : 0;
        const g = groups.get(key);
        if (!g) {
            groups.set(key, { tx: { ...tx }, pricedShares: priced, value: priced * tx.transactionPrice });
            continue;
        }
        g.tx.change += tx.change;
        g.pricedShares += priced;
        g.value += priced * tx.transactionPrice;
    }
    return [...groups.values()].map(({ tx, pricedShares, value }) => ({
        ...tx,
        transactionPrice: pricedShares > 0 ? value / pricedShares : 0,
    }));
}

export type NotifyReason = 'buy' | 'largeSell' | 'clusterSell';

export interface NotifyDecision {
    notify: boolean;
    reason: NotifyReason | null;
}

// Form 4 is due within 2 business days of the trade. A filing that arrives
// far later (TSM's SVP filed a July buy on Sept 4) is old news: the price has
// long since digested it, so it must not fire a "buy now" alert.
export const DEFAULT_MAX_FILING_LAG_DAYS = 10;

// Calendar days between the trade and its filing (negative for Form 144
// intents whose sale date lies in the future).
export function filingLagDays(tx: Pick<InsiderTx, 'transactionDate' | 'filingDate'>): number {
    return Math.round((Date.parse(`${tx.filingDate}T00:00:00Z`) - Date.parse(`${tx.transactionDate}T00:00:00Z`)) / 86_400_000);
}

export function isLateFiling(tx: Pick<InsiderTx, 'transactionDate' | 'filingDate'>, maxLagDays = DEFAULT_MAX_FILING_LAG_DAYS): boolean {
    return filingLagDays(tx) > maxLagDays;
}

export interface NotifyOpts {
    // A single sell above this dollar value alerts on its own; a cluster of
    // sellers also needs a combined value above it
    sellMinUsd: number;
    // Filings lagging the trade by more than this many days are stale and
    // never alert (defaults to DEFAULT_MAX_FILING_LAG_DAYS)
    maxFilingLagDays?: number;
    // Cluster window (days) and how many distinct sellers inside it count as
    // coordinated distribution
    clusterDays: number;
    clusterMinSellers: number;
}

// Buys always alert (unless filed late) — open-market insider purchases are
// rare, conviction signals. Sells only alert when large (routine 10b5-1 dribble stays quiet)
// or when several distinct insiders together unload more than the threshold
// inside the cluster window — headcount alone is noise: live 90-day data
// shows big caps routinely have 5+ insiders on selling plans every month.
// `recentSells` should contain the symbol's known S transactions around
// newTx.transactionDate, including newTx itself or not — it's deduped by name.
export function decideNotify(newTx: InsiderTx, recentSells: InsiderTx[], opts: NotifyOpts): NotifyDecision {
    // Late filings are history, not news — whichever direction
    if (isLateFiling(newTx, opts.maxFilingLagDays)) return { notify: false, reason: null };
    if (newTx.transactionCode === 'P') return { notify: true, reason: 'buy' };

    const amount = txAmountUsd(newTx);
    if (amount !== null && amount > opts.sellMinUsd) return { notify: true, reason: 'largeSell' };

    const windowStart = shiftDate(newTx.transactionDate, -opts.clusterDays);
    const sellers = new Set([newTx.name]);
    let clusterUsd = amount ?? 0;
    for (const tx of recentSells) {
        if (tx.transactionCode !== 'S') continue;
        if (tx.transactionDate < windowStart || tx.transactionDate > newTx.transactionDate) continue;
        if (txExternalKey(tx) === txExternalKey(newTx)) continue;
        sellers.add(tx.name);
        clusterUsd += txAmountUsd(tx) ?? 0;
    }
    if (sellers.size >= opts.clusterMinSellers && clusterUsd > opts.sellMinUsd) {
        return { notify: true, reason: 'clusterSell' };
    }

    return { notify: false, reason: null };
}

// "$2.1M" / "$530K" / "$980" — compact dollar formatting shared by the push
// body and the UI badge
export function formatUsdCompact(value: number): string {
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
    return `${sign}$${abs.toFixed(0)}`;
}

// CatalystKv markers: "this symbol's history has been seeded, from here on every
// new filing is news". Keyed per channel. Judging seededness by "does the symbol
// have any rows" is wrong for quiet names: a pool stock with no Form 4 inside
// the EDGAR channel's 5-day lookback (27 of 55 on 2026-09-04) had zero rows, so
// its first real filing would have been swallowed as a seed and never alerted.
export const insiderSeedKey = (symbol: string) => `insider_symbol_seeded:${symbol}`;
export const insiderEdgarSeedKey = (symbol: string) => `insider_edgar_seeded:${symbol}`;

// YYYY-MM-DD ± days, UTC arithmetic (calendar days are all we need here)
export function shiftDate(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
