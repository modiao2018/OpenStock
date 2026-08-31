import { Schema, model, models, type Document, type Model } from 'mongoose';

// Generic last-known-good payload store so pages can render instantly from
// the previous fetch and refresh asynchronously (e.g. heatmap, watchlist)
export interface SnapshotItem extends Document {
    key: string;
    data: unknown;
    updatedAt: Date;
}

const SnapshotSchema = new Schema<SnapshotItem>(
    {
        key: { type: String, required: true, unique: true },
        data: { type: Schema.Types.Mixed, required: true },
    },
    { timestamps: { createdAt: false, updatedAt: true }, minimize: false }
);

export const Snapshot: Model<SnapshotItem> =
    (models?.Snapshot as Model<SnapshotItem>) || model<SnapshotItem>('Snapshot', SnapshotSchema);
