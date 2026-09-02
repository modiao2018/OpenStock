'use server';

import { connectToDatabase } from '@/database/mongoose';
import { InsiderInsight, InsiderTrade } from '@/database/models/insider.model';
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
