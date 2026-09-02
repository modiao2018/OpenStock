import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * 内部人（Form 3/4/5）公开市场买卖记录与每股最近一次 AI 洞察。
 * 由 catalyst-monitor 的 insider 采集器写入，网页端 /ai-dips 只读。
 */

export interface IInsiderTrade extends Document {
    symbol: string;
    /** sha256(txExternalKey)，同一笔申报只入库一次 */
    externalId: string;
    /** 申报的内部人姓名 */
    name: string;
    transactionCode: 'P' | 'S';
    /** 股数变动：买入为正，卖出为负 */
    change: number;
    /** 申报均价；0 = 申报未填价 */
    transactionPrice: number;
    /** |change| * price；价格未知时为 null */
    amountUsd: number | null;
    /** YYYY-MM-DD */
    transactionDate: string;
    /** YYYY-MM-DD；Form 4 有 T+2 申报延迟 */
    filingDate: string;
    notified: boolean;
    /** 首轮建档的存量记录（不推送） */
    firstSeen: boolean;
    createdAt: Date;
}

const InsiderTradeSchema = new Schema<IInsiderTrade>(
    {
        symbol: { type: String, required: true, uppercase: true, trim: true },
        externalId: { type: String, required: true },
        name: { type: String, required: true },
        transactionCode: { type: String, enum: ['P', 'S'], required: true },
        change: { type: Number, required: true },
        transactionPrice: { type: Number, required: true },
        amountUsd: { type: Number, default: null },
        transactionDate: { type: String, required: true },
        filingDate: { type: String, required: true },
        notified: { type: Boolean, default: false },
        firstSeen: { type: Boolean, default: false },
    },
    { timestamps: true }
);
// 幂等入库：同一笔申报只存一次
InsiderTradeSchema.index({ externalId: 1 }, { unique: true });
InsiderTradeSchema.index({ symbol: 1, transactionDate: -1 });
// 页面只用 90 天，180 天后自动清理，集合有界
InsiderTradeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86400 });

export interface IInsiderInsight extends Document {
    symbol: string;
    /** LLM 中文分析，结尾含「操作建议：X」 */
    analysis: string;
    /** 从分析中提取的操作评级（买入/观望…），页面徽标用 */
    action: string | null;
    /** 触发本次分析的交易摘要 */
    trigger: string;
    updatedAt: Date;
}

const InsiderInsightSchema = new Schema<IInsiderInsight>(
    {
        symbol: { type: String, required: true, unique: true, uppercase: true, trim: true },
        analysis: { type: String, required: true },
        action: { type: String, default: null },
        trigger: { type: String, required: true },
    },
    { timestamps: true }
);

export const InsiderTrade: Model<IInsiderTrade> =
    (models?.InsiderTrade as Model<IInsiderTrade>) || model<IInsiderTrade>('InsiderTrade', InsiderTradeSchema);
export const InsiderInsight: Model<IInsiderInsight> =
    (models?.InsiderInsight as Model<IInsiderInsight>) || model<IInsiderInsight>('InsiderInsight', InsiderInsightSchema);
