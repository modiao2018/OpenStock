import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * Finnhub profile2 payload per symbol, persisted so cold starts only spend
 * rate limit on quotes. Name/industry/logo are effectively static and market
 * cap moves slowly, so a day-old row is good enough for sizing a heatmap tile.
 * An empty profile (ETFs, funds) is stored too, so a symbol Finnhub has no
 * data for is not re-queried every sweep.
 */
export interface ICompanyProfile extends Document {
    symbol: string;
    name: string;
    ticker: string;
    currency: string;
    exchange: string;
    logo: string;
    /** Raw Finnhub value: millions, in the primary listing's currency */
    marketCapitalization: number;
    finnhubIndustry: string;
    /** When the row was last refreshed from Finnhub */
    fetchedAt: Date;
}

const CompanyProfileSchema = new Schema<ICompanyProfile>(
    {
        symbol: { type: String, required: true, unique: true },
        name: { type: String, default: '' },
        ticker: { type: String, default: '' },
        currency: { type: String, default: '' },
        exchange: { type: String, default: '' },
        logo: { type: String, default: '' },
        marketCapitalization: { type: Number, default: 0 },
        finnhubIndustry: { type: String, default: '' },
        fetchedAt: { type: Date, required: true },
    },
    { timestamps: false, minimize: false }
);

export const CompanyProfile: Model<ICompanyProfile> =
    (models?.CompanyProfile as Model<ICompanyProfile>) || model<ICompanyProfile>('CompanyProfile', CompanyProfileSchema);
