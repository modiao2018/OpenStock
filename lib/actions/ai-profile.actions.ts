'use server';

import { getLocale } from 'next-intl/server';
import { getSession } from '@/lib/get-session';
import { fetchJSON, getQuote } from '@/lib/actions/finnhub.actions';
import { readStoredProfiles } from '@/lib/company-profiles';
import { marketCapToUsdMillions } from '@/lib/market-cap';
import { readProfiles, refreshProfile, type ProfileSources, type RefreshOutcome } from '@/lib/ai-profiles';
import type { AiProfileData } from '@/lib/ai-profile-math';
import type { FinnhubMetricPayload } from '@/lib/ai-profile-math';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';

function metricUrl(symbol: string): string {
    const token = process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';
    return `${FINNHUB_BASE_URL}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${token}`;
}

const sources: ProfileSources = {
    // Basic financials move slowly; a day-long memo keeps repeat refreshes free
    fetchMetrics: async (symbol) => {
        if (!process.env.NEXT_PUBLIC_FINNHUB_API_KEY) return null;
        const data = await fetchJSON<FinnhubMetricPayload>(metricUrl(symbol), 86400);
        return data && typeof data === 'object' && data.metric ? data : null;
    },
    fetchQuoteAndCap: async (symbol) => {
        const [quote, profiles] = await Promise.all([getQuote(symbol), readStoredProfiles([symbol])]);
        const profile = profiles.get(symbol);
        const marketCapUsdM = profile?.marketCapitalization
            ? await marketCapToUsdMillions(profile.marketCapitalization, profile.currency)
            : null;
        return {
            price: typeof quote?.c === 'number' && quote.c > 0 ? quote.c : null,
            marketCapUsdM,
        };
    },
    fetchIdentity: async (symbol) => {
        const profile = (await readStoredProfiles([symbol])).get(symbol);
        return { name: profile?.name ?? '', industry: profile?.finnhubIndustry ?? '' };
    },
};

/** Stored cards only — never touches Finnhub or the LLM, safe for SSR */
export async function getAiProfiles(symbols: string[]): Promise<AiProfileData[]> {
    const locale = await getLocale();
    const map = await readProfiles(symbols, locale);
    return symbols.flatMap((s) => {
        const p = map.get(s.toUpperCase());
        return p ? [p] : [];
    });
}

/**
 * Refresh one card for the current UI language. Requires a signed-in user
 * since it spends LLM and Finnhub budget.
 */
export async function refreshAiProfile(symbol: string, opts: { force?: boolean } = {}): Promise<RefreshOutcome> {
    const session = await getSession();
    if (!session) return { status: 'failed', profile: null };
    const ticker = symbol.trim().toUpperCase();
    if (!ticker) return { status: 'failed', profile: null };
    const locale = await getLocale();
    return refreshProfile(ticker, locale, sources, { force: opts.force === true });
}
