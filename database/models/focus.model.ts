import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * 跨模块关注队列：focus 采集器每轮对 AI 池 ∪ 催化剂清单的每只标的算一个
 * 关注分（lib/focus-math），一只一条，整表覆盖。/focus 页与每日摘要读取；
 * 推送闸门（focus-gate）按分数决定非紧急提醒是实时推送还是归入摘要。
 */

export interface FocusFactorDoc {
    id: string;
    group: 'setup' | 'confirm' | 'urgency';
    points: number;
    lean: 'bull' | 'bear' | 'neutral';
    detail?: string;
}

export interface IFocusEntry extends Document {
    symbol: string;
    name: string;
    /** 标的来自哪个清单 */
    universe: 'ai' | 'catalyst' | 'both';
    score: number;
    stance: 'bullish' | 'bearish' | 'mixed' | 'watch';
    bullPoints: number;
    bearPoints: number;
    factors: FocusFactorDoc[];
    caution: 'notPulledBack' | null;
    /** 打分时的行情上下文（页面直接展示，免二次查询） */
    lastClose: number | null;
    streakDays: number | null;
    drawdownFromHighPct: number | null;
    nextCatalyst: { title: string; date: string; days: number } | null;
    /** 已完成交易日（数据口径） */
    sessionDate: string;
    computedAt: Date;
}

const FocusFactorSchema = new Schema<FocusFactorDoc>(
    {
        id: { type: String, required: true },
        group: { type: String, enum: ['setup', 'confirm', 'urgency'], required: true },
        points: { type: Number, required: true },
        lean: { type: String, enum: ['bull', 'bear', 'neutral'], required: true },
        detail: { type: String },
    },
    { _id: false }
);

const FocusEntrySchema = new Schema<IFocusEntry>(
    {
        symbol: { type: String, required: true, unique: true, uppercase: true, trim: true },
        name: { type: String, required: true },
        universe: { type: String, enum: ['ai', 'catalyst', 'both'], required: true },
        score: { type: Number, required: true },
        stance: { type: String, enum: ['bullish', 'bearish', 'mixed', 'watch'], required: true },
        bullPoints: { type: Number, required: true },
        bearPoints: { type: Number, required: true },
        factors: { type: [FocusFactorSchema], default: [] },
        caution: { type: String, default: null },
        lastClose: { type: Number, default: null },
        streakDays: { type: Number, default: null },
        drawdownFromHighPct: { type: Number, default: null },
        nextCatalyst: { type: Schema.Types.Mixed, default: null },
        sessionDate: { type: String, required: true },
        computedAt: { type: Date, required: true },
    },
    { minimize: false }
);
FocusEntrySchema.index({ score: -1 });

export const FocusEntry: Model<IFocusEntry> =
    (models?.FocusEntry as Model<IFocusEntry>) || model<IFocusEntry>('FocusEntry', FocusEntrySchema);

/** 被闸门拦下的非紧急推送，攒到每日摘要里一起发 */
export interface IFocusDigestItem extends Document {
    symbol: string;
    kind: string;
    title: string;
    body: string;
    /** 拦截时该标的的关注分 */
    scoreAtDefer: number;
    createdAt: Date;
    sentAt: Date | null;
}

const FocusDigestItemSchema = new Schema<IFocusDigestItem>(
    {
        symbol: { type: String, required: true, uppercase: true, trim: true },
        kind: { type: String, required: true },
        title: { type: String, required: true },
        body: { type: String, required: true },
        scoreAtDefer: { type: Number, required: true },
        sentAt: { type: Date, default: null },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);
FocusDigestItemSchema.index({ sentAt: 1, createdAt: 1 });
// 摘要只看最近几天，30 天后自动清理
FocusDigestItemSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 });

export const FocusDigestItem: Model<IFocusDigestItem> =
    (models?.FocusDigestItem as Model<IFocusDigestItem>) || model<IFocusDigestItem>('FocusDigestItem', FocusDigestItemSchema);
