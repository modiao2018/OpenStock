import { describe, expect, it } from 'vitest';
import { RESEARCH_SEEDS } from '@/lib/research-seed';
import { buildRevisionPrompt, contentChanged, momentumTable, parseRevisionReply, themeSymbols, tierMoves } from '@/lib/research-math';
import type { ResearchThemeContent } from '@/database/models/research-theme.model';

const seed = RESEARCH_SEEDS[0];
const current: ResearchThemeContent = {
    title: seed.title, intro: seed.intro, tiers: seed.tiers, shortlist: seed.shortlist, caveats: seed.caveats,
    momentum: seed.momentum, sections: seed.sections, cards: seed.cards,
};
const reply = (theme: unknown, changes: unknown = []) => '```json\n' + JSON.stringify({ theme, changes }) + '\n```';

describe('research seed', () => {
    it('lists every company once; shortlist, cards and momentum only name known companies', () => {
        const symbols = themeSymbols(current);
        const all = current.tiers.flatMap((t) => t.entries.map((e) => e.symbol));
        expect(new Set(all).size).toBe(all.length);
        expect(symbols).toHaveLength(18);
        for (const s of current.shortlist.symbols) expect(symbols).toContain(s);
        for (const g of current.shortlist.groups) for (const s of g.symbols) expect(symbols).toContain(s);
        for (const c of current.cards) expect(symbols).toContain(c.symbol);
        for (const r of current.momentum!.rows) expect(symbols).toContain(r.symbol);
        expect(current.sections.map((s) => s.key)).toEqual(['thesis', 'formula', 'checklist', 'references']);
    });
});

describe('buildRevisionPrompt', () => {
    it('embeds editable prose and per-symbol facts; numbers and framework sections stay out of the editable JSON', () => {
        const facts = new Map([['ALNY', ['market: price 300', 'news 2026-09-18 (Reuters): guidance raised']]]);
        const p = buildRevisionPrompt({ theme: current, facts, today: '2026-09-19', lang: 'zh-CN' });
        expect(p).toContain('"symbol":"ALNY"');
        expect(p).toContain('ALNY:\n  - market: price 300\n  - news 2026-09-18');
        expect(p).toContain('ARGX:\n  - (no new data)');
        expect(p).toContain('今天是 2026-09-19');
        expect(p).toContain('走势数据（只读');
        expect(p).toContain('ABCL: return +95.4%, max drawdown -18.8%, MA20 above, MA50 above, near window high');
        expect(p).not.toContain('"returnPct"');
        expect(p).not.toContain('每月复盘清单');
        expect(p).toContain('"coreAsset"');
        expect(p).toContain('补丁');
        expect(buildRevisionPrompt({ theme: current, facts, today: '2026-09-19', lang: 'en' })).toContain('Today is 2026-09-19');
        expect(momentumTable(current.momentum!)).toContain('benchmark XBI +1.6%');
    });
});

describe('parseRevisionReply — patch', () => {
    it('applies prose edits, a tier move, card/momentum prose, and ignores unknown tickers', () => {
        const patch = {
            changes: ['ALNY: 下调指引后风险上调', 'TWST: 移到 A 组'],
            entries: [
                { symbol: 'ALNY', risk: '指引下调，短期承压', tag: 'ignored' },
                { symbol: 'twst', tier: 'core' },
                { symbol: 'NVDA', thesis: '不在名单里' },
                { symbol: 'TEM', tier: 'nope' },
            ],
            tiers: [{ key: 'validation', note: '新结语' }, { key: 'zzz', note: 'x' }],
            shortlist: { groups: [{ key: 'tenx', symbols: ['ABCL', 'RXRX', 'ZZZZ'] }], reasons: [{ symbol: 'NTRA', reason: '新理由' }], note: '新用法' },
            cards: [{ symbol: 'ABCL', progress: '完整 Phase 2 数据已公布', verdict: '继续跟踪' }, { symbol: 'ZZZZ', progress: 'x' }],
            momentum: {
                summary: '新解读',
                rows: [{ symbol: 'NTRA', verdict: '走势仍最健康' }],
                groups: [{ key: 'balanced', symbols: ['NTRA', 'TEM'], note: '新说明' }],
                ranking: [{ symbol: 'NTRA', reason: '1' }, { symbol: 'SDGR', reason: '2' }],
                spotlight: { symbol: 'SDGR', text: '换成 SDGR' },
            },
        };
        const out = parseRevisionReply(JSON.stringify(patch), current)!;
        expect(out.changes).toHaveLength(2);
        const t = out.theme;
        const alny = t.tiers[2].entries.find((e) => e.symbol === 'ALNY')!;
        expect(alny).toMatchObject({ risk: '指引下调，短期承压', thesis: 'RNAi 商业收入和新适应症扩张' });
        expect(t.tiers[1].entries.map((e) => e.symbol)).not.toContain('TWST');
        expect(t.tiers[0].entries.map((e) => e.symbol)).toContain('TWST');
        expect(t.tiers[0].entries.map((e) => e.symbol)).toContain('TEM'); // unknown tier key → stays
        expect(themeSymbols(t)).toHaveLength(18);
        expect(t.tiers[1].note).toBe('新结语');
        expect(t.shortlist.groups[1].symbols).toEqual(['ABCL', 'RXRX']);
        expect(t.shortlist.groups[0].symbols).toEqual(current.shortlist.groups[0].symbols);
        expect(t.shortlist.reasons).toEqual([{ symbol: 'NTRA', reason: '新理由' }]);
        expect(t.shortlist.note).toBe('新用法');
        expect(t.cards[0]).toMatchObject({ symbol: 'ABCL', progress: '完整 Phase 2 数据已公布', verdict: '继续跟踪', coreAsset: current.cards[0].coreAsset });
        expect(t.cards).toHaveLength(current.cards.length);
        expect(t.sections).toEqual(current.sections);
        const m = t.momentum!;
        expect(m.summary).toBe('新解读');
        expect(m.rows.find((r) => r.symbol === 'NTRA')).toMatchObject({ verdict: '走势仍最健康', returnPct: 36.1 });
        expect(m.rows.find((r) => r.symbol === 'ABCL')!.verdict).toBe(current.momentum!.rows[0].verdict);
        expect(m.groups[1]).toMatchObject({ symbols: ['NTRA', 'TEM'], note: '新说明' });
        expect(m.groups[0].symbols).toEqual(['ABCL', 'SDGR', 'TWST']);
        expect(m.groups[2].symbols).toEqual(['CRSP', 'ABSI', 'BEAM', 'NTLA', 'PTGX']);
        expect(m.ranking).toEqual([{ symbol: 'NTRA', reason: '1' }, { symbol: 'SDGR', reason: '2' }]);
        expect(m.spotlight).toEqual({ symbol: 'SDGR', text: '换成 SDGR' });
        expect(tierMoves(current, t)).toEqual(['TWST: B 组：高风险高弹性 → A 组：优先研究']);
    });

    it('an empty patch means no change', () => {
        const out = parseRevisionReply('{"changes": []}', current)!;
        expect(out.changes).toEqual([]);
        expect(contentChanged(current, out.theme)).toBe(false);
        expect(parseRevisionReply('not json', current)).toBeNull();
    });
});

describe('parseRevisionReply — full note', () => {
    it('accepts an edited full copy (wrapped or bare) and keeps structure', () => {
        const edited = structuredClone(current);
        edited.tiers[0].entries[0].thesis = '新 thesis';
        edited.tiers[0].tone = 'tools' as never; // must be ignored
        const out = parseRevisionReply(reply(edited, ['NTRA: 更新']), current)!;
        expect(out.theme.tiers[0].entries[0].thesis).toBe('新 thesis');
        expect(out.theme.tiers[0].tone).toBe('core');
        expect(out.theme.tiers[0].thesisLabel).toBe('研究主线');
        expect(out.changes).toEqual(['NTRA: 更新']);
        expect(contentChanged(current, out.theme)).toBe(true);

        const bare = structuredClone(current);
        bare.tiers[2].entries[0].risk = '估值更高了';
        const b = parseRevisionReply(JSON.stringify(bare), current)!;
        expect(b.theme.tiers[2].entries[0].risk).toBe('估值更高了');
        expect(b.changes).toEqual([]);
    });

    it('rejects added, dropped or duplicated companies, changed tier keys, and a dropped momentum block', () => {
        const added = structuredClone(current);
        added.tiers[0].entries.push({ symbol: 'NVDA', name: 'NVIDIA', thesis: 'x', risk: '', tag: '' });
        expect(parseRevisionReply(reply(added), current)).toBeNull();
        const dropped = structuredClone(current);
        dropped.tiers[2].entries.pop();
        expect(parseRevisionReply(reply(dropped), current)).toBeNull();
        const dup = structuredClone(current);
        dup.tiers[2].entries.push({ ...current.tiers[0].entries[0] });
        expect(parseRevisionReply(reply(dup), current)).toBeNull();
        const renamed = structuredClone(current);
        renamed.tiers[0].key = 'top';
        expect(parseRevisionReply(reply(renamed), current)).toBeNull();
        const noMomentum = structuredClone(current) as { momentum: unknown };
        noMomentum.momentum = undefined;
        expect(parseRevisionReply(reply(noMomentum), current)).toBeNull();
    });

    it('an unchanged echo compares equal', () => {
        const out = parseRevisionReply(reply(current, []), current)!;
        expect(contentChanged(current, out.theme)).toBe(false);
        expect(tierMoves(current, out.theme)).toEqual([]);
    });
});
