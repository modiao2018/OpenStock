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

export type NotifyReason = 'buy' | 'largeSell' | 'clusterSell';

export interface NotifyDecision {
    notify: boolean;
    reason: NotifyReason | null;
}

export interface NotifyOpts {
    // A single sell above this dollar value alerts on its own; a cluster of
    // sellers also needs a combined value above it
    sellMinUsd: number;
    // Cluster window (days) and how many distinct sellers inside it count as
    // coordinated distribution
    clusterDays: number;
    clusterMinSellers: number;
}

// Buys always alert — open-market insider purchases are rare, conviction
// signals. Sells only alert when large (routine 10b5-1 dribble stays quiet)
// or when several distinct insiders together unload more than the threshold
// inside the cluster window — headcount alone is noise: live 90-day data
// shows big caps routinely have 5+ insiders on selling plans every month.
// `recentSells` should contain the symbol's known S transactions around
// newTx.transactionDate, including newTx itself or not — it's deduped by name.
export function decideNotify(newTx: InsiderTx, recentSells: InsiderTx[], opts: NotifyOpts): NotifyDecision {
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

// YYYY-MM-DD ± days, UTC arithmetic (calendar days are all we need here)
export function shiftDate(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
