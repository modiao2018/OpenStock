import { Schema, model, models, type Document, type Model } from 'mongoose';
import type { ThesisDirection, ThesisFraming, ThesisOutcome, ThesisStatus, ThesisTriggerId } from '@/lib/thesis-math';

/**
 * 短期洞察跟进：用户临时看上某只标的，把"为什么关注、想怎么做"写下来，
 * 监控 daemon 的 thesis 采集器据此跟进（触及目标/失效价、到期、新事件、
 * 大幅波动、定期回顾），合适的时候推送提醒；用户随时可在网页关闭。
 * 网页端（/focus、个股页）读写，daemon 只追加跟进记录和改状态。
 */

export interface ThesisFollowup {
    at: Date;
    /** 本次提醒的触发原因（按优先级排列） */
    triggers: ThesisTriggerId[];
    price: number | null;
    /** AI 对照用户思考给出的中文点评；LLM 未配置时为状态行 */
    note: string;
    delivered: boolean;
}

export interface IThesis extends Document {
    userId: string;
    symbol: string;
    name: string;
    direction: ThesisDirection;
    /** 用户写下的思考（为什么关注、看到了什么、打算怎么做）——可以只是一个方向或点子 */
    note: string;
    /** AI 把点子梳理成的可检验框架；LLM 未配置或失败时为 null，daemon 会补 */
    framing: ThesisFraming | null;
    /** 记录时的价格（跟进时算涨跌幅用） */
    entryPrice: number | null;
    targetPrice: number | null;
    /** 失效价：观点被证伪的价格（看多=止损位，看空=空头止损位） */
    stopPrice: number | null;
    /** YYYY-MM-DD 截止日，过期自动做最终回顾并结束 */
    horizonDate: string;
    /** 多少天没有动静就提醒回顾一次；0 = 不做定期回顾 */
    checkinDays: number;
    /** 较上次提醒波动超过该百分比即提醒 */
    movePct: number;
    status: ThesisStatus;
    outcome: ThesisOutcome | null;
    /** 关闭时用户填的结语（可选） */
    closingNote: string | null;
    closedAt: Date | null;
    /** 只提醒一次的触发器 */
    hits: { target?: boolean; stop?: boolean; horizonSoon?: boolean };
    followups: ThesisFollowup[];
    /** 上次跟进检查时间（新事件窗口的起点） */
    lastCheckedAt: Date | null;
    lastAlertPrice: number | null;
    createdAt: Date;
    updatedAt: Date;
}

const FollowupSchema = new Schema<ThesisFollowup>(
    {
        at: { type: Date, required: true },
        triggers: { type: [String], default: [] },
        price: { type: Number, default: null },
        note: { type: String, required: true },
        delivered: { type: Boolean, default: false },
    },
    { _id: false }
);

const ThesisSchema = new Schema<IThesis>(
    {
        userId: { type: String, required: true },
        symbol: { type: String, required: true, uppercase: true, trim: true },
        name: { type: String, required: true, trim: true },
        direction: { type: String, enum: ['long', 'short', 'watch'], required: true },
        note: { type: String, required: true },
        framing: { type: Schema.Types.Mixed, default: null },
        entryPrice: { type: Number, default: null },
        targetPrice: { type: Number, default: null },
        stopPrice: { type: Number, default: null },
        horizonDate: { type: String, required: true },
        checkinDays: { type: Number, required: true },
        movePct: { type: Number, required: true },
        status: { type: String, enum: ['active', 'closed', 'expired'], default: 'active' },
        outcome: { type: String, enum: ['confirmed', 'refuted', 'abandoned'], default: null },
        closingNote: { type: String, default: null },
        closedAt: { type: Date, default: null },
        hits: { type: Schema.Types.Mixed, default: {} },
        followups: { type: [FollowupSchema], default: [] },
        lastCheckedAt: { type: Date, default: null },
        lastAlertPrice: { type: Number, default: null },
    },
    { timestamps: true, minimize: false }
);
ThesisSchema.index({ status: 1, symbol: 1 });
ThesisSchema.index({ userId: 1, status: 1, createdAt: -1 });

export const Thesis: Model<IThesis> = (models?.Thesis as Model<IThesis>) || model<IThesis>('Thesis', ThesisSchema);
