'use server';

import { headers } from 'next/headers';
import { connectToDatabase } from '@/database/mongoose';
import { DashboardConfig } from '@/database/models/dashboard.model';
import { auth } from '@/lib/better-auth/auth';
import { fetchJSON } from '@/lib/actions/finnhub.actions';
import { resolveProfiles, type RawCompanyProfile } from '@/lib/company-profiles';
import {
    buildCatalog,
    cleanIndustry,
    DEFAULT_DASHBOARD_SYMBOLS,
    EMPTY_CATALOG_EDITS,
    sanitizeCatalogEdits,
    sanitizeDashboardSymbols,
    type DashboardCatalogEdits,
    type DashboardCustomStock,
} from '@/lib/dashboard-catalog';
import { MAX_HEATMAP_SYMBOLS, normalizeHeatmapSymbols } from '@/lib/heatmap-tile';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const NEXT_PUBLIC_FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';

export interface DashboardConfigData {
    symbols: string[];
    edits: DashboardCatalogEdits;
}

const DEFAULT_CONFIG: DashboardConfigData = { symbols: DEFAULT_DASHBOARD_SYMBOLS, edits: EMPTY_CATALOG_EDITS };

// Selection + catalog edits for a user; falls back to the default set. The
// selection is re-checked against the user's catalog so a symbol that was
// removed from the picker cannot linger on the heatmap.
export async function getDashboardConfig(userId: string): Promise<DashboardConfigData> {
    try {
        await connectToDatabase();
        const config = await DashboardConfig.findOne({ userId }).lean();
        if (!config) return DEFAULT_CONFIG;
        const edits = sanitizeCatalogEdits(config);
        const symbols = sanitizeDashboardSymbols(config.symbols, buildCatalog(edits));
        return { symbols: symbols.length > 0 ? symbols : DEFAULT_DASHBOARD_SYMBOLS, edits };
    } catch (error) {
        console.error('Error fetching dashboard config:', error);
        return DEFAULT_CONFIG;
    }
}

export async function saveDashboardConfig(input: DashboardConfigData): Promise<{ ok: boolean }> {
    try {
        const session = await auth.api.getSession({ headers: await headers() });
        const userId = session?.user?.id;
        if (!userId) return { ok: false };

        const edits = sanitizeCatalogEdits(input?.edits);
        const symbols = sanitizeDashboardSymbols(input?.symbols, buildCatalog(edits));
        if (symbols.length === 0 || symbols.length > MAX_HEATMAP_SYMBOLS) return { ok: false };

        await connectToDatabase();
        await DashboardConfig.findOneAndUpdate(
            { userId },
            { userId, symbols, added: edits.added, removed: edits.removed },
            { upsert: true },
        );
        return { ok: true };
    } catch (error) {
        console.error('Error saving dashboard config:', error);
        return { ok: false };
    }
}

export type LookupDashboardStockResult =
    | { ok: true; stock: DashboardCustomStock }
    | { ok: false; reason: 'invalid' | 'unknown' | 'unsupported' | 'error' };

// Resolves a symbol the user wants to add: its company profile gives the
// display name and the industry the heatmap will group it under. Profiles
// are persisted in Mongo (lib/company-profiles.ts), so a repeat lookup is
// free. A symbol Finnhub knows but has no profile / market cap for (ETFs,
// funds) would never render a tile, so it is refused here rather than
// silently missing from the heatmap.
export async function lookupDashboardStock(rawSymbol: string): Promise<LookupDashboardStockResult> {
    const [symbol] = normalizeHeatmapSymbols([rawSymbol ?? ''], []);
    if (!symbol) return { ok: false, reason: 'invalid' };
    const token = NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!token) return { ok: false, reason: 'error' };
    try {
        const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`;
        const profiles = await resolveProfiles([symbol], () => fetchJSON<RawCompanyProfile>(url, 86400));
        const profile = profiles.get(symbol);
        if (!profile) return { ok: false, reason: 'unknown' };
        if (!profile.name) return { ok: false, reason: 'unknown' };
        if (!(profile.marketCapitalization > 0)) return { ok: false, reason: 'unsupported' };
        return {
            ok: true,
            stock: { symbol, name: profile.name, industry: cleanIndustry(profile.finnhubIndustry) },
        };
    } catch (error) {
        console.error('Error looking up dashboard stock', symbol, error);
        return { ok: false, reason: 'error' };
    }
}
