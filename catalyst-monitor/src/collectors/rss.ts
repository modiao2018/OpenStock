import { XMLParser } from 'fast-xml-parser';
import { log, logError } from '../config';
import { sha256 } from '../store';
import type { MonitorConfig, NewEvent, WatchItem } from '../types';

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return String((v as any)['#text'] ?? '');
  return String(v);
}

/** 命中第一个匹配的 watchlist 条目：公司名/关键词做子串匹配，代码做全词匹配 */
function matchWatchItem(text: string, watchlist: WatchItem[]): WatchItem | null {
  const lower = text.toLowerCase();
  for (const item of watchlist) {
    const needles = [item.company, ...item.keywords].map((k) => k.toLowerCase());
    if (needles.some((n) => n && lower.includes(n))) return item;
    // 代码单独用词边界匹配，避免短 ticker（如 "A"）误命中
    if (new RegExp(`\\b${item.symbol}\\b`).test(text.toUpperCase())) return item;
  }
  return null;
}

/**
 * 通用新闻 RSS 采集：拉取配置的 feed，仅保留命中 watchlist 关键词的条目。
 * 这是"新闻 wire 早于公司 IR 页面"问题的第一道补丁。
 */
export async function collectRss(config: MonitorConfig): Promise<NewEvent[]> {
  const events: NewEvent[] = [];
  const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });

  for (const feed of config.feeds) {
    try {
      const res = await fetch(feed.url, {
        headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'catalyst-monitor/0.1' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`${feed.name} HTTP ${res.status}`);
      const doc = parser.parse(await res.text());
      const items = toArray<any>(doc?.rss?.channel?.item ?? doc?.feed?.entry);

      for (const it of items) {
        const title = textOf(it.title);
        const description = textOf(it.description ?? it.summary);
        const link = textOf(it.link?.href ?? it.link);
        const guid = textOf(it.guid ?? it.id) || link;
        if (!title || !guid) continue;

        const hit = matchWatchItem(`${title} ${description}`, config.watchlist);
        if (!hit) continue;

        let publishedAt: string | undefined;
        const pub = textOf(it.pubDate ?? it.published ?? it.updated);
        if (pub) {
          const t = Date.parse(pub);
          if (!Number.isNaN(t)) publishedAt = new Date(t).toISOString();
        }

        events.push({
          source: 'rss',
          externalId: guid,
          symbol: hit.symbol,
          title: `${hit.symbol} 相关新闻: ${title}`,
          url: link || undefined,
          publishedAt,
          contentHash: sha256({ title, description }),
          raw: { feed: feed.name, title, description, link },
          severity: 'normal',
        });
      }
    } catch (err) {
      logError(`rss:${feed.name}`, err);
    }
  }

  log('rss', `${events.length} matched items across ${config.feeds.length} feeds`);
  return events;
}
