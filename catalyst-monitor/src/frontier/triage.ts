import { connectToDatabase } from '@/database/mongoose';
import {
  FRONTIER_EVENT_TYPES,
  FrontierEvent,
  FrontierItem,
  type FrontierEventType,
  type FrontierSourceRef,
  type IFrontierItem,
} from '@/database/models/frontier.model';
import { universeOf, type LoadedTheme } from '@/lib/frontier-db';
import { extractExchangeTickers, findSameStory, isTickerShape, keywordHit, parseJsonLoose } from '@/lib/frontier-math';
import { log } from '../config';
import { frontierLlm } from './llm';
import type { MonitorConfig } from '../types';

/**
 * 漏斗第 2、3 步：
 * - 合并：标题高度相似的条目归入同一事件（不调 LLM）；
 * - 分拣：剩下的每 20 条一批交给 LLM，只要结构化标签（中文标题/类型/主题/标的/重要度），
 *   同时让它判断是否与近 72 小时的已有事件是同一件事。
 * 未配置 LLM 或当日额度用尽时按规则兜底，保证页面照常有内容。
 */

const BATCH = 20;
const MAX_PENDING = 160;
const RECENT_HOURS = 72;
const MAX_SOURCES = 12;

type ItemDoc = IFrontierItem & { _id: unknown };

interface RecentEvent {
  id: string;
  title: string;
  titleZh: string;
  titles: string[];
  importance: number | null;
  sourceCount: number;
}

function sourceRef(it: ItemDoc): FrontierSourceRef {
  return { source: it.source, feed: it.feed, title: it.title, url: it.url, publishedAt: it.publishedAt ?? null };
}

/** 把条目挂到已有事件上；第 3 家来源报道时重要度 +1（多家媒体都在写，说明确实重要） */
async function attach(eventId: string, items: ItemDoc[]): Promise<void> {
  const ev = await FrontierEvent.findById(eventId);
  if (!ev) return;
  const before = ev.sourceCount;
  for (const it of items) {
    if (ev.sources.length < MAX_SOURCES) ev.sources.push(sourceRef(it));
    ev.sourceCount += 1;
    for (const t of it.ruleTickers) if (!ev.tickers.includes(t)) ev.tickers.push(t);
    if (it.publishedAt && (!ev.publishedAt || it.publishedAt < ev.publishedAt)) ev.publishedAt = it.publishedAt;
  }
  if (before < 3 && ev.sourceCount >= 3 && ev.importance !== null && ev.importance < 4) {
    ev.importance += 1;
    ev.why = `${ev.why}（多家来源报道）`.slice(0, 200);
  }
  ev.lastSeenAt = new Date();
  await ev.save();
  await FrontierItem.updateMany({ _id: { $in: items.map((i) => i._id) } }, { $set: { status: 'clustered', eventId: ev._id } });
}

interface TriageResult {
  titleZh: string;
  eventType: FrontierEventType;
  themes: string[];
  tickers: string[];
  importance: number;
  why: string;
  mode: 'llm' | 'rule';
}

/** 规则兜底：按来源类型给默认类型与重要度 */
export function ruleTriage(it: Pick<IFrontierItem, 'source' | 'title' | 'ruleThemes' | 'ruleTickers' | 'raw'>, universe: Set<string>): TriageResult {
  const base: Record<string, [FrontierEventType, number]> = {
    approval: ['approval', 4],
    adcom: ['adcom', 3],
    deal: ['deal', 3],
    trial: ['trial-start', 2],
    fda: [/complete response/i.test(it.title) ? 'rejection' : 'regulatory', 3],
    news: ['other', 2],
    paper: ['research', 1],
  };
  const [eventType, importance0] = base[it.source] ?? ['other', 2];
  let importance = importance0;
  if (it.source === 'trial' && /phase 3/i.test(it.title)) importance += 1;
  if (it.source === 'news' && it.ruleTickers.some((t) => universe.has(t))) importance += 1;
  return {
    titleZh: it.title,
    eventType,
    themes: it.ruleThemes,
    tickers: it.ruleTickers,
    importance: Math.min(5, importance),
    why: '规则兜底（未经 AI 分拣）',
    mode: 'rule',
  };
}

const TYPE_GUIDE =
  'approval=FDA 批准；rejection=FDA 拒绝/完全回复函；adcom=FDA 专家委员会；deal=授权/合作交易；acquisition=并购；' +
  'financing=融资/IPO；trial-start=新试验启动或登记；data=临床数据读出；ai-milestone=AI 药物/AI 平台的里程碑；' +
  'regulatory=其他监管动态；policy=政策/医保/关税；research=科研突破；other=其他';

export const IMPORTANCE_GUIDE =
  '5=可能改变行业格局（如某主题首个获批药、10 亿美元以上并购或授权、主题龙头的关键三期结果、AI 设计药物进入三期或获批）；' +
  '4=对主题内具体公司有实质影响（重要中期数据、FDA 专家会、数亿美元交易、大药企与 AI 公司合作）；' +
  '3=值得知道（新的二/三期试验、中等规模交易、监管指引）；2=常规（小公司例行公告、会议摘要预告）；1=噪音（与主题无关、营销稿）';

function buildPrompt(themes: LoadedTheme[], batch: ItemDoc[], recent: RecentEvent[]): string {
  const themeLines = themes.map((t) => `${t.key}: ${t.name}`).join('\n');
  const recentLines = recent.map((e, i) => `E${i + 1}: ${e.titleZh || e.title}`).join('\n') || '（无）';
  const itemLines = batch
    .map((it, i) => {
      const snippet = it.snippet.replace(/\s+/g, ' ').slice(0, 280);
      return `#${i + 1} [${it.source}/${it.feed}] ${it.title}\n   ${snippet}`;
    })
    .join('\n');
  return (
    '你是美股生物医药行业的资讯分拣员，读者是不熟悉医药的中国投资者。' +
    '对下面每条资讯输出结构化标签，只根据给出的文字判断，不要补充原文没有的信息。\n\n' +
    `主题列表（themes 只能从这里选 key，可多选，都不相关就给 []）：\n${themeLines}\n\n` +
    `事件类型（type 只能从这里选）：${TYPE_GUIDE}\n\n` +
    `重要度：${IMPORTANCE_GUIDE}\n\n` +
    `近 ${RECENT_HOURS} 小时已有事件（若某条资讯与其中之一讲的是同一件事，join 填它的编号如 "E3"，否则 null）：\n${recentLines}\n\n` +
    `待分拣资讯：\n${itemLines}\n\n` +
    '只输出一个 JSON 数组，每条资讯一项，不要任何其他文字：\n' +
    'same：若本条与本批中编号更小的某条讲的是同一件事（不同媒体报道同一消息），填那条的编号，否则 null。\n' +
    '[{"i":1,"join":null,"same":null,"titleZh":"不超过 40 字的中文标题，公司名后括号带美股代码（若原文有），药名保留英文",' +
    '"type":"...","themes":["..."],"tickers":["原文中明确出现的美股代码"],"importance":3,"why":"不超过 30 字，为什么是这个重要度"}]'
  );
}

interface LlmTriageRow {
  i?: number;
  join?: string | null;
  same?: number | null;
  titleZh?: string;
  type?: string;
  themes?: unknown;
  tickers?: unknown;
  importance?: number;
  why?: string;
}

/** LLM 给的 ticker 只认：规则已命中的，或在原文里以全词形式出现的 */
export function acceptTickers(it: Pick<IFrontierItem, 'title' | 'snippet' | 'ruleTickers'>, llmTickers: unknown): string[] {
  const text = `${it.title} ${it.snippet}`;
  const out = new Set(it.ruleTickers.filter(isTickerShape));
  for (const t of extractExchangeTickers(text)) out.add(t);
  if (Array.isArray(llmTickers)) {
    for (const t of llmTickers) {
      if (isTickerShape(t) && t.length >= 2 && keywordHit(text, t)) out.add(t);
    }
  }
  return [...out];
}

function validate(row: LlmTriageRow, it: ItemDoc, themeKeys: Set<string>): TriageResult {
  const themes = Array.isArray(row.themes) ? row.themes.filter((t): t is string => typeof t === 'string' && themeKeys.has(t)) : [];
  const type = (FRONTIER_EVENT_TYPES as readonly string[]).includes(row.type ?? '') ? (row.type as FrontierEventType) : 'other';
  const imp = Math.round(Number(row.importance));
  return {
    titleZh: (row.titleZh ?? '').trim().slice(0, 120) || it.title,
    eventType: type,
    themes: themes.length ? themes : it.ruleThemes,
    tickers: acceptTickers(it, row.tickers),
    importance: Number.isFinite(imp) ? Math.min(5, Math.max(1, imp)) : 2,
    why: (row.why ?? '').trim().slice(0, 120),
    mode: 'llm',
  };
}

async function createEvent(leader: ItemDoc, followers: ItemDoc[], t: TriageResult): Promise<string> {
  const all = [leader, ...followers];
  const now = new Date();
  const published = all.map((i) => i.publishedAt).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const tickers = new Set(t.tickers);
  for (const f of followers) for (const x of f.ruleTickers) tickers.add(x);
  const ev = await FrontierEvent.create({
    title: leader.title,
    titleZh: t.titleZh,
    eventType: t.eventType,
    themes: t.themes,
    tickers: [...tickers],
    importance: t.importance,
    why: t.why,
    triageMode: t.mode,
    sources: all.slice(0, MAX_SOURCES).map(sourceRef),
    sourceCount: all.length,
    firstSeenAt: now,
    lastSeenAt: now,
    publishedAt: published,
  });
  await FrontierItem.updateMany({ _id: { $in: all.map((i) => i._id) } }, { $set: { status: 'clustered', eventId: ev._id } });
  return String(ev._id);
}

export async function clusterAndTriage(config: MonitorConfig, themes: LoadedTheme[]): Promise<{ merged: number; created: number }> {
  await connectToDatabase();
  const pending = (await FrontierItem.find({ status: 'pending' }).sort({ fetchedAt: 1 }).limit(MAX_PENDING)) as ItemDoc[];
  if (pending.length === 0) return { merged: 0, created: 0 };

  const since = new Date(Date.now() - RECENT_HOURS * 3600_000);
  const recentDocs = await FrontierEvent.find({ lastSeenAt: { $gte: since } })
    .sort({ importance: -1, lastSeenAt: -1 })
    .limit(300)
    .select({ title: 1, titleZh: 1, sources: 1, importance: 1, sourceCount: 1 })
    .lean();
  const recent: RecentEvent[] = recentDocs.map((d) => ({
    id: String(d._id),
    title: d.title,
    titleZh: d.titleZh,
    titles: [d.title, ...(d.sources ?? []).map((s) => s.title)],
    importance: d.importance,
    sourceCount: d.sourceCount,
  }));

  // 第 2 步：规则合并——先挂已有事件，再在本批内部按"同一件事"分组
  let merged = 0;
  const groups: Array<{ leader: ItemDoc; followers: ItemDoc[] }> = [];
  const toAttach = new Map<string, ItemDoc[]>();
  for (const it of pending) {
    const hit = findSameStory(it.title, recent);
    if (hit) {
      (toAttach.get(hit.id) ?? toAttach.set(hit.id, []).get(hit.id)!).push(it);
      continue;
    }
    const group = findSameStory(it.title, groups.map((g) => ({ g, titles: [g.leader.title, ...g.followers.map((f) => f.title)] })));
    if (group) group.g.followers.push(it);
    else groups.push({ leader: it, followers: [] });
  }
  for (const [id, items] of toAttach) {
    await attach(id, items);
    merged += items.length;
  }

  // 第 3 步：分拣（每批 20 条一次 LLM 调用；无 LLM / 无额度则规则兜底）
  const themeKeys = new Set(themes.map((t) => t.key));
  const universe = new Set(universeOf(themes).keys());
  // 给 LLM 看的已有事件只取最重要的 40 个，控制 prompt 长度；本轮前几批新建的事件也要让后面的批次看见
  const newThisRun: RecentEvent[] = [];
  let created = 0;
  for (let i = 0; i < groups.length; i += BATCH) {
    const shownRecent = [...newThisRun, ...recent].slice(0, Math.max(40, newThisRun.length + 20));
    const batch = groups.slice(i, i + BATCH);
    const reply = await frontierLlm(config, 'triage', buildPrompt(themes, batch.map((g) => g.leader), shownRecent));
    const rows = reply ? parseJsonLoose<LlmTriageRow[]>(reply) : null;
    const byIndex = new Map<number, LlmTriageRow>();
    if (Array.isArray(rows)) for (const r of rows) if (typeof r?.i === 'number') byIndex.set(r.i, r);
    if (reply && !Array.isArray(rows)) log('frontier:triage', 'LLM 回复无法解析，本批按规则兜底');

    // 本批第 j 条最终落在哪个事件上（供后面"same"指向它的条目合并）
    const landed = new Map<number, string>();
    for (let j = 0; j < batch.length; j++) {
      const { leader, followers } = batch[j];
      const row = byIndex.get(j + 1);
      const joinIdx = row?.join ? Number(String(row.join).replace(/\D/g, '')) - 1 : -1;
      const sameIdx = row?.same ? Number(row.same) - 1 : -1;
      const target =
        joinIdx >= 0 && joinIdx < shownRecent.length
          ? shownRecent[joinIdx].id
          : sameIdx >= 0 && sameIdx < j
            ? landed.get(sameIdx)
            : undefined;
      if (target) {
        await attach(target, [leader, ...followers]);
        landed.set(j, target);
        merged += 1 + followers.length;
        continue;
      }
      const result = row ? validate(row, leader, themeKeys) : ruleTriage(leader, universe);
      const id = await createEvent(leader, followers, result);
      landed.set(j, id);
      newThisRun.push({
        id,
        title: leader.title,
        titleZh: result.titleZh,
        titles: [leader.title, ...followers.map((f) => f.title)],
        importance: result.importance,
        sourceCount: 1 + followers.length,
      });
      created++;
    }
  }
  log('frontier:triage', `${pending.length} 条待处理：并入已有事件 ${merged} 条，新建事件 ${created} 个`);
  return { merged, created };
}
