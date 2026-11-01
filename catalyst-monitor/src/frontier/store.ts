import { connectToDatabase } from '@/database/mongoose';
import {
  FrontierEvent,
  FrontierItem,
  type FrontierEventType,
  type FrontierItemSource,
} from '@/database/models/frontier.model';
import { getKv, setKv } from '../store';
import type { LoadedTheme } from '@/lib/frontier-db';
import type { MonitorConfig } from '../types';

/** 采集器产出的一条待入库条目 */
export interface NewFrontierItem {
  source: FrontierItemSource;
  externalId: string;
  feed: string;
  title: string;
  url?: string;
  snippet: string;
  publishedAt?: Date | null;
  ruleThemes: string[];
  ruleTickers: string[];
  /** 论文只进周报，不进分拣 */
  status?: 'pending' | 'paper';
  raw?: unknown;
}

export interface SourceContext {
  config: MonitorConfig;
  themes: LoadedTheme[];
  /** 该源上次成功运行的时间；首次运行为 null（各源自定回看窗口） */
  lastRun: Date | null;
}

/** 幂等批量入库：同 (source, externalId) 已存在的静默跳过，返回新增条数 */
export async function insertItems(items: NewFrontierItem[]): Promise<number> {
  if (items.length === 0) return 0;
  await connectToDatabase();
  const now = new Date();
  const docs = items.map((it) => ({
    ...it,
    snippet: it.snippet.slice(0, 1500),
    status: it.status ?? 'pending',
    fetchedAt: now,
  }));
  try {
    const res = await FrontierItem.insertMany(docs, { ordered: false });
    return res.length;
  } catch (err: unknown) {
    const e = err as { insertedDocs?: unknown[]; code?: number; writeErrors?: unknown[] };
    if (e?.insertedDocs) return e.insertedDocs.length;
    if (e?.code === 11000) return 0;
    throw err;
  }
}

/** 规则直接生成的事件（如登记库显示 AI 药物升期），不经过分拣 */
export async function createRuleEvent(input: {
  title: string;
  titleZh: string;
  eventType: FrontierEventType;
  themes: string[];
  tickers: string[];
  importance: number;
  why: string;
  source: FrontierItemSource;
  feed: string;
  url?: string;
  publishedAt?: Date | null;
  milestoneIds?: string[];
}): Promise<string> {
  await connectToDatabase();
  const now = new Date();
  const doc = await FrontierEvent.create({
    title: input.title,
    titleZh: input.titleZh,
    eventType: input.eventType,
    themes: input.themes,
    tickers: input.tickers,
    importance: input.importance,
    why: input.why,
    triageMode: 'rule',
    sources: [{ source: input.source, feed: input.feed, title: input.title, url: input.url, publishedAt: input.publishedAt ?? null }],
    sourceCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    publishedAt: input.publishedAt ?? now,
    milestoneIds: input.milestoneIds ?? [],
  });
  return String(doc._id);
}

// ── 数据源调度状态（页面"数据源"面板读这些 KV） ─────────────────

export const srcStatusKey = (id: string) => `frontier_src:${id}`;

export interface SourceRunStatus {
  at: string;
  ok: boolean;
  /** 本轮新增条目数 */
  added: number;
  /** 本轮抓到（初筛前）条目数 */
  seen: number;
  error?: string;
  lastOkAt?: string;
}

export async function readSourceStatus(id: string): Promise<SourceRunStatus | null> {
  const raw = await getKv(srcStatusKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SourceRunStatus;
  } catch {
    return null;
  }
}

export async function writeSourceStatus(id: string, status: SourceRunStatus): Promise<void> {
  await setKv(srcStatusKey(id), JSON.stringify(status));
}
