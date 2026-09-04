// Immediate insider seeding for symbols freshly added to the pool — fired in
// the background from addAiDipStocks so new entrants don't wait up to 90 min
// for the daemon's next round. Inserts are marked firstSeen (never notified);
// the daemon later sees the rows via the unique index and treats the symbol
// as already seeded, so nothing double-alerts.

import { createHash } from 'node:crypto';
import { connectToDatabase } from '@/database/mongoose';
import { InsiderTrade } from '@/database/models/insider.model';
import { CatalystKv } from '@/database/models/catalyst.model';
import { timed } from '@/lib/source-calls';
import { finnhubGate, retryAfterMs } from '@/lib/finnhub-gate';
import {
    filterOpenMarketTxs,
    insiderSeedKey,
    shiftDate,
    txAmountUsd,
    txExternalKey,
    type RawInsiderTx,
} from '@/lib/insider-math';

const WINDOW_DAYS = 90;
const FINNHUB_URL = 'https://finnhub.io/api/v1/stock/insider-transactions';

// 必须与 catalyst-monitor/src/store.ts 的 sha256 完全一致（JSON.stringify 后再
// hash）——externalId 不同会让 daemon 把同一笔申报当成新交易误推送
const sha256 = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');

// KV marker so the UI can tell "seeded, genuinely no trades" (ETFs etc.)
// apart from "collector hasn't visited yet"; the daemon honours the same key
export const seedMarkerKey = insiderSeedKey;

export async function seedInsiderForSymbols(symbols: string[]): Promise<void> {
    const key = process.env.NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!key || symbols.length === 0) return;
    try {
        await connectToDatabase();
        const today = new Date().toISOString().slice(0, 10);
        const from = shiftDate(today, -WINDOW_DAYS);
        for (const symbol of symbols) {
            try {
                const url = `${FINNHUB_URL}?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${today}&token=${key}`;
                await finnhubGate.acquire();
                const data = await timed('finnhub', async () => {
                    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
                    if (res.status === 429) finnhubGate.reportRateLimited(retryAfterMs(res.headers.get('retry-after')));
                    if (!res.ok) throw new Error(`Finnhub insider HTTP ${res.status}`);
                    return (await res.json()) as { data?: RawInsiderTx[] };
                });
                const txs = filterOpenMarketTxs(symbol, data.data ?? []);
                for (const tx of txs) {
                    try {
                        await InsiderTrade.create({
                            symbol: tx.symbol,
                            externalId: sha256(txExternalKey(tx)),
                            name: tx.name,
                            transactionCode: tx.transactionCode,
                            change: tx.change,
                            transactionPrice: tx.transactionPrice,
                            amountUsd: txAmountUsd(tx),
                            transactionDate: tx.transactionDate,
                            filingDate: tx.filingDate,
                            firstSeen: true,
                        });
                    } catch (err: unknown) {
                        if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) continue;
                        throw err;
                    }
                }
                await CatalystKv.findOneAndUpdate(
                    { key: seedMarkerKey(symbol) },
                    { $set: { value: today } },
                    { upsert: true },
                );
                console.log(`[insider-seed] ${symbol} 建档 ${txs.length} 笔`);
            } catch (e) {
                console.error(`[insider-seed] ${symbol} 失败`, e);
            }
            // 与网页端报价轮询共享 Finnhub 免费档 60 req/min，留足间隔
            await new Promise((r) => setTimeout(r, 1100));
        }
    } catch (e) {
        console.error('[insider-seed] error', e);
    }
}
