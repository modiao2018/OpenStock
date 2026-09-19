import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * AI fundamentals card for one symbol in one UI language, as shown on the
 * watchlist. The qualitative part (role, four 1-5 scores, highlights, capital
 * market read) is LLM-generated and refreshed roughly monthly or on demand;
 * the numeric market block comes from Finnhub basic financials and refreshes
 * daily. Both live on one row so the page needs a single read per symbol.
 */
export interface AiProfileScore {
    /** 1 (lowest) .. 5 (highest) */
    score: number;
    /** One short sentence justifying the score */
    note: string;
}

export interface AiProfileMarket {
    /** Last price when the metrics were fetched (quote currency) */
    price: number | null;
    /** USD millions */
    marketCapUsdM: number | null;
    peTtm: number | null;
    psTtm: number | null;
    beta: number | null;
    high52: number | null;
    low52: number | null;
    high52Date: string | null;
    low52Date: string | null;
    /** Price returns in percent */
    ret13w: number | null;
    ret26w: number | null;
    ret52w: number | null;
    retYtd: number | null;
    /** TTM revenue growth, percent */
    revenueGrowthTtm: number | null;
    /** TTM net margin, percent */
    netMarginTtm: number | null;
    fetchedAt: Date;
}

export type AiProfileStance = 'bullish' | 'neutral' | 'bearish';

export interface IAiProfile extends Document {
    /** `${symbol}|${lang}` */
    key: string;
    symbol: string;
    lang: string;
    /** Short tag: where the company sits in the AI value chain */
    aiRole: string;
    summary: string;
    density: AiProfileScore;
    maturity: AiProfileScore;
    potential: AiProfileScore;
    results: AiProfileScore;
    /** Shipped AI products / revenue figures / partnerships / milestones */
    highlights: string[];
    /** How the market prices the AI story, valuation level, recent drivers */
    capitalNote: string;
    stance: AiProfileStance;
    /** Provider/model that wrote the qualitative part */
    llmModel: string;
    generatedAt: Date;
    market: AiProfileMarket | null;
}

const ScoreSchema = new Schema<AiProfileScore>(
    { score: { type: Number, required: true }, note: { type: String, default: '' } },
    { _id: false },
);

const MarketSchema = new Schema<AiProfileMarket>(
    {
        price: { type: Number, default: null },
        marketCapUsdM: { type: Number, default: null },
        peTtm: { type: Number, default: null },
        psTtm: { type: Number, default: null },
        beta: { type: Number, default: null },
        high52: { type: Number, default: null },
        low52: { type: Number, default: null },
        high52Date: { type: String, default: null },
        low52Date: { type: String, default: null },
        ret13w: { type: Number, default: null },
        ret26w: { type: Number, default: null },
        ret52w: { type: Number, default: null },
        retYtd: { type: Number, default: null },
        revenueGrowthTtm: { type: Number, default: null },
        netMarginTtm: { type: Number, default: null },
        fetchedAt: { type: Date, required: true },
    },
    { _id: false },
);

const AiProfileSchema = new Schema<IAiProfile>(
    {
        key: { type: String, required: true, unique: true },
        symbol: { type: String, required: true, index: true },
        lang: { type: String, required: true },
        aiRole: { type: String, default: '' },
        summary: { type: String, default: '' },
        density: { type: ScoreSchema, required: true },
        maturity: { type: ScoreSchema, required: true },
        potential: { type: ScoreSchema, required: true },
        results: { type: ScoreSchema, required: true },
        highlights: { type: [String], default: [] },
        capitalNote: { type: String, default: '' },
        stance: { type: String, enum: ['bullish', 'neutral', 'bearish'], default: 'neutral' },
        llmModel: { type: String, default: '' },
        generatedAt: { type: Date, required: true },
        market: { type: MarketSchema, default: null },
    },
    { timestamps: false, minimize: false },
);

export const AiProfile: Model<IAiProfile> =
    (models?.AiProfile as Model<IAiProfile>) || model<IAiProfile>('AiProfile', AiProfileSchema);
