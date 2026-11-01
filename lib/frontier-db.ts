import { connectToDatabase } from '@/database/mongoose';
import { FrontierConference, FrontierMilestone, FrontierTheme } from '@/database/models/frontier.model';
import { SEED_CONFERENCES, SEED_MILESTONES, SEED_THEMES } from '@/lib/frontier-seed';
import type { ThemeDef } from '@/lib/frontier-math';

/**
 * 生物科技前沿的种子写入与主题读取。daemon 与网页端共用（不依赖 Next）。
 * 种子按集合整体判空：任一集合已有数据就不再写，用户删掉的条目不会被"复活"。
 */
export async function ensureFrontierSeed(): Promise<void> {
    await connectToDatabase();
    if ((await FrontierTheme.estimatedDocumentCount()) === 0) {
        await FrontierTheme.insertMany(
            SEED_THEMES.map((t, i) => ({
                ...t,
                trialQuery: t.trialQuery ?? null,
                tickers: t.tickers.map((x) => ({ ...x, aliases: x.aliases ?? [] })),
                order: i,
                enabled: true,
            })),
            { ordered: false },
        ).catch(() => undefined);
    }
    if ((await FrontierMilestone.estimatedDocumentCount()) === 0) {
        await FrontierMilestone.insertMany(
            SEED_MILESTONES.map((m) => ({ ...m, status: 'active', source: 'seed', history: [], proposals: [] })),
            { ordered: false },
        ).catch(() => undefined);
    }
    if ((await FrontierConference.estimatedDocumentCount()) === 0) {
        await FrontierConference.insertMany(
            SEED_CONFERENCES.map((c) => ({ ...c, verified: false })),
            { ordered: false },
        ).catch(() => undefined);
    }
}

export interface LoadedTheme extends ThemeDef {
    name: string;
    trialQuery: { field: 'query.intr' | 'query.cond'; term: string } | null;
}

export async function loadThemes(): Promise<LoadedTheme[]> {
    await connectToDatabase();
    const docs = await FrontierTheme.find({ enabled: true }).sort({ order: 1, key: 1 }).lean();
    return docs.map((d) => ({
        key: d.key,
        name: d.name,
        keywords: d.keywords ?? [],
        tickers: (d.tickers ?? []).map((t) => ({ symbol: t.symbol, company: t.company, tier: t.tier, aliases: t.aliases ?? [] })),
        trialQuery: d.trialQuery?.term ? d.trialQuery : null,
    }));
}

/** 全部主题标的（去重），篮子与 ticker 校验用 */
export function universeOf(themes: ThemeDef[]): Map<string, { company: string; themes: string[] }> {
    const out = new Map<string, { company: string; themes: string[] }>();
    for (const theme of themes) {
        for (const t of theme.tickers) {
            const cur = out.get(t.symbol);
            if (cur) cur.themes.push(theme.key);
            else out.set(t.symbol, { company: t.company, themes: [theme.key] });
        }
    }
    return out;
}
