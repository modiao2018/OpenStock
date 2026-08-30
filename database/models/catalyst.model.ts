import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * catalyst-monitor 的三张表：事件时间线 / 试验快照 / 采集器缓存。
 * 与主应用共享 MongoDB，但只被 catalyst-monitor 的 daemon 读写。
 */

export interface ICatalystEvent extends Document {
    source: 'clinicaltrials' | 'edgar' | 'halts' | 'rss' | 'market';
    externalId: string;
    symbol?: string;
    title: string;
    url?: string;
    /** 信息源自己声明的发布时间（原样字符串，格式因源而异），用于事后归因 */
    publishedAt?: string;
    /** 我们首次抓到的时间 */
    fetchedAt: Date;
    /** 关键字段哈希；同 externalId 下哈希变化 = 实体发生了更新 */
    contentHash: string;
    severity: 'urgent' | 'normal';
    raw: unknown;
    notified: boolean;
    /** LLM 生成的中文分析（报告类事件） */
    analysis?: string;
    /** 首次建档快照（非真实变更，不推送，时间线上区分显示） */
    firstSnapshot: boolean;
}

const CatalystEventSchema = new Schema<ICatalystEvent>(
    {
        source: { type: String, enum: ['clinicaltrials', 'edgar', 'halts', 'rss', 'market'], required: true },
        externalId: { type: String, required: true },
        symbol: { type: String, uppercase: true, trim: true },
        title: { type: String, required: true },
        url: { type: String },
        publishedAt: { type: String },
        fetchedAt: { type: Date, required: true },
        contentHash: { type: String, required: true },
        severity: { type: String, enum: ['urgent', 'normal'], required: true },
        raw: { type: Schema.Types.Mixed },
        notified: { type: Boolean, default: false },
        analysis: { type: String },
        firstSnapshot: { type: Boolean, default: false },
    },
    { timestamps: true }
);
// 幂等入库的关键：同一实体的同一内容只存一次
CatalystEventSchema.index({ source: 1, externalId: 1, contentHash: 1 }, { unique: true });
CatalystEventSchema.index({ symbol: 1, fetchedAt: 1 });

export interface ICatalystTrial extends Document {
    nctId: string;
    symbol: string;
    title: string;
    overallStatus: string;
    phase: string;
    primaryCompletionDate?: string;
    completionDate?: string;
    lastUpdatePostDate?: string;
    hasResults: boolean;
}

const CatalystTrialSchema = new Schema<ICatalystTrial>(
    {
        nctId: { type: String, required: true, unique: true, uppercase: true, trim: true },
        symbol: { type: String, required: true, uppercase: true, trim: true },
        title: { type: String, required: true },
        overallStatus: { type: String, required: true },
        phase: { type: String, required: true },
        primaryCompletionDate: { type: String },
        completionDate: { type: String },
        lastUpdatePostDate: { type: String },
        hasResults: { type: Boolean, default: false },
    },
    { timestamps: true }
);

/** 监控清单：网页端管理，daemon 每轮采集前读取，改动无需重启 */
export interface ICatalystWatchItem extends Document {
    symbol: string;
    company: string;
    nctIds: string[];
    keywords: string[];
    /** 情景预案：成功/模糊/失败的判据，事件落地时 AI 对档用 */
    scenarioNotes?: string;
    /** 自动发现该公司的在研试验（每 12 小时按主办方查询登记库） */
    autoDiscover: boolean;
}

const CatalystWatchItemSchema = new Schema<ICatalystWatchItem>(
    {
        symbol: { type: String, required: true, unique: true, uppercase: true, trim: true },
        company: { type: String, required: true, trim: true },
        nctIds: { type: [String], default: [] },
        keywords: { type: [String], default: [] },
        scenarioNotes: { type: String },
        autoDiscover: { type: Boolean, default: true },
    },
    { timestamps: true }
);

/** 自定义催化剂：手动添加或由 AI 从公告中抽取的时间指引（PDUFA、数据读出等） */
export interface ICatalystCustomEvent extends Document {
    symbol: string;
    title: string;
    /** YYYY-MM-DD */
    date: string;
    kind: 'data-readout' | 'pdufa' | 'adcom' | 'earnings' | 'conference' | 'other';
    note?: string;
    source: 'manual' | 'auto';
}

const CatalystCustomEventSchema = new Schema<ICatalystCustomEvent>(
    {
        symbol: { type: String, required: true, uppercase: true, trim: true },
        title: { type: String, required: true, trim: true },
        date: { type: String, required: true },
        kind: {
            type: String,
            enum: ['data-readout', 'pdufa', 'adcom', 'earnings', 'conference', 'other'],
            default: 'other',
        },
        note: { type: String },
        source: { type: String, enum: ['manual', 'auto'], default: 'manual' },
    },
    { timestamps: true }
);
CatalystCustomEventSchema.index({ symbol: 1, title: 1, date: 1 }, { unique: true });

/** 分钟 K 线（Alpaca IEX），异动检测的基线与实时数据 */
export interface ICatalystBar extends Document {
    symbol: string;
    t: Date;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
}

const CatalystBarSchema = new Schema<ICatalystBar>({
    symbol: { type: String, required: true, uppercase: true, trim: true },
    t: { type: Date, required: true },
    o: { type: Number, required: true },
    h: { type: Number, required: true },
    l: { type: Number, required: true },
    c: { type: Number, required: true },
    v: { type: Number, required: true },
});
CatalystBarSchema.index({ symbol: 1, t: 1 }, { unique: true });

export interface ICatalystKv extends Document {
    key: string;
    value: string;
    updatedAt: Date;
}

const CatalystKvSchema = new Schema<ICatalystKv>(
    {
        key: { type: String, required: true, unique: true },
        value: { type: String, required: true },
    },
    { timestamps: true }
);

export const CatalystEvent: Model<ICatalystEvent> =
    (models?.CatalystEvent as Model<ICatalystEvent>) || model<ICatalystEvent>('CatalystEvent', CatalystEventSchema);
export const CatalystTrial: Model<ICatalystTrial> =
    (models?.CatalystTrial as Model<ICatalystTrial>) || model<ICatalystTrial>('CatalystTrial', CatalystTrialSchema);
export const CatalystKv: Model<ICatalystKv> =
    (models?.CatalystKv as Model<ICatalystKv>) || model<ICatalystKv>('CatalystKv', CatalystKvSchema);
export const CatalystCustomEvent: Model<ICatalystCustomEvent> =
    (models?.CatalystCustomEvent as Model<ICatalystCustomEvent>) ||
    model<ICatalystCustomEvent>('CatalystCustomEvent', CatalystCustomEventSchema);
export const CatalystBar: Model<ICatalystBar> =
    (models?.CatalystBar as Model<ICatalystBar>) || model<ICatalystBar>('CatalystBar', CatalystBarSchema);
export const CatalystWatchItem: Model<ICatalystWatchItem> =
    (models?.CatalystWatchItem as Model<ICatalystWatchItem>) ||
    model<ICatalystWatchItem>('CatalystWatchItem', CatalystWatchItemSchema);
