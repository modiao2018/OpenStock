import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * 外部资源（API/网站）调用统计：每资源一个文档，web 与 monitor 共同写入，
 * /status 页读取。小时桶用于近 24h 成功率/延迟，由 sources 采集器定期清理。
 */

export interface SourceHourBucket {
    ok: number;
    fail: number;
    latencySum: number;
}

export interface ISourceStats extends Document {
    /** 资源 id（sources-registry），动态子源形如 rss:<slug> */
    source: string;
    totalOk: number;
    totalFail: number;
    consecutiveFails: number;
    lastOkAt: Date | null;
    lastFailAt: Date | null;
    lastLatencyMs: number | null;
    lastError: { at: Date; message: string } | null;
    /** key 形如 2026-09-02T13（UTC 小时，无点号，可做 Mongo 字段名） */
    hours: Record<string, SourceHourBucket>;
    lastProbe: { at: Date; ok: boolean; latencyMs: number; error?: string } | null;
    updatedAt: Date;
}

const SourceStatsSchema = new Schema<ISourceStats>(
    {
        source: { type: String, required: true, unique: true },
        totalOk: { type: Number, default: 0 },
        totalFail: { type: Number, default: 0 },
        consecutiveFails: { type: Number, default: 0 },
        lastOkAt: { type: Date, default: null },
        lastFailAt: { type: Date, default: null },
        lastLatencyMs: { type: Number, default: null },
        lastError: { type: Schema.Types.Mixed, default: null },
        hours: { type: Schema.Types.Mixed, default: {} },
        lastProbe: { type: Schema.Types.Mixed, default: null },
    },
    { timestamps: true, minimize: false }
);

export const SourceStats: Model<ISourceStats> =
    (models?.SourceStats as Model<ISourceStats>) || model<ISourceStats>('SourceStats', SourceStatsSchema);
