// Mongo-backed store for Finnhub company profiles (profile2).
//
// Every dashboard, watchlist and search render used to fan out one profile2
// call per symbol on a cold process, doubling the Finnhub budget a sweep needs.
// Profiles barely change, so they are persisted and refreshed at most once a
// day; when Finnhub is rate-limited a stale row is served rather than nothing.
//
// The upstream fetcher is injected so this module stays free of the
// 'use server' action files (and unit-testable without a network).

import { connectToDatabase } from '@/database/mongoose';
import { CompanyProfile, type ICompanyProfile } from '@/database/models/company-profile.model';

export const PROFILE_FRESH_MS = 24 * 60 * 60 * 1000;

/** Shape of Finnhub's profile2 response (fields the app reads) */
export interface RawCompanyProfile {
    name?: string;
    ticker?: string;
    currency?: string;
    exchange?: string;
    logo?: string;
    marketCapitalization?: number;
    finnhubIndustry?: string;
}

export interface StoredCompanyProfile extends RawCompanyProfile {
    symbol: string;
    name: string;
    ticker: string;
    currency: string;
    exchange: string;
    logo: string;
    marketCapitalization: number;
    finnhubIndustry: string;
    fetchedAt: Date;
}

export type ProfileFetcher = (symbol: string) => Promise<RawCompanyProfile | null>;

export function isProfileFresh(profile: Pick<StoredCompanyProfile, 'fetchedAt'>, now = Date.now()): boolean {
    return now - profile.fetchedAt.getTime() < PROFILE_FRESH_MS;
}

function fromDoc(doc: Pick<ICompanyProfile, keyof StoredCompanyProfile>): StoredCompanyProfile {
    return {
        symbol: doc.symbol,
        name: doc.name ?? '',
        ticker: doc.ticker ?? '',
        currency: doc.currency ?? '',
        exchange: doc.exchange ?? '',
        logo: doc.logo ?? '',
        marketCapitalization: doc.marketCapitalization ?? 0,
        finnhubIndustry: doc.finnhubIndustry ?? '',
        fetchedAt: doc.fetchedAt,
    };
}

function fromRaw(symbol: string, raw: RawCompanyProfile, fetchedAt: Date): StoredCompanyProfile {
    return {
        symbol,
        name: raw.name ?? '',
        ticker: raw.ticker ?? '',
        currency: raw.currency ?? '',
        exchange: raw.exchange ?? '',
        logo: raw.logo ?? '',
        marketCapitalization: raw.marketCapitalization ?? 0,
        finnhubIndustry: raw.finnhubIndustry ?? '',
        fetchedAt,
    };
}

/** One query for every requested symbol; any age. Never throws (Mongo down → empty map). */
export async function readStoredProfiles(symbols: string[]): Promise<Map<string, StoredCompanyProfile>> {
    const out = new Map<string, StoredCompanyProfile>();
    if (symbols.length === 0) return out;
    try {
        await connectToDatabase();
        const docs = await CompanyProfile.find({ symbol: { $in: symbols } }).lean();
        for (const doc of docs) out.set(doc.symbol, fromDoc(doc));
    } catch (e) {
        console.error('readStoredProfiles failed', e);
    }
    return out;
}

// Fire-and-forget safe: never throws
async function saveProfile(profile: StoredCompanyProfile): Promise<void> {
    try {
        await connectToDatabase();
        const { symbol, ...fields } = profile;
        await CompanyProfile.updateOne({ symbol }, { $set: fields }, { upsert: true });
    } catch (e) {
        console.error('saveProfile failed for', profile.symbol, e);
    }
}

/**
 * Profiles for `symbols`, in priority order:
 *   1. a stored row younger than a day (no upstream call);
 *   2. a fresh upstream fetch, persisted for next time;
 *   3. the stale stored row when the fetch fails (rate limit, outage);
 *   4. absent when there is nothing at all.
 * Pass `stored` when the caller already read the rows (e.g. to budget calls).
 */
export async function resolveProfiles(
    symbols: string[],
    fetchOne: ProfileFetcher,
    stored?: Map<string, StoredCompanyProfile>,
): Promise<Map<string, StoredCompanyProfile>> {
    const known = stored ?? (await readStoredProfiles(symbols));
    const out = new Map<string, StoredCompanyProfile>();
    await Promise.all(
        symbols.map(async (symbol) => {
            const existing = known.get(symbol);
            if (existing && isProfileFresh(existing)) {
                out.set(symbol, existing);
                return;
            }
            try {
                const raw = await fetchOne(symbol);
                if (raw) {
                    const fresh = fromRaw(symbol, raw, new Date());
                    out.set(symbol, fresh);
                    void saveProfile(fresh);
                    return;
                }
            } catch (e) {
                console.error('Profile fetch failed for', symbol, e);
            }
            if (existing) out.set(symbol, existing);
        }),
    );
    return out;
}
