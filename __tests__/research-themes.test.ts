import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the ResearchTheme collection
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = vi.hoisted(() => new Map<string, Record<string, any>>());

vi.mock('@/database/mongoose', () => ({ connectToDatabase: async () => undefined }));
vi.mock('@/database/models/research-theme.model', () => ({
    ResearchTheme: {
        find: () => ({ lean: async () => [...rows.values()] }),
        findOne: (q: { slug: string }) => ({ lean: async () => rows.get(q.slug) ?? null }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        insertMany: async (docs: Record<string, any>[]) => {
            for (const d of docs) rows.set(d.slug, structuredClone(d));
        },
        updateOne: async ({ slug }: { slug: string }, { $set }: { $set: Record<string, unknown> }) => {
            rows.set(slug, { ...(rows.get(slug) ?? {}), ...structuredClone($set) });
        },
    },
}));

const resolveLlmConfigMock = vi.fn();
vi.mock('@/lib/llm-config', () => ({ resolveLlmConfig: (...a: unknown[]) => resolveLlmConfigMock(...a) }));
const callAIMock = vi.fn();
vi.mock('@/lib/ai-provider', () => ({ callAIProviderWithConfig: (...a: unknown[]) => callAIMock(...a) }));

import { getTheme, listThemes, reviseTheme } from '@/lib/research-themes';
import { RESEARCH_SEEDS } from '@/lib/research-seed';

const CFG = { provider: 'gemini', apiKey: 'k', baseUrl: 'b', model: 'm' };
const facts = async () => new Map([['ALNY', ['market: price 300', 'news 2026-09-18: Q3 revenue +70%']]]);

describe('research-themes', () => {
    beforeEach(() => {
        rows.clear();
        resolveLlmConfigMock.mockReset().mockResolvedValue(CFG);
        callAIMock.mockReset();
    });
    afterEach(() => vi.restoreAllMocks());

    it('seeds the catalog on first read and reports version 1', async () => {
        const themes = await listThemes();
        expect(themes.map((t) => t.slug)).toEqual(RESEARCH_SEEDS.map((s) => s.slug));
        expect(themes[0].version).toBe(1);
        expect(themes[0].updatedBy).toBe('seed');
        expect(themes[0].tiers).toHaveLength(3);
        expect(themes[0].cards).toHaveLength(5);
        expect(themes[0].revisions).toEqual([]);
        expect((await getTheme('ai-biotech'))?.title).toBe(RESEARCH_SEEDS[0].title);
        expect(await getTheme('nope')).toBeNull();
    });

    it('stores a new version with the previous content when the LLM edits the note', async () => {
        const before = (await getTheme('ai-biotech'))!;
        callAIMock.mockImplementation(async (prompt: string) => {
            expect(prompt).toContain('news 2026-09-18: Q3 revenue +70%');
            const theme = structuredClone({ title: before.title, intro: before.intro, tiers: before.tiers, shortlist: before.shortlist, caveats: before.caveats, momentum: before.momentum, sections: before.sections, cards: before.cards });
            theme.tiers[0].entries[0].thesis = 'ALNY 第三季度收入同比 +70%，RNAi 商业化继续加速。';
            return JSON.stringify({ theme, changes: ['ALNY: 更新第三季度收入'] });
        });
        const out = await reviseTheme('ai-biotech', { facts }, 'admin');
        expect(out.status).toBe('updated');
        if (out.status !== 'updated') return;
        expect(out.changes).toEqual(['ALNY: 更新第三季度收入']);
        expect(out.theme.version).toBe(2);
        expect(out.theme.updatedBy).toBe('admin');
        expect(out.theme.tiers[0].entries[0].thesis).toContain('+70%');
        expect(out.theme.revisions).toHaveLength(1);
        expect(out.theme.revisions[0]).toMatchObject({ version: 2, updatedBy: 'admin', changes: ['ALNY: 更新第三季度收入'] });
        // the stored row keeps the pre-revision snapshot for inspection
        expect(rows.get('ai-biotech')!.revisions[0].previous.tiers[0].entries[0].thesis).toBe(before.tiers[0].entries[0].thesis);
    });

    it('adds tier moves the model forgot to mention', async () => {
        const before = (await getTheme('ai-biotech'))!;
        callAIMock.mockImplementation(async () => {
            const theme = structuredClone({ title: before.title, intro: before.intro, tiers: before.tiers, shortlist: before.shortlist, caveats: before.caveats, momentum: before.momentum, sections: before.sections, cards: before.cards });
            const [twst] = theme.tiers[1].entries.splice(0, 1);
            theme.tiers[2].entries.push(twst);
            return JSON.stringify({ theme, changes: [] });
        });
        const out = await reviseTheme('ai-biotech', { facts });
        expect(out.status).toBe('updated');
        if (out.status === 'updated') expect(out.changes[0]).toMatch(/^TWST: .* → /);
    });

    it('only stamps checkedAt when the reply echoes the note unchanged', async () => {
        const before = (await getTheme('ai-biotech'))!;
        callAIMock.mockResolvedValue(JSON.stringify({ theme: { title: before.title, intro: before.intro, tiers: before.tiers, shortlist: before.shortlist, caveats: before.caveats, momentum: before.momentum, sections: before.sections, cards: before.cards }, changes: [] }));
        const out = await reviseTheme('ai-biotech', { facts });
        expect(out.status).toBe('unchanged');
        const after = (await getTheme('ai-biotech'))!;
        expect(after.version).toBe(1);
        expect(after.checkedAt).not.toBeNull();
        expect(after.revisions).toEqual([]);
    });

    it('leaves the note alone on unusable replies, missing LLM or unknown slug', async () => {
        await listThemes();
        callAIMock.mockResolvedValue('{"theme": {"tiers": [{"entries": []}]}, "changes": ["x"]}');
        expect(await reviseTheme('ai-biotech', { facts })).toEqual({ status: 'failed', reason: 'unusable reply' });
        expect((await getTheme('ai-biotech'))!.version).toBe(1);
        expect(await reviseTheme('nope', { facts })).toEqual({ status: 'failed', reason: 'unknown theme' });
        resolveLlmConfigMock.mockResolvedValue(null);
        expect(await reviseTheme('ai-biotech', { facts })).toEqual({ status: 'noLlm' });
        expect(callAIMock).toHaveBeenCalledTimes(1);
    });
});
