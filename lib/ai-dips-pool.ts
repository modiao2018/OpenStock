// DB-backed AI dips universe, shared by the web app and the monitor daemon
// (plain mongoose module — no 'use server', no next/react imports).
// The hardcoded catalog seeds the collection on first read; after that the
// database is authoritative and the manage dialog on /ai-dips edits it.

import { connectToDatabase } from '@/database/mongoose';
import { AiDipPoolStock } from '@/database/models/ai-dip-pool.model';
import { AI_DIP_CATALOG, AI_SUB_SECTORS, type AiDipMeta, type AiSubSector } from '@/lib/ai-dips-catalog';

export { AI_DIP_POOL_MAX, type AiDipMeta } from '@/lib/ai-dips-catalog';

const sectorOrder = new Map(AI_SUB_SECTORS.map((s, i) => [s, i]));

function isKnownSector(v: string): v is AiSubSector {
    return sectorOrder.has(v as AiSubSector);
}

// Seeds from the static catalog when the collection is empty, then returns
// the pool sorted by sub-sector (catalog order) and symbol.
export async function getAiDipPool(): Promise<AiDipMeta[]> {
    await connectToDatabase();
    let docs = await AiDipPoolStock.find().lean();
    if (docs.length === 0) {
        await AiDipPoolStock.insertMany(
            AI_DIP_CATALOG.map((s) => ({ symbol: s.symbol, name: s.name, subSector: s.subSector })),
            { ordered: false },
        ).catch(() => { /* 并发播种时的唯一索引冲突可忽略 */ });
        docs = await AiDipPoolStock.find().lean();
    }
    return docs
        .map((d) => ({
            symbol: d.symbol,
            name: d.name,
            subSector: isKnownSector(d.subSector) ? d.subSector : 'custom',
        }))
        .sort((a, b) => {
            const so = (sectorOrder.get(a.subSector) ?? 99) - (sectorOrder.get(b.subSector) ?? 99);
            return so !== 0 ? so : a.symbol.localeCompare(b.symbol);
        });
}
