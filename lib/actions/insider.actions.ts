'use server';

import { connectToDatabase } from '@/database/mongoose';
import { InsiderInsight, InsiderTrade } from '@/database/models/insider.model';
import { CatalystKv } from '@/database/models/catalyst.model';
import { AiDipPoolStock } from '@/database/models/ai-dip-pool.model';
import { getAiDipPool } from '@/lib/ai-dips-pool';
import { shiftDate, summarizeInsiderTxs, type InsiderSummary } from '@/lib/insider-math';

const WINDOW_DAYS = 90;
// Per-symbol detail rows shown in the expanded panel
const MAX_TRADES = 20;

export interface InsiderTradeRow {
    name: string;
    transactionCode: 'P' | 'S';
    change: number;
    transactionPrice: number;
    amountUsd: number | null;
    transactionDate: string;
    filingDate: string;
}

export interface InsiderRowData {
    summary: InsiderSummary;
    // Newest first
    trades: InsiderTradeRow[];
    insight: { analysis: string; action: string | null; updatedAt: number } | null;
}

// Data-source health for the /ai-dips status banner, from the daemon's
// per-collector heartbeat keys in CatalystKv (written by runCollector)
export interface AiDipsHealth {
    // Epoch ms of the collectors' last completed round; null = never ran
    insiderLastRun: number | null;
    aidipsLastRun: number | null;
    insiderErrorCount: number;
    aidipsErrorCount: number;
    insiderLastError: string | null;
    // symbol -> epoch ms it entered the pool; lets the UI tell "awaiting
    // first collection" apart from "genuinely no insider activity"
    poolAddedAt: Record<string, number>;
    // Symbols already seeded by the immediate web-side fetch (even when it
    // found zero trades — ETFs etc.), so the UI can drop the pending badge
    seededSymbols: string[];
}

async function readHeartbeat(name: string): Promise<{ lastRun: number | null; errorCount: number; lastError: string | null }> {
    const keys = [`collector_last_run:${name}`, `collector_error_count:${name}`, `collector_last_error:${name}`];
    const docs = await CatalystKv.find({ key: { $in: keys } }).lean();
    const byKey = new Map(docs.map((d) => [d.key, d.value]));
    const lastRunRaw = byKey.get(keys[0]);
    const lastRun = lastRunRaw ? new Date(lastRunRaw).getTime() : null;
    let lastError: string | null = null;
    const errRaw = byKey.get(keys[2]);
    if (errRaw) {
        try {
            lastError = (JSON.parse(errRaw) as { message?: string }).message ?? null;
        } catch {
            lastError = errRaw;
        }
    }
    return {
        lastRun: lastRun && !Number.isNaN(lastRun) ? lastRun : null,
        errorCount: Number(byKey.get(keys[1]) ?? '0') || 0,
        lastError,
    };
}

export async function getAiDipsHealth(): Promise<AiDipsHealth> {
    try {
        await connectToDatabase();
        const [insider, aidips, poolDocs, seedMarkers] = await Promise.all([
            readHeartbeat('insider'),
            readHeartbeat('aidips'),
            AiDipPoolStock.find({}, { symbol: 1, addedAt: 1 }).lean(),
            CatalystKv.find({ key: { $regex: '^insider_symbol_seeded:' } }, { key: 1 }).lean(),
        ]);
        const poolAddedAt: Record<string, number> = {};
        for (const d of poolDocs) poolAddedAt[d.symbol] = d.addedAt ? new Date(d.addedAt).getTime() : 0;
        return {
            insiderLastRun: insider.lastRun,
            aidipsLastRun: aidips.lastRun,
            insiderErrorCount: insider.errorCount,
            aidipsErrorCount: aidips.errorCount,
            insiderLastError: insider.lastError,
            poolAddedAt,
            seededSymbols: seedMarkers.map((d) => d.key.slice('insider_symbol_seeded:'.length)),
        };
    } catch (e) {
        console.error('AI dips health fetch failed', e);
        return {
            insiderLastRun: null, aidipsLastRun: null,
            insiderErrorCount: 0, aidipsErrorCount: 0,
            insiderLastError: null, poolAddedAt: {}, seededSymbols: [],
        };
    }
}

// 90-day insider activity for the AI dips universe, written by the monitor's
// insider collector. Small data (42 symbols × open-market trades only), so one
// query + in-memory grouping beats an aggregation pipeline.
export async function getInsiderOverview(): Promise<Record<string, InsiderRowData>> {
    try {
        await connectToDatabase();
        const poolSymbols = (await getAiDipPool()).map((s) => s.symbol);
        const today = new Date().toISOString().slice(0, 10);
        const from = shiftDate(today, -WINDOW_DAYS);
        const [trades, insights] = await Promise.all([
            InsiderTrade.find({ symbol: { $in: poolSymbols }, transactionDate: { $gte: from } })
                .sort({ transactionDate: -1 })
                .lean(),
            InsiderInsight.find({ symbol: { $in: poolSymbols } }).lean(),
        ]);

        const bySymbol = new Map<string, InsiderTradeRow[]>();
        for (const d of trades) {
            const list = bySymbol.get(d.symbol) ?? [];
            list.push({
                name: d.name,
                transactionCode: d.transactionCode,
                change: d.change,
                transactionPrice: d.transactionPrice,
                amountUsd: d.amountUsd ?? null,
                transactionDate: d.transactionDate,
                filingDate: d.filingDate,
            });
            bySymbol.set(d.symbol, list);
        }

        const insightBySymbol = new Map(
            insights.map((d) => [
                d.symbol,
                {
                    analysis: d.analysis,
                    action: d.action ?? null,
                    updatedAt: new Date(d.updatedAt).getTime(),
                },
            ]),
        );

        const out: Record<string, InsiderRowData> = {};
        for (const [symbol, rows] of bySymbol) {
            out[symbol] = {
                summary: summarizeInsiderTxs(
                    rows.map((r) => ({ ...r, symbol })),
                    today,
                    WINDOW_DAYS,
                ),
                trades: rows.slice(0, MAX_TRADES),
                insight: insightBySymbol.get(symbol) ?? null,
            };
        }
        // Symbols with an insight but no trades inside the window still expose it
        for (const [symbol, insight] of insightBySymbol) {
            if (!out[symbol]) {
                out[symbol] = {
                    summary: summarizeInsiderTxs([], today, WINDOW_DAYS),
                    trades: [],
                    insight,
                };
            }
        }
        return out;
    } catch (e) {
        console.error('Insider overview fetch failed', e);
        return {};
    }
}
