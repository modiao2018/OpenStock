import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { connectToDatabase } from '@/database/mongoose';
import { CatalystBar, CatalystEvent, CatalystTrial, CatalystKv, CatalystWatchItem } from '@/database/models/catalyst.model';
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

export interface Bar {
  symbol: string;
  t: Date;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** 批量入库分钟 K 线，重复时间戳静默忽略 */
export async function insertBars(bars: Bar[]): Promise<number> {
  if (bars.length === 0) return 0;
  await connectToDatabase();
  try {
    const res = await CatalystBar.insertMany(bars, { ordered: false });
    return res.length;
  } catch (err: unknown) {
    // ordered:false 时重复键错误仍会抛出，但非重复的已写入
    const e = err as { insertedDocs?: unknown[]; code?: number };
    if (e?.insertedDocs) return e.insertedDocs.length;
    if (e?.code === 11000) return 0;
    throw err;
  }
}

export async function getLatestBarTime(symbol: string): Promise<Date | null> {
  await connectToDatabase();
  const doc = await CatalystBar.findOne({ symbol }).sort({ t: -1 }).lean();
  return doc ? new Date(doc.t) : null;
}

export async function getBars(symbol: string, since: Date): Promise<Bar[]> {
  await connectToDatabase();
  const docs = await CatalystBar.find({ symbol, t: { $gte: since } }).sort({ t: 1 }).lean();
  return docs.map((d) => ({ symbol: d.symbol, t: new Date(d.t), o: d.o, h: d.h, l: d.l, c: d.c, v: d.v }));
}

export async function closeStore(): Promise<void> {
  await mongoose.disconnect();
  log('store', 'database disconnected');
}
