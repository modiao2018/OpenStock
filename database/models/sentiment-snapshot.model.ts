import { Schema, model, models, type Document, type Model } from 'mongoose';

import type { StockSentimentInsights } from '@/lib/actions/adanos.helpers';

/**
 * Adanos 情绪快照缓存：每个 symbol 一份，跨进程/跨部署共享，
 * 让免费版 250 次/月的额度撑得住。`insights` 为 null 表示上游没有该标的的数据，
 * 同样缓存以免每次打开页面都重试。
 */
export interface ISentimentSnapshot extends Document {
    symbol: string;
    insights: StockSentimentInsights | null;
    // 本次抓取覆盖了哪些来源（受 ADANOS_SOURCES 控制）
    sources: string[];
    fetchedAt: Date;
}

const SentimentSnapshotSchema = new Schema<ISentimentSnapshot>(
    {
        symbol: { type: String, required: true, unique: true },
        insights: { type: Schema.Types.Mixed, default: null },
        sources: { type: [String], default: [] },
        fetchedAt: { type: Date, required: true },
    },
    { timestamps: false, minimize: false }
);

// Snapshots older than the free tier's 30-day history window are useless
// even as a stale fallback
SentimentSnapshotSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 30 * 86400 });

export const SentimentSnapshot: Model<ISentimentSnapshot> =
    (models?.SentimentSnapshot as Model<ISentimentSnapshot>) ||
    model<ISentimentSnapshot>('SentimentSnapshot', SentimentSnapshotSchema);
