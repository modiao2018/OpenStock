import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface DashboardConfigDoc extends Document {
    userId: string;
    // Selected symbols from lib/dashboard-catalog.ts; industries derive from the catalog
    symbols: string[];
    updatedAt: Date;
}

const DashboardConfigSchema = new Schema<DashboardConfigDoc>(
    {
        userId: { type: String, required: true, unique: true, index: true },
        symbols: { type: [String], required: true, default: [] },
    },
    { timestamps: { createdAt: false, updatedAt: true } }
);

export const DashboardConfig: Model<DashboardConfigDoc> =
    (models?.DashboardConfig as Model<DashboardConfigDoc>) ||
    model<DashboardConfigDoc>('DashboardConfig', DashboardConfigSchema);
