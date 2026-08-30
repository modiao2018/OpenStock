'use server';

import { headers } from 'next/headers';
import { connectToDatabase } from '@/database/mongoose';
import { DashboardConfig } from '@/database/models/dashboard.model';
import { auth } from '@/lib/better-auth/auth';
import { DEFAULT_DASHBOARD_SYMBOLS, sanitizeDashboardSymbols } from '@/lib/dashboard-catalog';

// Selected dashboard symbols for a user; falls back to the default set
export async function getDashboardSymbols(userId: string): Promise<string[]> {
    try {
        await connectToDatabase();
        const config = await DashboardConfig.findOne({ userId }).lean();
        if (!config) return DEFAULT_DASHBOARD_SYMBOLS;
        const symbols = sanitizeDashboardSymbols(config.symbols);
        return symbols.length > 0 ? symbols : DEFAULT_DASHBOARD_SYMBOLS;
    } catch (error) {
        console.error('Error fetching dashboard config:', error);
        return DEFAULT_DASHBOARD_SYMBOLS;
    }
}

export async function saveDashboardSymbols(symbols: string[]): Promise<{ ok: boolean }> {
    try {
        const session = await auth.api.getSession({ headers: await headers() });
        const userId = session?.user?.id;
        if (!userId) return { ok: false };

        const sanitized = sanitizeDashboardSymbols(symbols);
        if (sanitized.length === 0) return { ok: false };

        await connectToDatabase();
        await DashboardConfig.findOneAndUpdate(
            { userId },
            { userId, symbols: sanitized },
            { upsert: true },
        );
        return { ok: true };
    } catch (error) {
        console.error('Error saving dashboard config:', error);
        return { ok: false };
    }
}
