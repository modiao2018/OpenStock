import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface NewsTranslationItem extends Document {
    // sha256(url + '|' + headline); the article id from formatArticle is not stable
    key: string;
    lang: string;
    headline: string;
    summary: string;
    createdAt: Date;
}

const NewsTranslationSchema = new Schema<NewsTranslationItem>(
    {
        key: { type: String, required: true, unique: true },
        lang: { type: String, required: true, default: 'zh-CN' },
        headline: { type: String, required: true },
        summary: { type: String, required: true },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

// Articles fall out of the 5-day news window quickly; 60 days keeps the
// collection bounded while ensuring each article is translated only once
NewsTranslationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 86400 });

export const NewsTranslation: Model<NewsTranslationItem> =
    (models?.NewsTranslation as Model<NewsTranslationItem>) ||
    model<NewsTranslationItem>('NewsTranslation', NewsTranslationSchema);
