import { XMLParser } from 'fast-xml-parser';
import { log, logError } from '../config';
import { fetchWithRetry } from '../http';
import { sha256 } from '../store';
import { rssSourceId } from '@/lib/sources-registry';
import { matchWatchItem } from '../rss-match';
import type { MonitorConfig, NewEvent } from '../types';

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return String((v as any)['#text'] ?? '');
  return String(v);
}

export async function collectRss(config: MonitorConfig): Promise<NewEvent[]> {
  const events: NewEvent[] = [];
  const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });
  let failed = 0;
  let lastError: unknown = null;

  for (const feed of config.feeds) {
    try {
      const res = await fetchWithRetry(
        feed.url,
        { headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'catalyst-monitor/0.1' } },
        { source: rssSourceId(feed.name) }
      );
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
          // 停牌/新闻条目天然一次性，首次见到就是事件本身，不是建档快照
          archival: false,
        });
      }
    } catch (err) {
      logError(`rss:${feed.name}`, err);
      failed++;
      lastError = err;
    }
  }

  // 单个 feed 失败只记日志；全部失败抛给 daemon 的错误追踪
  if (config.feeds.length > 0 && failed === config.feeds.length) {
    throw new Error(`全部 ${failed} 个新闻源拉取失败，最近错误: ${lastError instanceof Error ? lastError.message : lastError}`);
  }

  log('rss', `${events.length} matched items across ${config.feeds.length} feeds`);
  return events;
}
