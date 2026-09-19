import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * A thematic research note: companies grouped into tiers with a thesis and
 * risks per name, a shortlist, and caveats. Seeded from lib/research-seed.ts,
 * then revised by the LLM (weekly daemon pass or an admin button) against
 * fresh market data and news. Every revision keeps the previous snapshot so
 * a bad rewrite can be inspected.
 */
export interface ResearchEntry {
    symbol: string;
    name: string;
    /** Why the name is worth following (or what to watch) */
    thesis: string;
    /** Main risks; may be empty */
    risk: string;
    /** Short status label, e.g. "商业增长较清晰"; may be empty */
    tag: string;
}

export type ResearchTierTone = 'core' | 'validation' | 'speculative' | 'tools';

export interface ResearchTier {
    key: string;
    tone: ResearchTierTone;
    title: string;
    subtitle: string;
    entries: ResearchEntry[];
    /** Closing remark under the tier (e.g. "prefer SDGR over RXRX because …") */
    note: string;
    /** Column headings for this tier; empty = the default "why follow / main risks" */
    thesisLabel: string;
    riskLabel: string;
}

export interface ResearchGroup {
    key: string;
    label: string;
    symbols: string[];
}

export interface ResearchShortlist {
    title: string;
    symbols: string[];
    groups: ResearchGroup[];
    /** One-line reason per shortlisted symbol, in priority order */
    reasons: { symbol: string; reason: string }[];
    note: string;
}

/** Free-form framework text: a numbered/bulleted list with optional sub-lists and links */
export interface ResearchSection {
    key: string;
    title: string;
    intro: string;
    style: 'numbered' | 'bullets';
    items: string[];
    sub: { title: string; items: string[] }[];
    links: { label: string; url: string }[];
    outro: string;
    /** Rendered before the shortlist ('top') or after the tracking cards ('bottom') */
    position: 'top' | 'bottom';
}

/** Per-company tracking card: what would confirm and what would break the thesis */
export interface TrackingCard {
    symbol: string;
    title: string;
    coreAsset: string;
    progress: string;
    catalysts: string;
    failConditions: string;
    verdict: string;
}

/** One company in the momentum table; numbers are computed, prose is LLM/seed */
export interface MomentumRow {
    symbol: string;
    /** Close-to-close return over the window, percent */
    returnPct: number | null;
    /** Worst peak-to-trough inside the window, percent (negative) */
    maxDrawdownPct: number | null;
    aboveMa20: boolean | null;
    aboveMa50: boolean | null;
    /** Last close within 3% of the window high */
    nearHigh: boolean;
    /** Technical state in words, derived from the flags on recompute */
    technical: string;
    /** The analyst's one-line judgement */
    verdict: string;
}

export interface MomentumGroup {
    key: string;
    title: string;
    subtitle: string;
    symbols: string[];
    note: string;
}

export interface MomentumRank {
    symbol: string;
    reason: string;
}

/**
 * Trailing-window momentum snapshot for a subset of the theme: returns,
 * drawdowns and moving-average state per name (recomputed from daily bars),
 * plus the analyst grouping, ranking and a spotlight (revised by the LLM).
 */
export interface ResearchMomentum {
    title: string;
    /** Trading sessions in the window */
    sessions: number;
    /** YYYY-MM-DD of the first and last close used */
    windowStart: string;
    windowEnd: string;
    benchmarkSymbol: string;
    benchmarkReturnPct: number | null;
    rows: MomentumRow[];
    groups: MomentumGroup[];
    ranking: MomentumRank[];
    spotlight: { symbol: string; text: string } | null;
    /** Analyst reading of the table (LLM-maintained) */
    summary: string;
    /** Data source / disclaimer line */
    note: string;
    /** When the numbers were last recomputed; null while still the seed */
    computedAt: Date | null;
}

export interface ResearchThemeContent {
    title: string;
    intro: string;
    tiers: ResearchTier[];
    shortlist: ResearchShortlist;
    caveats: string[];
    momentum: ResearchMomentum | null;
    sections: ResearchSection[];
    cards: TrackingCard[];
}

export type ResearchUpdatedBy = 'seed' | 'llm' | 'admin';

export interface ResearchRevision {
    version: number;
    updatedAt: Date;
    updatedBy: ResearchUpdatedBy;
    changes: string[];
    /** The content as it was *before* this revision replaced it */
    previous: ResearchThemeContent;
}

export interface IResearchTheme extends Document, ResearchThemeContent {
    slug: string;
    lang: string;
    version: number;
    updatedAt: Date;
    updatedBy: ResearchUpdatedBy;
    /** Change summary of the latest revision */
    changes: string[];
    /** Last time an LLM pass ran, even when it changed nothing */
    checkedAt: Date | null;
    revisions: ResearchRevision[];
}

const EntrySchema = new Schema<ResearchEntry>(
    {
        symbol: { type: String, required: true },
        name: { type: String, default: '' },
        thesis: { type: String, default: '' },
        risk: { type: String, default: '' },
        tag: { type: String, default: '' },
    },
    { _id: false },
);

const TierSchema = new Schema<ResearchTier>(
    {
        key: { type: String, required: true },
        tone: { type: String, enum: ['core', 'validation', 'speculative', 'tools'], default: 'core' },
        title: { type: String, required: true },
        subtitle: { type: String, default: '' },
        entries: { type: [EntrySchema], default: [] },
        note: { type: String, default: '' },
        thesisLabel: { type: String, default: '' },
        riskLabel: { type: String, default: '' },
    },
    { _id: false },
);

const GroupSchema = new Schema<ResearchGroup>(
    { key: { type: String, required: true }, label: { type: String, required: true }, symbols: { type: [String], default: [] } },
    { _id: false },
);

const ShortlistSchema = new Schema<ResearchShortlist>(
    {
        title: { type: String, default: '' },
        symbols: { type: [String], default: [] },
        groups: { type: [GroupSchema], default: [] },
        reasons: { type: [new Schema({ symbol: String, reason: String }, { _id: false })], default: [] },
        note: { type: String, default: '' },
    },
    { _id: false },
);

const SectionSchema = new Schema<ResearchSection>(
    {
        key: { type: String, required: true },
        title: { type: String, required: true },
        intro: { type: String, default: '' },
        style: { type: String, enum: ['numbered', 'bullets'], default: 'bullets' },
        items: { type: [String], default: [] },
        sub: { type: [new Schema({ title: String, items: [String] }, { _id: false })], default: [] },
        links: { type: [new Schema({ label: String, url: String }, { _id: false })], default: [] },
        outro: { type: String, default: '' },
        position: { type: String, enum: ['top', 'bottom'], default: 'bottom' },
    },
    { _id: false },
);

const CardSchema = new Schema<TrackingCard>(
    {
        symbol: { type: String, required: true },
        title: { type: String, default: '' },
        coreAsset: { type: String, default: '' },
        progress: { type: String, default: '' },
        catalysts: { type: String, default: '' },
        failConditions: { type: String, default: '' },
        verdict: { type: String, default: '' },
    },
    { _id: false },
);

const MomentumRowSchema = new Schema<MomentumRow>(
    {
        symbol: { type: String, required: true },
        returnPct: { type: Number, default: null },
        maxDrawdownPct: { type: Number, default: null },
        aboveMa20: { type: Boolean, default: null },
        aboveMa50: { type: Boolean, default: null },
        nearHigh: { type: Boolean, default: false },
        technical: { type: String, default: '' },
        verdict: { type: String, default: '' },
    },
    { _id: false },
);

const MomentumGroupSchema = new Schema<MomentumGroup>(
    {
        key: { type: String, required: true },
        title: { type: String, required: true },
        subtitle: { type: String, default: '' },
        symbols: { type: [String], default: [] },
        note: { type: String, default: '' },
    },
    { _id: false },
);

const MomentumRankSchema = new Schema<MomentumRank>(
    { symbol: { type: String, required: true }, reason: { type: String, default: '' } },
    { _id: false },
);

const MomentumSchema = new Schema<ResearchMomentum>(
    {
        title: { type: String, default: '' },
        sessions: { type: Number, default: 45 },
        windowStart: { type: String, default: '' },
        windowEnd: { type: String, default: '' },
        benchmarkSymbol: { type: String, default: '' },
        benchmarkReturnPct: { type: Number, default: null },
        rows: { type: [MomentumRowSchema], default: [] },
        groups: { type: [MomentumGroupSchema], default: [] },
        ranking: { type: [MomentumRankSchema], default: [] },
        spotlight: { type: new Schema({ symbol: String, text: String }, { _id: false }), default: null },
        summary: { type: String, default: '' },
        note: { type: String, default: '' },
        computedAt: { type: Date, default: null },
    },
    { _id: false },
);

const ContentFields = {
    title: { type: String, required: true },
    intro: { type: String, default: '' },
    tiers: { type: [TierSchema], default: [] },
    shortlist: { type: ShortlistSchema, default: () => ({ title: '', symbols: [], groups: [] }) },
    caveats: { type: [String], default: [] },
    momentum: { type: MomentumSchema, default: null },
    sections: { type: [SectionSchema], default: [] },
    cards: { type: [CardSchema], default: [] },
};

const PreviousSchema = new Schema<ResearchThemeContent>(ContentFields, { _id: false });

const RevisionSchema = new Schema<ResearchRevision>(
    {
        version: { type: Number, required: true },
        updatedAt: { type: Date, required: true },
        updatedBy: { type: String, enum: ['seed', 'llm', 'admin'], required: true },
        changes: { type: [String], default: [] },
        previous: { type: PreviousSchema, required: true },
    },
    { _id: false },
);

const ResearchThemeSchema = new Schema<IResearchTheme>(
    {
        slug: { type: String, required: true, unique: true },
        lang: { type: String, required: true, default: 'zh-CN' },
        ...ContentFields,
        version: { type: Number, required: true, default: 1 },
        updatedAt: { type: Date, required: true },
        updatedBy: { type: String, enum: ['seed', 'llm', 'admin'], required: true, default: 'seed' },
        changes: { type: [String], default: [] },
        checkedAt: { type: Date, default: null },
        revisions: { type: [RevisionSchema], default: [] },
    },
    { timestamps: false, minimize: false },
);

export const ResearchTheme: Model<IResearchTheme> =
    (models?.ResearchTheme as Model<IResearchTheme>) || model<IResearchTheme>('ResearchTheme', ResearchThemeSchema);
