import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface DashboardCustomStockDoc {
    symbol: string;
    // finnhubIndustry from the company profile when the stock was added
    industry: string;
    name: string;
}

export interface DashboardConfigDoc extends Document {
    userId: string;
    // Selected symbols; must exist in the user's catalog (master catalog in
    // lib/dashboard-catalog.ts, minus `removed`, plus `added`)
    symbols: string[];
    // Stocks the user searched for and added to the picker
    added: DashboardCustomStockDoc[];
    // Master-catalog symbols the user removed from the picker
    removed: string[];
    updatedAt: Date;
}

const DashboardConfigSchema = new Schema<DashboardConfigDoc>(
    {
        userId: { type: String, required: true, unique: true, index: true },
        symbols: { type: [String], required: true, default: [] },
        added: {
            type: [
                new Schema<DashboardCustomStockDoc>(
                    {
                        symbol: { type: String, required: true },
                        industry: { type: String, default: '' },
                        name: { type: String, default: '' },
                    },
                    { _id: false },
                ),
            ],
            default: [],
        },
        removed: { type: [String], default: [] },
    },
    { timestamps: { createdAt: false, updatedAt: true } }
);

export const DashboardConfig: Model<DashboardConfigDoc> =
    (models?.DashboardConfig as Model<DashboardConfigDoc>) ||
    model<DashboardConfigDoc>('DashboardConfig', DashboardConfigSchema);
