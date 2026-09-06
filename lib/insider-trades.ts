// Single write path for the insider trades table. Three producers feed it —
// the EDGAR live channel (Form 4 XML, same day), the Finnhub poller (T+2 to
// never: Finnhub dropped 29 of 92 Form 4s in the 2026-09-01..05 window, which
// is why /ai-dips showed RXRX's August sale while EDGAR had the September one)
// and the web-side seeding when a symbol joins the pool. Whoever arrives first
// wins; the other source's copy of the same trade collides on matchKey and is
// dropped. Plain mongoose module: no 'use server', no next/react imports.

import { createHash } from 'node:crypto';
import { connectToDatabase } from '@/database/mongoose';
import { InsiderTrade, type InsiderTradeSource } from '@/database/models/insider.model';
import { txAmountUsd, txExternalKey, txMatchKey, type InsiderTx } from '@/lib/insider-math';

// Must hash exactly like catalyst-monitor/src/store.ts sha256 (JSON.stringify
// first) — the Finnhub poller and the web seeding used to compute externalId
// independently and any drift makes the same filing look new
const sha256 = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');

export interface InsertTradeOpts {
    source: InsiderTradeSource;
    /** Seed rows: stored for the page, never alerted */
    firstSeen: boolean;
    accessionNumber?: string | null;
}

export interface InsertedTrade {
    id: string;
    tx: InsiderTx;
}

export interface InsertTradesResult {
    /** Rows that were genuinely new (callers alert on these) */
    inserted: InsertedTrade[];
    /** Same trade already stored, from this or the other source */
    duplicates: number;
}

export async function insertInsiderTrades(txs: InsiderTx[], opts: InsertTradeOpts): Promise<InsertTradesResult> {
    await connectToDatabase();
    const out: InsertTradesResult = { inserted: [], duplicates: 0 };
    for (const tx of txs) {
        try {
            const doc = await InsiderTrade.create({
                symbol: tx.symbol,
                externalId: sha256(txExternalKey(tx)),
                matchKey: txMatchKey(tx),
                source: opts.source,
                accessionNumber: opts.accessionNumber ?? null,
                name: tx.name,
                transactionCode: tx.transactionCode,
                change: tx.change,
                transactionPrice: tx.transactionPrice,
                amountUsd: txAmountUsd(tx),
                transactionDate: tx.transactionDate,
                filingDate: tx.filingDate,
                firstSeen: opts.firstSeen,
            });
            out.inserted.push({ id: String(doc._id), tx });
        } catch (err: unknown) {
            if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) {
                out.duplicates++;
                continue;
            }
            throw err;
        }
    }
    return out;
}

/**
 * Rows written before matchKey existed get one computed in place, so the
 * unique index starts protecting them against the other source's copy.
 * Cheap when nothing is left to do; the insider collector calls it every round.
 */
export async function backfillInsiderMatchKeys(): Promise<number> {
    await connectToDatabase();
    const docs = await InsiderTrade.find({ matchKey: { $exists: false } }).limit(2000);
    let done = 0;
    for (const d of docs) {
        const key = txMatchKey({ symbol: d.symbol, name: d.name, transactionDate: d.transactionDate, transactionCode: d.transactionCode, change: d.change });
        try {
            await InsiderTrade.updateOne({ _id: d._id }, { $set: { matchKey: key, source: d.source ?? 'finnhub' } });
            done++;
        } catch (err: unknown) {
            // Two legacy rows for the same trade (Finnhub re-filed with a different price): keep one
            if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) {
                await InsiderTrade.deleteOne({ _id: d._id });
                done++;
                continue;
            }
            throw err;
        }
    }
    return done;
}
