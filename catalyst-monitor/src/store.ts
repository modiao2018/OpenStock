import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { connectToDatabase } from '@/database/mongoose';
import {
  CatalystBar,
  CatalystCustomEvent,
  CatalystEvent,
  CatalystTrial,
  CatalystKv,
  CatalystWatchItem,
} from '@/database/models/catalyst.model';
import { log } from './config';
import type { NewEvent, StoredEvent, WatchItem } from './types';
import { anchorDate, inferPrecision, parseLegacyNote, type DatePrecision } from './guidance-dates';

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
      // archival 显式指定时以它为准（回补的旧申报标记为建档、实时申报不标记）
      firstSnapshot: ev.archival ?? !seenBefore,
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

/** 该实体最近一次入库的 raw（变更检测用：只比较关心的字段，不比哈希） */
export async function latestEventRaw(source: NewEvent['source'], externalId: string): Promise<unknown | null> {
  await connectToDatabase();
  const doc = await CatalystEvent.findOne({ source, externalId }).sort({ fetchedAt: -1 }).select({ raw: 1 }).lean();
  return doc?.raw ?? null;
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

/** 缺少中文标题的试验（AI 翻译用），限量避免单轮 LLM 过载 */
export async function listTrialsMissingZh(limit = 20): Promise<Array<{ nctId: string; title: string }>> {
  await connectToDatabase();
  const docs = await CatalystTrial.find({ $or: [{ titleZh: null }, { titleZh: { $exists: false } }] })
    .limit(limit)
    .lean();
  return docs.map((d) => ({ nctId: d.nctId, title: d.title }));
}

export async function setTrialTitleZh(nctId: string, titleZh: string): Promise<void> {
  await CatalystTrial.updateOne({ nctId }, { $set: { titleZh } });
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
    scenarioNotes: d.scenarioNotes ?? undefined,
    autoDiscover: d.autoDiscover ?? true,
  }));
}

/** 自动发现的新试验并入监控清单（不移除用户手选的） */
export async function addNctIdsToWatchItem(symbol: string, nctIds: string[]): Promise<void> {
  await connectToDatabase();
  await CatalystWatchItem.updateOne({ symbol }, { $addToSet: { nctIds: { $each: nctIds } } });
}

export async function seedWatchItems(items: WatchItem[]): Promise<void> {
  await connectToDatabase();
  for (const item of items) {
    await CatalystWatchItem.findOneAndUpdate({ symbol: item.symbol }, { $set: item }, { upsert: true });
  }
}

export interface RecentEvent {
  source: string;
  symbol?: string;
  title: string;
  severity: string;
  fetchedAt: Date;
  analysis?: string;
  firstSnapshot: boolean;
}

export async function getRecentEvents(since: Date): Promise<RecentEvent[]> {
  await connectToDatabase();
  const docs = await CatalystEvent.find({ fetchedAt: { $gte: since } }).sort({ fetchedAt: -1 }).lean();
  return docs.map((d) => ({
    source: d.source,
    symbol: d.symbol ?? undefined,
    title: d.title,
    severity: d.severity,
    fetchedAt: new Date(d.fetchedAt),
    analysis: d.analysis ?? undefined,
    firstSnapshot: d.firstSnapshot ?? false,
  }));
}

export interface CustomEventInput {
  symbol: string;
  title: string;
  date: string;
  precision?: DatePrecision;
  dateText?: string;
  kind: 'data-readout' | 'pdufa' | 'adcom' | 'earnings' | 'conference' | 'other';
  note?: string;
  source: 'manual' | 'auto';
}

export interface StoredCustomEvent extends CustomEventInput {
  id: string;
  status: 'active' | 'superseded';
}

/** 未作废的条目：旧数据没有 status 字段，也算 active */
const ACTIVE_FILTER = { status: { $ne: 'superseded' } } as const;

function toStoredCustomEvent(d: {
  _id: unknown;
  symbol: string;
  title: string;
  date: string;
  precision?: DatePrecision;
  dateText?: string;
  kind: CustomEventInput['kind'];
  note?: string;
  source: CustomEventInput['source'];
  status?: 'active' | 'superseded';
}): StoredCustomEvent {
  return {
    id: String(d._id),
    symbol: d.symbol,
    title: d.title,
    date: d.date,
    precision: d.precision ?? 'day',
    dateText: d.dateText ?? undefined,
    kind: d.kind,
    note: d.note ?? undefined,
    source: d.source,
    status: d.status ?? 'active',
  };
}

/** 幂等：同 (symbol, title, date) 只存一条；返回是否为新增 */
export async function upsertCustomEvent(ev: CustomEventInput): Promise<boolean> {
  await connectToDatabase();
  const res = await CatalystCustomEvent.findOneAndUpdate(
    { symbol: ev.symbol, title: ev.title, date: ev.date },
    { $setOnInsert: { ...ev, status: 'active' } },
    { upsert: true, includeResultMetadata: true }
  );
  return !res.value;
}

/** 未作废且未过期的自定义催化剂（含手动与 AI 抽取），按锚点日期升序 */
export async function listUpcomingCustomEvents(): Promise<StoredCustomEvent[]> {
  await connectToDatabase();
  const today = new Date().toISOString().slice(0, 10);
  const docs = await CatalystCustomEvent.find({ date: { $gte: today }, ...ACTIVE_FILTER }).sort({ date: 1 }).lean();
  return docs.map(toStoredCustomEvent);
}

/** 某标的未作废的 AI 抽取条目（含已过锚点日期的——"已发生"正是要让 LLM 判定的） */
export async function listAutoCustomEvents(symbol: string): Promise<StoredCustomEvent[]> {
  await connectToDatabase();
  const docs = await CatalystCustomEvent.find({ symbol, source: 'auto', ...ACTIVE_FILTER }).sort({ date: 1 }).lean();
  return docs.map(toStoredCustomEvent);
}

/**
 * 把 AI 抽取的条目标为作废（后续公告表明已发生 / 时间已更新）。
 * 只动 source=auto 且属于该标的的行——手动条目是用户的判断，机器不改；
 * 限定标的是为了防 LLM 把别家的 id 混进来。返回实际作废的条目。
 */
export async function supersedeCustomEvents(
  symbol: string,
  ids: string[],
  byEventId: string
): Promise<StoredCustomEvent[]> {
  const valid = ids.filter((id) => mongoose.isValidObjectId(id));
  if (valid.length === 0) return [];
  await connectToDatabase();
  const docs = await CatalystCustomEvent.find({ _id: { $in: valid }, symbol, source: 'auto', ...ACTIVE_FILTER }).lean();
  if (docs.length === 0) return [];
  await CatalystCustomEvent.updateMany(
    { _id: { $in: docs.map((d) => d._id) } },
    { $set: { status: 'superseded', supersededBy: byEventId, supersededAt: new Date() } }
  );
  return docs.map(toStoredCustomEvent);
}

/**
 * 一次性迁移：旧版把"下半年"等区间硬编成某一天且没有 precision 字段。
 * 从 note 里的原文推断精度并把日期归一化到区间末尾；已迁移过的行（有 precision）跳过。
 * 幂等，daemon 启动时调用。返回改动条数。
 */
export async function migrateCustomEventPrecision(): Promise<number> {
  await connectToDatabase();
  const docs = await CatalystCustomEvent.find({ source: 'auto', precision: { $exists: false } }).lean();
  let changed = 0;
  for (const d of docs) {
    const dateText = d.dateText ?? parseLegacyNote(d.note) ?? '';
    const precision = inferPrecision(dateText);
    const date = anchorDate(d.date, precision);
    const $set: Record<string, unknown> = { precision };
    if (dateText && !d.dateText) $set.dateText = dateText;
    if (date !== d.date) {
      // 唯一索引 (symbol,title,date)：目标日期已有同名条目就只补精度、不挪日期
      const clash = await CatalystCustomEvent.exists({ symbol: d.symbol, title: d.title, date, _id: { $ne: d._id } });
      if (!clash) $set.date = date;
    }
    await CatalystCustomEvent.updateOne({ _id: d._id }, { $set });
    if (precision !== 'day' || $set.date) changed++;
  }
  return changed;
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
