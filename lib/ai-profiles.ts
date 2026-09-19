// Mongo-backed store and generator for the watchlist "AI fundamentals" cards.
//
// One row per (symbol, UI language). The LLM text lives ~30 days, the numeric
// market block one day; `refreshProfile` only redoes the part that is stale
// (or everything when forced). Upstream fetchers are injected so the module
// stays free of the 'use server' action files and can be unit-tested.

import { connectToDatabase } from '@/database/mongoose';
import { AiProfile, type AiProfileMarket, type IAiProfile } from '@/database/models/ai-profile.model';
import { callAIProviderWithConfig } from '@/lib/ai-provider';
import { resolveLlmConfig } from '@/lib/llm-config';
import {
    buildAiProfilePrompt,
    isProfileMarketFresh,
    isProfileTextFresh,
    normalizeMarket,
    parseAiProfileReply,
    profileKey,
    type AiProfileData,
    type AiProfileText,
    type FinnhubMetricPayload,
} from '@/lib/ai-profile-math';

export interface ProfileSources {
    /** Finnhub basic financials; null when unavailable (non-US listing, outage) */
    fetchMetrics: (symbol: string) => Promise<FinnhubMetricPayload | null>;
    /** Latest price and USD market cap (millions); nulls when unknown */
    fetchQuoteAndCap: (symbol: string) => Promise<{ price: number | null; marketCapUsdM: number | null }>;
    /** Display name / industry for the prompt; empty strings when unknown */
    fetchIdentity: (symbol: string) => Promise<{ name: string; industry: string }>;
}

export type RefreshOutcome =
    | { status: 'ok'; profile: AiProfileData }
    /** No LLM configured anywhere (catalyst page config or env) */
    | { status: 'noLlm'; profile: AiProfileData | null }
    /** LLM call failed or reply unusable; the stored row (if any) is returned */
    | { status: 'failed'; profile: AiProfileData | null };

type ProfileDoc = Pick<
    IAiProfile,
    | 'symbol' | 'lang' | 'aiRole' | 'summary' | 'density' | 'maturity' | 'potential' | 'results'
    | 'highlights' | 'capitalNote' | 'stance' | 'llmModel' | 'generatedAt' | 'market'
>;

export function toData(d: ProfileDoc): AiProfileData {
    const m = d.market;
    return {
        symbol: d.symbol,
        lang: d.lang,
        aiRole: d.aiRole ?? '',
        summary: d.summary ?? '',
        density: { score: d.density.score, note: d.density.note ?? '' },
        maturity: { score: d.maturity.score, note: d.maturity.note ?? '' },
        potential: { score: d.potential.score, note: d.potential.note ?? '' },
        results: { score: d.results.score, note: d.results.note ?? '' },
        highlights: d.highlights ?? [],
        capitalNote: d.capitalNote ?? '',
        stance: d.stance ?? 'neutral',
        model: d.llmModel ?? '',
        generatedAt: new Date(d.generatedAt).toISOString(),
        market: m
            ? {
                  price: m.price ?? null,
                  marketCapUsdM: m.marketCapUsdM ?? null,
                  peTtm: m.peTtm ?? null,
                  psTtm: m.psTtm ?? null,
                  beta: m.beta ?? null,
                  high52: m.high52 ?? null,
                  low52: m.low52 ?? null,
                  high52Date: m.high52Date ?? null,
                  low52Date: m.low52Date ?? null,
                  ret13w: m.ret13w ?? null,
                  ret26w: m.ret26w ?? null,
                  ret52w: m.ret52w ?? null,
                  retYtd: m.retYtd ?? null,
                  revenueGrowthTtm: m.revenueGrowthTtm ?? null,
                  netMarginTtm: m.netMarginTtm ?? null,
                  fetchedAt: new Date(m.fetchedAt).toISOString(),
              }
            : null,
    };
}

/** Stored rows for the symbols in `lang`, any age. Never throws. */
export async function readProfiles(symbols: string[], lang: string): Promise<Map<string, AiProfileData>> {
    const out = new Map<string, AiProfileData>();
    if (symbols.length === 0) return out;
    try {
        await connectToDatabase();
        const keys = symbols.map((s) => profileKey(s, lang));
        const docs = await AiProfile.find({ key: { $in: keys } }).lean();
        for (const doc of docs) out.set(doc.symbol, toData(doc));
    } catch (e) {
        console.error('readProfiles failed', e);
    }
    return out;
}

async function readOne(symbol: string, lang: string): Promise<ProfileDoc | null> {
    await connectToDatabase();
    return AiProfile.findOne({ key: profileKey(symbol, lang) }).lean();
}

async function fetchMarket(symbol: string, sources: ProfileSources): Promise<AiProfileMarket | null> {
    try {
        const [metrics, extras] = await Promise.all([
            sources.fetchMetrics(symbol).catch((e) => {
                console.error('AI profile metrics fetch failed for', symbol, e);
                return null;
            }),
            sources.fetchQuoteAndCap(symbol).catch(() => ({ price: null, marketCapUsdM: null })),
        ]);
        if (!metrics && extras.price === null) return null;
        return normalizeMarket(metrics, extras);
    } catch (e) {
        console.error('AI profile market fetch failed for', symbol, e);
        return null;
    }
}

const LLM_TIMEOUT_MS = 55_000;

async function generateText(
    symbol: string,
    lang: string,
    market: AiProfileMarket | null,
    sources: ProfileSources,
): Promise<{ text: AiProfileText; model: string } | 'noLlm' | null> {
    const llm = await resolveLlmConfig();
    if (!llm) return 'noLlm';
    const identity = await sources.fetchIdentity(symbol).catch(() => ({ name: '', industry: '' }));
    const prompt = buildAiProfilePrompt({
        symbol,
        name: identity.name,
        industry: identity.industry,
        lang,
        today: new Date().toISOString().slice(0, 10),
        market,
    });
    const call = callAIProviderWithConfig(prompt, { name: llm.provider, apiKey: llm.apiKey, baseUrl: llm.baseUrl, model: llm.model });
    const reply = await Promise.race([call, new Promise<null>((r) => setTimeout(() => r(null), LLM_TIMEOUT_MS))]);
    if (!reply) return null;
    const text = parseAiProfileReply(reply);
    if (!text) {
        console.error('AI profile reply unusable for', symbol, reply.slice(0, 200));
        return null;
    }
    return { text, model: `${llm.provider}/${llm.model}` };
}

// Two tabs (or a page reload mid-generation) must not pay for the same
// symbol twice: identical in-flight refreshes share one promise
const inflight = new Map<string, Promise<RefreshOutcome>>();

/**
 * Bring the (symbol, lang) row up to date: market block when older than a
 * day, LLM text when older than a month or `force`. Returns the row that is
 * now stored (possibly partially refreshed when the LLM step fails).
 */
export function refreshProfile(
    symbol: string,
    lang: string,
    sources: ProfileSources,
    opts: { force?: boolean } = {},
): Promise<RefreshOutcome> {
    const key = `${profileKey(symbol, lang)}${opts.force ? '|force' : ''}`;
    const running = inflight.get(key);
    if (running) return running;
    const work = doRefresh(symbol.toUpperCase(), lang, sources, opts).finally(() => inflight.delete(key));
    inflight.set(key, work);
    return work;
}

async function doRefresh(
    symbol: string,
    lang: string,
    sources: ProfileSources,
    opts: { force?: boolean },
): Promise<RefreshOutcome> {
    const key = profileKey(symbol, lang);
    let existing: ProfileDoc | null = null;
    try {
        existing = await readOne(symbol, lang);
    } catch (e) {
        console.error('AI profile read failed for', symbol, e);
    }

    const now = Date.now();
    const marketFresh = existing ? isProfileMarketFresh(existing.market, now) : false;
    const textFresh = existing && !opts.force ? isProfileTextFresh(existing, now) : false;

    if (existing && marketFresh && textFresh) return { status: 'ok', profile: toData(existing) };

    const market = marketFresh && existing ? existing.market : (await fetchMarket(symbol, sources)) ?? existing?.market ?? null;

    if (textFresh && existing) {
        // Only the numbers were stale
        await persist(key, { market });
        return { status: 'ok', profile: toData({ ...existing, market }) };
    }

    const generated = await generateText(symbol, lang, market, sources).catch((e) => {
        console.error('AI profile generation failed for', symbol, e);
        return null;
    });

    if (generated === 'noLlm' || generated === null) {
        // Keep the fresh numbers even when the text could not be (re)written
        if (existing) {
            await persist(key, { market });
            return { status: generated === 'noLlm' ? 'noLlm' : 'failed', profile: toData({ ...existing, market }) };
        }
        return { status: generated === 'noLlm' ? 'noLlm' : 'failed', profile: null };
    }

    const doc: ProfileDoc = {
        symbol,
        lang,
        ...generated.text,
        llmModel: generated.model,
        generatedAt: new Date(),
        market,
    };
    await persist(key, doc);
    return { status: 'ok', profile: toData(doc) };
}

async function persist(key: string, fields: Partial<ProfileDoc>): Promise<void> {
    try {
        await connectToDatabase();
        await AiProfile.updateOne({ key }, { $set: fields }, { upsert: true });
    } catch (e) {
        console.error('AI profile save failed for', key, e);
    }
}
