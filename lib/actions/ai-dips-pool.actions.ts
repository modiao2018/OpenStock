'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { connectToDatabase } from '@/database/mongoose';
import { AiDipPoolStock } from '@/database/models/ai-dip-pool.model';
import { auth } from '@/lib/better-auth/auth';
import { AI_SUB_SECTORS, type AiDipMeta, type AiSubSector } from '@/lib/ai-dips-catalog';
import { AI_DIP_POOL_MAX, getAiDipPool } from '@/lib/ai-dips-pool';
import { seedInsiderForSymbols } from '@/lib/insider-seed';

export interface AiDipPoolAddItem {
    symbol: string;
    name: string;
    subSector?: AiSubSector;
}

async function requireUserId(): Promise<string | null> {
    const session = await auth.api.getSession({ headers: await headers() });
    return session?.user?.id ?? null;
}

export async function getAiDipPoolItems(): Promise<AiDipMeta[]> {
    try {
        return await getAiDipPool();
    } catch (e) {
        console.error('AI dip pool fetch failed', e);
        return [];
    }
}

// Batch upsert (manual add = 1 item, watchlist import = many); rejects when
// the pool would exceed the Finnhub rate budget cap.
export async function addAiDipStocks(
    items: AiDipPoolAddItem[],
): Promise<{ ok: boolean; added: number; capped?: boolean }> {
    try {
        if (!(await requireUserId())) return { ok: false, added: 0 };

        const clean = items
            .map((i) => ({
                symbol: i.symbol.trim().toUpperCase(),
                name: i.name.trim() || i.symbol.trim().toUpperCase(),
                subSector: AI_SUB_SECTORS.includes(i.subSector as AiSubSector) ? (i.subSector as AiSubSector) : 'custom',
            }))
            .filter((i) => /^[A-Z0-9.\-]{1,12}$/.test(i.symbol));
        if (clean.length === 0) return { ok: false, added: 0 };

        await connectToDatabase();
        const existing = new Set(await AiDipPoolStock.distinct('symbol'));
        const fresh = clean.filter((i) => !existing.has(i.symbol));
        if (existing.size + fresh.length > AI_DIP_POOL_MAX) {
            return { ok: false, added: 0, capped: true };
        }
        for (const item of clean) {
            await AiDipPoolStock.findOneAndUpdate(
                { symbol: item.symbol },
                { $set: { name: item.name, subSector: item.subSector } },
                { upsert: true },
            );
        }
        // 新标的立即后台建档内部人数据，不等 daemon 的下一轮（fire-and-forget，
        // 与 writeSnapshot 同一模式——web 是常驻容器，响应返回后任务仍会跑完）
        if (fresh.length > 0) void seedInsiderForSymbols(fresh.map((i) => i.symbol));
        revalidatePath('/ai-dips');
        return { ok: true, added: fresh.length };
    } catch (e) {
        console.error('AI dip pool add failed', e);
        return { ok: false, added: 0 };
    }
}

export async function removeAiDipStock(symbol: string): Promise<{ ok: boolean }> {
    try {
        if (!(await requireUserId())) return { ok: false };
        await connectToDatabase();
        await AiDipPoolStock.deleteOne({ symbol: symbol.trim().toUpperCase() });
        revalidatePath('/ai-dips');
        return { ok: true };
    } catch (e) {
        console.error('AI dip pool remove failed', e);
        return { ok: false };
    }
}
