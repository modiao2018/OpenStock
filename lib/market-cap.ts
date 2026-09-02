// Finnhub's profile2 reports marketCapitalization in the currency of the
// *primary listing* — e.g. querying the TSM ADR returns the 2330.TW profile
// with a TWD market cap, ~30x the USD figure. Normalize to USD before using
// the value for sizing or display.

import { timed } from '@/lib/source-calls';

type UsdRatesResponse = {
    result?: string;
    rates?: Record<string, number>;
};

// Free, keyless, daily-updated USD base rates; cached for 24h via Next's data cache
const RATES_URL = 'https://open.er-api.com/v6/latest/USD';

export async function marketCapToUsdMillions(
    marketCapMillions: number,
    currency?: string,
): Promise<number> {
    const cur = (currency || 'USD').trim().toUpperCase();
    if (!marketCapMillions || cur === 'USD') return marketCapMillions;

    try {
        const data = await timed('er-api', async () => {
            const res = await fetch(RATES_URL, {
                cache: 'force-cache',
                next: { revalidate: 86400 },
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) throw new Error(`FX rates HTTP ${res.status}`);
            return (await res.json()) as UsdRatesResponse;
        });
        const rate = data?.rates?.[cur];
        if (typeof rate === 'number' && rate > 0) {
            return marketCapMillions / rate;
        }
    } catch (e) {
        console.error('FX rates fetch failed, using raw market cap for', cur, e);
    }
    // Unknown currency or rates unavailable — better a mis-scaled tile than none
    return marketCapMillions;
}
