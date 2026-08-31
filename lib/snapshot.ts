import { createHash } from 'node:crypto';
import { connectToDatabase } from '@/database/mongoose';
import { Snapshot } from '@/database/models/snapshot.model';

export function snapshotKey(prefix: string, symbols: string[]): string {
    const hash = createHash('sha1').update([...symbols].sort().join(',')).digest('hex');
    return `${prefix}:${hash}`;
}

export async function readSnapshot<T>(key: string): Promise<{ data: T; updatedAt: Date } | null> {
    try {
        await connectToDatabase();
        const doc = await Snapshot.findOne({ key }).lean();
        if (!doc) return null;
        return { data: doc.data as T, updatedAt: doc.updatedAt };
    } catch (e) {
        console.error('readSnapshot failed for', key, e);
        return null;
    }
}

// Fire-and-forget safe: never throws
export async function writeSnapshot(key: string, data: unknown): Promise<void> {
    try {
        await connectToDatabase();
        await Snapshot.updateOne({ key }, { $set: { data } }, { upsert: true });
    } catch (e) {
        console.error('writeSnapshot failed for', key, e);
    }
}
