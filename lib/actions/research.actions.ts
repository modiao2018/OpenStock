'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/better-auth/auth';
import { isAdminEmail } from '@/lib/admin';
import { fetchJSON, getQuote } from '@/lib/actions/finnhub.actions';
import { describeMarketForPrompt, normalizeMarket, type FinnhubMetricPayload } from '@/lib/ai-profile-math';
import { listThemes, reviseTheme, type ReviseOutcome } from '@/lib/research-themes';
import type { ResearchThemeData } from '@/lib/research-math';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';

export async function getResearchThemes(): Promise<ResearchThemeData[]> {
    return listThemes();
}

// Web-side facts: quote + basic financials per symbol, both through the
// Finnhub gate (metrics memoised for a day). No news here — a 22-symbol
// theme would need 66 calls in one burst; the daemon pass adds headlines.
async function marketFacts(symbols: string[]): Promise<Map<string, string[]>> {
    const token = process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';
    const out = new Map<string, string[]>();
    if (!token) return out;
    for (const symbol of symbols) {
        try {
            const [quote, metrics] = await Promise.all([
                getQuote(symbol),
                fetchJSON<FinnhubMetricPayload>(
                    `${FINNHUB_BASE_URL}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${token}`,
                    86400,
                ).catch(() => null),
            ]);
            const price = typeof quote?.c === 'number' && quote.c > 0 ? quote.c : null;
            const cap = typeof metrics?.metric?.marketCapitalization === 'number' ? (metrics.metric.marketCapitalization as number) : null;
            const market = normalizeMarket(metrics, { price, marketCapUsdM: cap });
            out.set(symbol, [`market: ${describeMarketForPrompt(market)}`]);
        } catch (e) {
            console.error('research market facts failed for', symbol, e);
        }
    }
    return out;
}

/** Admin-only: run the LLM revision pass now (the daemon also runs it weekly) */
export async function refreshResearchTheme(slug: string): Promise<ReviseOutcome> {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!isAdminEmail(session?.user?.email)) return { status: 'failed', reason: 'forbidden' };
    const out = await reviseTheme(slug, { facts: marketFacts }, 'admin');
    if (out.status === 'updated' || out.status === 'unchanged') revalidatePath('/research');
    return out;
}
