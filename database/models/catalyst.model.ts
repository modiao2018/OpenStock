import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * catalyst-monitor 的三张表：事件时间线 / 试验快照 / 采集器缓存。
 * 与主应用共享 MongoDB，但只被 catalyst-monitor 的 daemon 读写。
 */

export interface ICatalystEvent extends Document {
    source: 'clinicaltrials' | 'edgar' | 'halts' | 'rss';
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
}

const CatalystEventSchema = new Schema<ICatalystEvent>(
    {
        source: { type: String, enum: ['clinicaltrials', 'edgar', 'halts', 'rss'], required: true },
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
