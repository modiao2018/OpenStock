import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * AI 低吸股票池（全局单份，网页端管理，daemon 每轮读取）。
 * 首次读取时由 lib/ai-dips-pool.ts 用硬编码目录播种。
 */

export interface IAiDipPoolStock extends Document {
    symbol: string;
    name: string;
    /** 板块 key，同时是 aiDips.subSectors 下的翻译 key */
    subSector: string;
    addedAt: Date;
}

const AiDipPoolStockSchema = new Schema<IAiDipPoolStock>({
    symbol: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    subSector: { type: String, required: true },
    addedAt: { type: Date, default: Date.now },
});

export const AiDipPoolStock: Model<IAiDipPoolStock> =
    (models?.AiDipPoolStock as Model<IAiDipPoolStock>) ||
    model<IAiDipPoolStock>('AiDipPoolStock', AiDipPoolStockSchema);
