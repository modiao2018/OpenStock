import { XMLParser } from 'fast-xml-parser';
import { cleanHtmlText, matchThemes, type ThemeDef } from '@/lib/frontier-math';
import { feedUserAgent } from '@/lib/source-probes';
import { rssSourceId } from '@/lib/sources-registry';
import { log, logError } from '../../config';
import { fetchWithRetry } from '../../http';
import type { NewFrontierItem, SourceContext } from '../store';
import type { FeedConfig } from '../../types';

/**
 * 行业新闻 RSS：按主题关键词 / 主题标的做规则初筛，命中的才入库进入分拣。
 * 初筛是控制 LLM 用量的第一道闸——绝大多数条目在这里就被丢掉了。
 */

// 只收一周内的条目：首次运行不把 feed 里的陈年旧闻灌进来
const MAX_AGE_MS = 7 * 24 * 3600_000;

// FDA 的 feed 里大量是网页更新、指南修订、食品烟草器械新闻；只要监管决定类的条目
const FDA_DECISION_RE = /\bapprov|complete response|advisory committee|breakthrough|accelerated|clinical hold|refuse to file|warning letter|first .{0,40}(treatment|therapy)/i;

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return String((v as Record<string, unknown>)['#text'] ?? '');
  return String(v);
}

/** 单条 RSS 条目是否值得入库（纯规则，无网络） */
export function keepItem(
  feed: FeedConfig,
  text: string,
  themes: ThemeDef[],
): { keep: boolean; themes: string[]; tickers: string[] } {
  const m = matchThemes(text, themes);
  const isFda = feed.name.startsWith('FDA');
  let keep: boolean;
  if (isFda) keep = FDA_DECISION_RE.test(text);
  else if (feed.strict) keep = m.tickers.length > 0 || (m.keywordHit && m.exchangeTickers.length > 0);
  else keep = m.themes.length > 0;
  return { keep, themes: m.themes, tickers: [...new Set([...m.tickers, ...m.exchangeTickers])] };
}

async function fetchFeed(feed: FeedConfig, ctx: SourceContext, parser: XMLParser): Promise<{ items: NewFrontierItem[]; seen: number }> {
  const res = await fetchWithRetry(
    feed.url,
    { headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': feedUserAgent(feed.userAgent) } },
    { source: rssSourceId(feed.name) },
  );
  if (!res.ok) throw new Error(`${feed.name} HTTP ${res.status}`);
  const doc = parser.parse(await res.text());
  const entries = toArray<Record<string, unknown>>(doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.RDF?.item);
  const now = Date.now();
  const items: NewFrontierItem[] = [];

  for (const it of entries) {
    const title = cleanHtmlText(textOf(it.title));
    const description = cleanHtmlText(textOf(it.description ?? it.summary ?? it.encoded)).slice(0, 800);
    const link = textOf((it.link as { href?: unknown } | undefined)?.href ?? it.link).trim();
    const guid = textOf(it.guid ?? it.id).trim() || link;
    if (!title || !guid) continue;

    const pub = Date.parse(textOf(it.pubDate ?? it.published ?? it.updated ?? it.date));
    const publishedAt = Number.isNaN(pub) ? null : new Date(pub);
    if (publishedAt && now - publishedAt.getTime() > MAX_AGE_MS) continue;

    const verdict = keepItem(feed, `${title} ${description}`, ctx.themes);
    if (!verdict.keep) continue;

    items.push({
      source: feed.name.startsWith('FDA') ? 'fda' : 'news',
      externalId: guid,
      feed: feed.name,
      title,
      url: link || undefined,
      snippet: description,
      publishedAt,
      ruleThemes: verdict.themes,
      ruleTickers: verdict.tickers,
    });
  }
  return { items, seen: entries.length };
}

export async function collectNews(ctx: SourceContext): Promise<{ items: NewFrontierItem[]; seen: number }> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true });
  const feeds = ctx.config.frontier.feeds;
  const all: NewFrontierItem[] = [];
  let seen = 0;
  let failed = 0;
  let lastError: unknown = null;
  for (const feed of feeds) {
    try {
      const r = await fetchFeed(feed, ctx, parser);
      all.push(...r.items);
      seen += r.seen;
    } catch (err) {
      failed++;
      lastError = err;
      logError(`frontier:news:${feed.name}`, err);
    }
  }
  if (feeds.length > 0 && failed === feeds.length) {
    throw new Error(`全部 ${failed} 个行业新闻源拉取失败：${lastError instanceof Error ? lastError.message : lastError}`);
  }
  log('frontier:news', `${feeds.length - failed}/${feeds.length} 个源正常，${seen} 条中 ${all.length} 条命中主题`);
  return { items: all, seen };
}
