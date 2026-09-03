import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * 信号结果账本：每条推送给用户的可交易信号（连跌里程碑、内部人买卖、8-K、
 * 停牌、盘面异动、催化剂提醒…）落一条记录，随后由 outcomes 采集器回补
 * T+1/T+5/T+20 的绝对收益与相对基准的超额收益。/signals 记分卡据此统计
 * 每类信号、每种 AI 操作建议的命中率与平均超额收益。
 *
 * 由 catalyst-monitor 写入，网页端只读。
 */

export type SignalDirection = 'up' | 'down' | 'none';
export type SignalStatus = 'pending' | 'partial' | 'complete' | 'expired';

export interface SignalHorizon {
    /** 该期收盘所在交易日 */
    date: string;
    close: number;
    /** 标的收益 % */
    returnPct: number;
    /** 相对基准的超额收益 %；基准无数据时为 null */
    excessPct: number | null;
}

export interface ISignal extends Document {
    /** 信号类型，如 aidips.milestone / insider.buy / event.edgar */
    kind: string;
    symbol: string;
    /** 同类信号去重键（事件 id、申报日、里程碑+交易日） */
    dedupeKey: string;
    /** 信号隐含的方向：看多 / 看空 / 无方向（仅记录波动） */
    direction: SignalDirection;
    /** LLM 给出的操作建议（买入/观望…），没有则为 null */
    action: string | null;
    title: string;
    /** 推送时刻 */
    firedAt: Date;
    /** 入场交易日（推送在收盘后则顺延到下一交易日），入场价取该日收盘 */
    entryDate: string;
    entryClose: number | null;
    /** 超额收益的基准 ETF（AI 池用 QQQ，医药催化剂用 XBI） */
    benchmark: string;
    benchmarkEntryClose: number | null;
    horizons: {
        t1?: SignalHorizon;
        t5?: SignalHorizon;
        t20?: SignalHorizon;
    };
    status: SignalStatus;
    /** 推送是否实际送达（未送达的也记，供对比） */
    delivered: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const HorizonSchema = new Schema<SignalHorizon>(
    {
        date: { type: String, required: true },
        close: { type: Number, required: true },
        returnPct: { type: Number, required: true },
        excessPct: { type: Number, default: null },
    },
    { _id: false }
);

const SignalSchema = new Schema<ISignal>(
    {
        kind: { type: String, required: true },
        symbol: { type: String, required: true, uppercase: true, trim: true },
        dedupeKey: { type: String, required: true },
        direction: { type: String, enum: ['up', 'down', 'none'], required: true },
        action: { type: String, default: null },
        title: { type: String, required: true },
        firedAt: { type: Date, required: true },
        entryDate: { type: String, required: true },
        entryClose: { type: Number, default: null },
        benchmark: { type: String, required: true },
        benchmarkEntryClose: { type: Number, default: null },
        horizons: {
            t1: { type: HorizonSchema, default: undefined },
            t5: { type: HorizonSchema, default: undefined },
            t20: { type: HorizonSchema, default: undefined },
        },
        status: { type: String, enum: ['pending', 'partial', 'complete', 'expired'], default: 'pending' },
        delivered: { type: Boolean, default: false },
    },
    { timestamps: true, minimize: false }
);

SignalSchema.index({ kind: 1, symbol: 1, dedupeKey: 1 }, { unique: true });
SignalSchema.index({ status: 1, entryDate: 1 });
SignalSchema.index({ firedAt: -1 });

export const Signal: Model<ISignal> = (models?.Signal as Model<ISignal>) || model<ISignal>('Signal', SignalSchema);
