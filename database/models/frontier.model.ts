import { Schema, model, models, type Document, type Model, type Types } from 'mongoose';

/**
 * 生物科技前沿（/frontier）的数据表。catalyst-monitor 的 frontier 采集器写入，
 * 网页端读取并管理主题、AI 药物记分板和会议日历。
 *
 * 数据流：各数据源 → FrontierItem（原始条目，规则初筛后才入库）
 *        → FrontierEvent（同一件事的多条报道合并成一个事件，LLM 分拣/深度分析）
 *        → FrontierDeal / FrontierMilestone 等结构化视图
 */

export type FrontierItemSource = 'news' | 'fda' | 'approval' | 'adcom' | 'deal' | 'trial' | 'paper';

export interface ThemeTickerDoc {
    symbol: string;
    company: string;
    tier: 'pure' | 'pharma' | 'tools';
    aliases: string[];
}

export interface IFrontierTheme extends Document {
    key: string;
    name: string;
    nameEn: string;
    description: string;
    keywords: string[];
    trialQuery?: { field: 'query.intr' | 'query.cond'; term: string } | null;
    tickers: ThemeTickerDoc[];
    order: number;
    enabled: boolean;
}

const FrontierThemeSchema = new Schema<IFrontierTheme>(
    {
        key: { type: String, required: true, unique: true, trim: true },
        name: { type: String, required: true, trim: true },
        nameEn: { type: String, default: '' },
        description: { type: String, default: '' },
        keywords: { type: [String], default: [] },
        trialQuery: { type: new Schema({ field: String, term: String }, { _id: false }), default: null },
        tickers: {
            type: [new Schema({
                symbol: { type: String, uppercase: true, trim: true },
                company: String,
                tier: { type: String, enum: ['pure', 'pharma', 'tools'], default: 'pure' },
                aliases: { type: [String], default: [] },
            }, { _id: false })],
            default: [],
        },
        order: { type: Number, default: 0 },
        enabled: { type: Boolean, default: true },
    },
    { timestamps: true },
);

export interface IFrontierItem extends Document {
    source: FrontierItemSource;
    /** 源内稳定标识（RSS guid、申报编号、NCT、FDA 申请号…） */
    externalId: string;
    /** 具体出处（feed 名 / 基金名），展示用 */
    feed: string;
    title: string;
    url?: string;
    /** 源给的摘要片段（截断），分拣用 */
    snippet: string;
    publishedAt?: Date | null;
    fetchedAt: Date;
    ruleThemes: string[];
    ruleTickers: string[];
    /** pending = 等待合并/分拣；clustered = 已归入事件；paper = 论文候选（只进周报，不单独分拣） */
    status: 'pending' | 'clustered' | 'paper';
    eventId?: Types.ObjectId | null;
    raw?: unknown;
}

const FrontierItemSchema = new Schema<IFrontierItem>(
    {
        source: { type: String, required: true },
        externalId: { type: String, required: true },
        feed: { type: String, default: '' },
        title: { type: String, required: true },
        url: { type: String },
        snippet: { type: String, default: '' },
        publishedAt: { type: Date, default: null },
        fetchedAt: { type: Date, required: true },
        ruleThemes: { type: [String], default: [] },
        ruleTickers: { type: [String], default: [] },
        status: { type: String, enum: ['pending', 'clustered', 'paper'], default: 'pending' },
        eventId: { type: Schema.Types.ObjectId, default: null },
        raw: { type: Schema.Types.Mixed },
    },
    { timestamps: true },
);
FrontierItemSchema.index({ source: 1, externalId: 1 }, { unique: true });
FrontierItemSchema.index({ status: 1, fetchedAt: 1 });
FrontierItemSchema.index({ eventId: 1 });

export const FRONTIER_EVENT_TYPES = [
    'approval', 'rejection', 'adcom', 'deal', 'acquisition', 'financing', 'trial-start', 'data',
    'ai-milestone', 'regulatory', 'policy', 'research', 'other',
] as const;
export type FrontierEventType = (typeof FRONTIER_EVENT_TYPES)[number];

export interface FrontierFactDoc {
    text: string;
    quote: string;
    verified: boolean;
}

export interface FrontierBeneficiaryDoc {
    symbol: string;
    name: string;
    relation: 'direct' | 'indirect' | 'hurt';
    reason: string;
}

export interface FrontierAnalysisDoc {
    summary: string;
    facts: FrontierFactDoc[];
    interpretation: string;
    stance: 'bullish' | 'bearish' | 'mixed' | 'neutral';
    beneficiaries: FrontierBeneficiaryDoc[];
    glossary: Array<{ term: string; explain: string }>;
    /** 分析所依据的原文是否抓到了（false = 只看了标题和摘要） */
    fullText: boolean;
}

export interface FrontierSourceRef {
    source: FrontierItemSource;
    feed: string;
    title: string;
    url?: string;
    publishedAt?: Date | null;
}

export interface IFrontierEvent extends Document {
    title: string;
    titleZh: string;
    eventType: FrontierEventType;
    themes: string[];
    tickers: string[];
    /** 1–5；null = 尚未分拣 */
    importance: number | null;
    /** 分拣时的一句话理由 */
    why: string;
    /** llm = LLM 分拣；rule = 未配置 LLM 或额度用尽时按规则兜底 */
    triageMode: 'llm' | 'rule';
    sources: FrontierSourceRef[];
    sourceCount: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
    /** 最早的源发布时间（推送时效判断） */
    publishedAt?: Date | null;
    analysis?: FrontierAnalysisDoc | null;
    analyzedAt?: Date | null;
    /** 深度分析失败次数（LLM 出错/回复无法解析），到上限就放弃 */
    analysisAttempts: number;
    pushedAt?: Date | null;
    digestedAt?: Date | null;
    /** 受益/受损标的已记入信号账本 */
    signalsRecorded: boolean;
    /** 用户标记"不相关"后隐藏 */
    dismissed: boolean;
    milestoneIds: Types.ObjectId[];
}

const FrontierEventSchema = new Schema<IFrontierEvent>(
    {
        title: { type: String, required: true },
        titleZh: { type: String, default: '' },
        eventType: { type: String, enum: FRONTIER_EVENT_TYPES, default: 'other' },
        themes: { type: [String], default: [] },
        tickers: { type: [String], default: [] },
        importance: { type: Number, default: null },
        why: { type: String, default: '' },
        triageMode: { type: String, enum: ['llm', 'rule'], default: 'llm' },
        sources: {
            type: [new Schema({
                source: String, feed: String, title: String, url: String, publishedAt: Date,
            }, { _id: false })],
            default: [],
        },
        sourceCount: { type: Number, default: 1 },
        firstSeenAt: { type: Date, required: true },
        lastSeenAt: { type: Date, required: true },
        publishedAt: { type: Date, default: null },
        analysis: { type: Schema.Types.Mixed, default: null },
        analyzedAt: { type: Date, default: null },
        analysisAttempts: { type: Number, default: 0 },
        pushedAt: { type: Date, default: null },
        digestedAt: { type: Date, default: null },
        signalsRecorded: { type: Boolean, default: false },
        dismissed: { type: Boolean, default: false },
        milestoneIds: { type: [Schema.Types.ObjectId], default: [] },
    },
    { timestamps: true },
);
FrontierEventSchema.index({ firstSeenAt: -1 });
FrontierEventSchema.index({ themes: 1, firstSeenAt: -1 });
FrontierEventSchema.index({ importance: 1, analyzedAt: 1 });

export interface DealAmountDoc {
    /** 原文写法，如 "$1.2 billion" */
    text: string;
    usd: number | null;
    /** 原文里确实找到了这个金额 */
    verified: boolean;
}

export interface IFrontierDeal extends Document {
    eventId: Types.ObjectId;
    date: Date;
    dealType: 'license' | 'collaboration' | 'acquisition' | 'option' | 'other';
    buyer: string;
    seller: string;
    buyerSymbol?: string | null;
    sellerSymbol?: string | null;
    asset: string;
    themes: string[];
    upfront?: DealAmountDoc | null;
    total?: DealAmountDoc | null;
    summary: string;
    url?: string;
}

const AmountSchema = new Schema({ text: String, usd: Number, verified: Boolean }, { _id: false });

const FrontierDealSchema = new Schema<IFrontierDeal>(
    {
        eventId: { type: Schema.Types.ObjectId, required: true, unique: true },
        date: { type: Date, required: true },
        dealType: { type: String, enum: ['license', 'collaboration', 'acquisition', 'option', 'other'], default: 'other' },
        buyer: { type: String, default: '' },
        seller: { type: String, default: '' },
        buyerSymbol: { type: String, default: null },
        sellerSymbol: { type: String, default: null },
        asset: { type: String, default: '' },
        themes: { type: [String], default: [] },
        upfront: { type: AmountSchema, default: null },
        total: { type: AmountSchema, default: null },
        summary: { type: String, default: '' },
        url: { type: String },
    },
    { timestamps: true },
);
FrontierDealSchema.index({ date: -1 });

export interface MilestoneRegistryDoc {
    maxPhase: number;
    leadStatus: string | null;
    nextReadout: string | null;
    trialCount: number;
    nctIds: string[];
    checkedAt: Date;
}

export interface MilestoneHistoryDoc {
    at: Date;
    kind: 'phase' | 'event' | 'note';
    text: string;
    url?: string;
}

export interface MilestoneProposalDoc {
    _id: Types.ObjectId;
    text: string;
    eventId?: Types.ObjectId | null;
    url?: string;
    createdAt: Date;
}

export interface IFrontierMilestone extends Document {
    drug: string;
    aliases: string[];
    company: string;
    symbol?: string | null;
    approach: string;
    indication: string;
    /** proposed = AI 从新闻里发现的候选，等用户确认 */
    status: 'active' | 'proposed' | 'archived';
    source: 'seed' | 'manual' | 'ai';
    registry?: MilestoneRegistryDoc | null;
    history: MilestoneHistoryDoc[];
    proposals: MilestoneProposalDoc[];
}

const FrontierMilestoneSchema = new Schema<IFrontierMilestone>(
    {
        drug: { type: String, required: true, unique: true, trim: true },
        aliases: { type: [String], default: [] },
        company: { type: String, default: '' },
        symbol: { type: String, default: null },
        approach: { type: String, default: '' },
        indication: { type: String, default: '' },
        status: { type: String, enum: ['active', 'proposed', 'archived'], default: 'active' },
        source: { type: String, enum: ['seed', 'manual', 'ai'], default: 'manual' },
        registry: {
            type: new Schema({
                maxPhase: Number, leadStatus: String, nextReadout: String, trialCount: Number,
                nctIds: [String], checkedAt: Date,
            }, { _id: false }),
            default: null,
        },
        history: {
            type: [new Schema({ at: Date, kind: String, text: String, url: String }, { _id: false })],
            default: [],
        },
        proposals: {
            type: [new Schema({
                text: String, eventId: { type: Schema.Types.ObjectId, default: null }, url: String, createdAt: Date,
            })],
            default: [],
        },
    },
    { timestamps: true },
);

export interface IFrontierConference extends Document {
    name: string;
    startDate: string;
    precision: 'day' | 'month';
    dateText: string;
    themes: string[];
    note: string;
    /** 用户核对过官网日期 */
    verified: boolean;
}

const FrontierConferenceSchema = new Schema<IFrontierConference>(
    {
        name: { type: String, required: true, trim: true },
        startDate: { type: String, required: true },
        precision: { type: String, enum: ['day', 'month'], default: 'month' },
        dateText: { type: String, default: '' },
        themes: { type: [String], default: [] },
        note: { type: String, default: '' },
        verified: { type: Boolean, default: false },
    },
    { timestamps: true },
);
FrontierConferenceSchema.index({ name: 1, startDate: 1 }, { unique: true });

export interface FundChangeDoc {
    issuer: string;
    cusip: string;
    symbol?: string | null;
    change: 'new' | 'add' | 'trim' | 'exit';
    value: number;
    prevValue: number;
    shares: number;
    prevShares: number;
}

export interface IFrontierFund extends Document {
    cik: string;
    name: string;
    /** 报告期（季度末） */
    period: string;
    prevPeriod: string | null;
    accession: string;
    filedAt: string;
    totalValue: number;
    holdingsCount: number;
    changes: FundChangeDoc[];
    checkedAt: Date;
}

const FrontierFundSchema = new Schema<IFrontierFund>(
    {
        cik: { type: String, required: true, unique: true },
        name: { type: String, required: true },
        period: { type: String, default: '' },
        prevPeriod: { type: String, default: null },
        accession: { type: String, default: '' },
        filedAt: { type: String, default: '' },
        totalValue: { type: Number, default: 0 },
        holdingsCount: { type: Number, default: 0 },
        changes: {
            type: [new Schema({
                issuer: String, cusip: String, symbol: String, change: String,
                value: Number, prevValue: Number, shares: Number, prevShares: Number,
            }, { _id: false })],
            default: [],
        },
        checkedAt: { type: Date },
    },
    { timestamps: true },
);

export interface IFrontierReport extends Document {
    week: string;
    subject: string;
    text: string;
}

const FrontierReportSchema = new Schema<IFrontierReport>(
    {
        week: { type: String, required: true, unique: true },
        subject: { type: String, default: '' },
        text: { type: String, default: '' },
    },
    { timestamps: true },
);

export const FrontierTheme: Model<IFrontierTheme> =
    (models?.FrontierTheme as Model<IFrontierTheme>) || model<IFrontierTheme>('FrontierTheme', FrontierThemeSchema);
export const FrontierItem: Model<IFrontierItem> =
    (models?.FrontierItem as Model<IFrontierItem>) || model<IFrontierItem>('FrontierItem', FrontierItemSchema);
export const FrontierEvent: Model<IFrontierEvent> =
    (models?.FrontierEvent as Model<IFrontierEvent>) || model<IFrontierEvent>('FrontierEvent', FrontierEventSchema);
export const FrontierDeal: Model<IFrontierDeal> =
    (models?.FrontierDeal as Model<IFrontierDeal>) || model<IFrontierDeal>('FrontierDeal', FrontierDealSchema);
export const FrontierMilestone: Model<IFrontierMilestone> =
    (models?.FrontierMilestone as Model<IFrontierMilestone>) ||
    model<IFrontierMilestone>('FrontierMilestone', FrontierMilestoneSchema);
export const FrontierConference: Model<IFrontierConference> =
    (models?.FrontierConference as Model<IFrontierConference>) ||
    model<IFrontierConference>('FrontierConference', FrontierConferenceSchema);
export const FrontierFund: Model<IFrontierFund> =
    (models?.FrontierFund as Model<IFrontierFund>) || model<IFrontierFund>('FrontierFund', FrontierFundSchema);
export const FrontierReport: Model<IFrontierReport> =
    (models?.FrontierReport as Model<IFrontierReport>) || model<IFrontierReport>('FrontierReport', FrontierReportSchema);
