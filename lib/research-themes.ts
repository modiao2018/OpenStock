// Mongo store and LLM revision loop for thematic research notes. Plain
// server module (no 'use server', no react) so the daemon can import it.
//
// The seed in lib/research-seed.ts is inserted on first read; after that the
// database is authoritative. `reviseTheme` asks the LLM to re-check the note
// against per-symbol facts supplied by the caller (market data, headlines),
// validates the reply structurally, and stores a new version with the
// previous content kept in `revisions`.

import { connectToDatabase } from '@/database/mongoose';
import {
    ResearchTheme,
    type IResearchTheme,
    type ResearchMomentum,
    type ResearchThemeContent,
    type ResearchUpdatedBy,
} from '@/database/models/research-theme.model';
import { RESEARCH_SEEDS } from '@/lib/research-seed';
import { callAIProviderWithConfig } from '@/lib/ai-provider';
import { resolveLlmConfig } from '@/lib/llm-config';
import {
    buildRevisionPrompt,
    contentChanged,
    MAX_REVISIONS,
    parseRevisionReply,
    themeSymbols,
    tierMoves,
    type ResearchThemeData,
} from '@/lib/research-math';

type ThemeDoc = Pick<
    IResearchTheme,
    'slug' | 'lang' | 'title' | 'intro' | 'tiers' | 'shortlist' | 'caveats' | 'momentum' | 'sections' | 'cards' | 'version' | 'updatedAt' | 'updatedBy' | 'changes' | 'checkedAt' | 'revisions'
>;

function contentOf(d: ResearchThemeContent): ResearchThemeContent {
    return {
        title: d.title,
        intro: d.intro ?? '',
        tiers: (d.tiers ?? []).map((t) => ({
            key: t.key,
            tone: t.tone,
            title: t.title,
            subtitle: t.subtitle ?? '',
            entries: (t.entries ?? []).map((e) => ({ symbol: e.symbol, name: e.name ?? '', thesis: e.thesis ?? '', risk: e.risk ?? '', tag: e.tag ?? '' })),
            note: t.note ?? '',
            thesisLabel: t.thesisLabel ?? '',
            riskLabel: t.riskLabel ?? '',
        })),
        shortlist: {
            title: d.shortlist?.title ?? '',
            symbols: [...(d.shortlist?.symbols ?? [])],
            groups: (d.shortlist?.groups ?? []).map((g) => ({ key: g.key, label: g.label, symbols: [...g.symbols] })),
            reasons: (d.shortlist?.reasons ?? []).map((r) => ({ symbol: r.symbol, reason: r.reason ?? '' })),
            note: d.shortlist?.note ?? '',
        },
        caveats: [...(d.caveats ?? [])],
        momentum: d.momentum ? momentumOf(d.momentum) : null,
        sections: (d.sections ?? []).map((sec) => ({
            key: sec.key,
            title: sec.title,
            intro: sec.intro ?? '',
            style: sec.style === 'numbered' ? 'numbered' : 'bullets',
            items: [...(sec.items ?? [])],
            sub: (sec.sub ?? []).map((x) => ({ title: x.title, items: [...(x.items ?? [])] })),
            links: (sec.links ?? []).map((l) => ({ label: l.label, url: l.url })),
            outro: sec.outro ?? '',
            position: sec.position === 'top' ? 'top' : 'bottom',
        })),
        cards: (d.cards ?? []).map((c) => ({
            symbol: c.symbol,
            title: c.title ?? '',
            coreAsset: c.coreAsset ?? '',
            progress: c.progress ?? '',
            catalysts: c.catalysts ?? '',
            failConditions: c.failConditions ?? '',
            verdict: c.verdict ?? '',
        })),
    };
}

function momentumOf(m: ResearchMomentum): ResearchMomentum {
    return {
        title: m.title ?? '',
        sessions: m.sessions ?? 45,
        windowStart: m.windowStart ?? '',
        windowEnd: m.windowEnd ?? '',
        benchmarkSymbol: m.benchmarkSymbol ?? '',
        benchmarkReturnPct: m.benchmarkReturnPct ?? null,
        rows: (m.rows ?? []).map((r) => ({
            symbol: r.symbol,
            returnPct: r.returnPct ?? null,
            maxDrawdownPct: r.maxDrawdownPct ?? null,
            aboveMa20: r.aboveMa20 ?? null,
            aboveMa50: r.aboveMa50 ?? null,
            nearHigh: r.nearHigh ?? false,
            technical: r.technical ?? '',
            verdict: r.verdict ?? '',
        })),
        groups: (m.groups ?? []).map((g) => ({ key: g.key, title: g.title, subtitle: g.subtitle ?? '', symbols: [...(g.symbols ?? [])], note: g.note ?? '' })),
        ranking: (m.ranking ?? []).map((r) => ({ symbol: r.symbol, reason: r.reason ?? '' })),
        spotlight: m.spotlight ? { symbol: m.spotlight.symbol, text: m.spotlight.text } : null,
        summary: m.summary ?? '',
        note: m.note ?? '',
        computedAt: m.computedAt ? new Date(m.computedAt) : null,
    };
}

/** Serialisable momentum block (dates as ISO strings) */
export type ResearchMomentumData = Omit<ResearchMomentum, 'computedAt'> & { computedAt: string | null };

export function toThemeData(d: ThemeDoc): ResearchThemeData {
    const content = contentOf(d);
    return {
        ...content,
        momentum: content.momentum
            ? { ...content.momentum, computedAt: content.momentum.computedAt ? content.momentum.computedAt.toISOString() : null }
            : null,
        slug: d.slug,
        lang: d.lang,
        version: d.version,
        updatedAt: new Date(d.updatedAt).toISOString(),
        updatedBy: d.updatedBy,
        changes: [...(d.changes ?? [])],
        checkedAt: d.checkedAt ? new Date(d.checkedAt).toISOString() : null,
        revisions: [...(d.revisions ?? [])]
            .sort((a, b) => b.version - a.version)
            .map((r) => ({ version: r.version, updatedAt: new Date(r.updatedAt).toISOString(), updatedBy: r.updatedBy, changes: [...(r.changes ?? [])] })),
    };
}

async function seedMissing(): Promise<void> {
    const existing = new Set((await ResearchTheme.find({}, { slug: 1 }).lean()).map((d) => d.slug));
    const missing = RESEARCH_SEEDS.filter((s) => !existing.has(s.slug));
    if (missing.length === 0) return;
    await ResearchTheme.insertMany(
        missing.map(({ slug, lang, ...content }) => ({
            slug,
            lang,
            ...content,
            version: 1,
            updatedAt: new Date(),
            updatedBy: 'seed',
            changes: [],
            checkedAt: null,
            revisions: [],
        })),
        { ordered: false },
    ).catch(() => { /* concurrent seeding hits the unique index; harmless */ });
}

/** Every theme, seeding the catalog on first call. Never throws. */
export async function listThemes(): Promise<ResearchThemeData[]> {
    try {
        await connectToDatabase();
        await seedMissing();
        const docs = await ResearchTheme.find().lean();
        return docs.map(toThemeData).sort((a, b) => a.slug.localeCompare(b.slug));
    } catch (e) {
        console.error('listThemes failed', e);
        return [];
    }
}

export async function getTheme(slug: string): Promise<ResearchThemeData | null> {
    try {
        await connectToDatabase();
        await seedMissing();
        const doc = await ResearchTheme.findOne({ slug }).lean();
        return doc ? toThemeData(doc) : null;
    } catch (e) {
        console.error('getTheme failed', e);
        return null;
    }
}

/** Store freshly computed momentum numbers (daily daemon pass); prose untouched by the caller */
export async function saveMomentum(slug: string, momentum: ResearchMomentum): Promise<void> {
    await connectToDatabase();
    await ResearchTheme.updateOne({ slug }, { $set: { momentum } });
}

/** Momentum block with raw Date, for the recompute; null when the theme has none */
export async function readMomentum(slug: string): Promise<{ momentum: ResearchMomentum; lang: string } | null> {
    await connectToDatabase();
    await seedMissing();
    const doc = await ResearchTheme.findOne({ slug }).lean();
    if (!doc?.momentum) return null;
    return { momentum: momentumOf(doc.momentum), lang: doc.lang };
}

export interface ReviseSources {
    /** Fact lines per symbol (market data, headlines); the caller decides the budget */
    facts: (symbols: string[]) => Promise<Map<string, string[]>>;
}

export type ReviseOutcome =
    | { status: 'updated'; theme: ResearchThemeData; changes: string[] }
    | { status: 'unchanged'; theme: ResearchThemeData }
    | { status: 'noLlm' }
    | { status: 'failed'; reason: string };

const LLM_TIMEOUT_MS = 180_000;

/** Ask the LLM to re-check the note against fresh facts; stores a new version when anything changed */
export async function reviseTheme(slug: string, sources: ReviseSources, updatedBy: ResearchUpdatedBy = 'llm'): Promise<ReviseOutcome> {
    const llm = await resolveLlmConfig();
    if (!llm) return { status: 'noLlm' };

    await connectToDatabase();
    await seedMissing();
    const doc = await ResearchTheme.findOne({ slug }).lean();
    if (!doc) return { status: 'failed', reason: 'unknown theme' };
    const current = contentOf(doc);

    const facts = await sources.facts(themeSymbols(current)).catch((e) => {
        console.error('research facts failed', e);
        return new Map<string, string[]>();
    });
    const prompt = buildRevisionPrompt({ theme: current, facts, today: new Date().toISOString().slice(0, 10), lang: doc.lang });
    // The note plus facts is a long prompt; give the model more than the
    // default 60s and turn any upstream failure into a 'failed' outcome
    let reply: string | null;
    try {
        reply = await callAIProviderWithConfig(
            prompt,
            { name: llm.provider, apiKey: llm.apiKey, baseUrl: llm.baseUrl, model: llm.model },
            { timeoutMs: LLM_TIMEOUT_MS },
        );
    } catch (e) {
        console.error('research revision LLM call failed for', slug, e);
        return { status: 'failed', reason: e instanceof Error && e.name === 'TimeoutError' ? 'llm timeout' : 'llm error' };
    }
    if (!reply) return { status: 'failed', reason: 'empty reply' };

    const parsed = parseRevisionReply(reply, current);
    if (!parsed) {
        // Head and tail: the tail shows whether the model hit its output limit mid-JSON
        console.error('research revision unusable for', slug, `len=${reply.length}`, reply.slice(0, 200), '…', reply.slice(-160));
        return { status: 'failed', reason: 'unusable reply' };
    }

    const now = new Date();
    if (!contentChanged(current, parsed.theme)) {
        await ResearchTheme.updateOne({ slug }, { $set: { checkedAt: now } });
        return { status: 'unchanged', theme: toThemeData({ ...doc, checkedAt: now }) };
    }

    const moves = tierMoves(current, parsed.theme).filter((m) => !parsed.changes.some((c) => c.includes(m.split(':')[0])));
    const changes = [...parsed.changes, ...moves];
    const version = doc.version + 1;
    const revision = { version, updatedAt: now, updatedBy, changes, previous: current };
    const revisions = [revision, ...(doc.revisions ?? [])].slice(0, MAX_REVISIONS);
    await ResearchTheme.updateOne(
        { slug },
        { $set: { ...parsed.theme, version, updatedAt: now, updatedBy, changes, checkedAt: now, revisions } },
    );
    const updated = await ResearchTheme.findOne({ slug }).lean();
    return { status: 'updated', theme: toThemeData(updated ?? { ...doc, ...parsed.theme, version, updatedAt: now, updatedBy, changes, checkedAt: now, revisions }), changes };
}
