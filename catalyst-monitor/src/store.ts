import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { connectToDatabase } from '@/database/mongoose';
import { CatalystEvent, CatalystTrial, CatalystKv, CatalystWatchItem } from '@/database/models/catalyst.model';
import { log } from './config';
import type { NewEvent, StoredEvent, WatchItem } from './types';

export function sha256(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export interface TrialSnapshot {
  nctId: string;
  symbol: string;
  title: string;
  overallStatus: string;
  phase: string;
  primaryCompletionDate?: string;
  completionDate?: string;
  lastUpdatePostDate?: string;
  hasResults: boolean;
}

/**
 * 幂等入库：同 (source, externalId, contentHash) 已存在则返回 null。
 * 返回的 isFirstSnapshot 表示这是该实体第一次入库（建档，不该推送）。
 */
export async function insertEvent(ev: NewEvent): Promise<StoredEvent | null> {
  await connectToDatabase();
  const seenBefore = await CatalystEvent.exists({ source: ev.source, externalId: ev.externalId });

  const fetchedAt = new Date();
  try {
    const doc = await CatalystEvent.create({
      source: ev.source,
      externalId: ev.externalId,
      symbol: ev.symbol,
      title: ev.title,
      url: ev.url,
      publishedAt: ev.publishedAt,
      fetchedAt,
      contentHash: ev.contentHash,
      severity: ev.severity,
      raw: ev.raw,
      firstSnapshot: !seenBefore,
    });
    return {
      ...ev,
      id: String(doc._id),
      fetchedAt: fetchedAt.toISOString(),
      isFirstSnapshot: !seenBefore,
    };
  } catch (err: unknown) {
    // 唯一索引冲突 = 已见过、无变化
    if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) return null;
    throw err;
  }
}

export async function markNotified(id: string): Promise<void> {
  await CatalystEvent.updateOne({ _id: id }, { $set: { notified: true } });
}

export async function setEventAnalysis(id: string, analysis: string): Promise<void> {
  await CatalystEvent.updateOne({ _id: id }, { $set: { analysis } });
}

export async function upsertTrial(t: TrialSnapshot): Promise<void> {
  await connectToDatabase();
  await CatalystTrial.findOneAndUpdate({ nctId: t.nctId }, { $set: t }, { upsert: true });
}

export async function listTrials(): Promise<TrialSnapshot[]> {
  await connectToDatabase();
  const docs = await CatalystTrial.find().sort({ primaryCompletionDate: 1 }).lean();
  return docs.map((d) => ({
    nctId: d.nctId,
    symbol: d.symbol,
    title: d.title,
    overallStatus: d.overallStatus,
    phase: d.phase,
    primaryCompletionDate: d.primaryCompletionDate ?? undefined,
    completionDate: d.completionDate ?? undefined,
    lastUpdatePostDate: d.lastUpdatePostDate ?? undefined,
    hasResults: d.hasResults,
  }));
}

export async function getKv(key: string, maxAgeMs?: number): Promise<string | null> {
  await connectToDatabase();
  const doc = await CatalystKv.findOne({ key }).lean();
  if (!doc) return null;
  if (maxAgeMs !== undefined && Date.now() - new Date(doc.updatedAt).getTime() > maxAgeMs) return null;
  return doc.value;
}

export async function setKv(key: string, value: string): Promise<void> {
  await connectToDatabase();
  await CatalystKv.findOneAndUpdate({ key }, { $set: { value } }, { upsert: true });
}

/** 监控清单以数据库为准（网页端可改）；config.yaml 仅用于首次迁移种子 */
export async function getWatchItems(): Promise<WatchItem[]> {
  await connectToDatabase();
  const docs = await CatalystWatchItem.find().lean();
  return docs.map((d) => ({
    symbol: d.symbol,
    company: d.company,
    nctIds: d.nctIds ?? [],
    keywords: d.keywords ?? [],
  }));
}

export async function seedWatchItems(items: WatchItem[]): Promise<void> {
  await connectToDatabase();
  for (const item of items) {
    await CatalystWatchItem.findOneAndUpdate({ symbol: item.symbol }, { $set: item }, { upsert: true });
  }
}

export async function closeStore(): Promise<void> {
  await mongoose.disconnect();
  log('store', 'database disconnected');
}
