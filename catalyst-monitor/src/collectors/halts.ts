import { XMLParser } from 'fast-xml-parser';
import { log } from '../config';
import { sha256 } from '../store';
import type { MonitorConfig, NewEvent } from '../types';

const HALTS_RSS = 'https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts';

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Nasdaq 全市场停牌 RSS。T1 (News Pending) / T2 (News Released) 对
 * 临床数据公告是最强的"官方即将发布"信号——只推 watchlist 内的标的。
 */
export async function collectHalts(config: MonitorConfig): Promise<NewEvent[]> {
  const res = await fetch(HALTS_RSS, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`halts RSS HTTP ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });
  const doc = parser.parse(xml);
  const items = toArray<any>(doc?.rss?.channel?.item);

  const watched = new Map(config.watchlist.map((w) => [w.symbol, w]));
  const events: NewEvent[] = [];

  for (const it of items) {
    const symbol = String(it.IssueSymbol ?? '').toUpperCase();
    if (!watched.has(symbol)) continue;

    const reason = String(it.ReasonCode ?? '');
    const haltDate = String(it.HaltDate ?? '');
    const haltTime = String(it.HaltTime ?? '');
    const resumption = {
      date: it.ResumptionDate ?? null,
      quoteTime: it.ResumptionQuoteTime ?? null,
      tradeTime: it.ResumptionTradeTime ?? null,
    };

    let publishedAt: string | undefined;
    if (it.pubDate) {
      const t = Date.parse(String(it.pubDate));
      if (!Number.isNaN(t)) publishedAt = new Date(t).toISOString();
    }

    events.push({
      source: 'halts',
      externalId: `${symbol}-${haltDate}-${haltTime}`,
      symbol,
      title: `${symbol} 停牌 [${reason}] ${haltDate} ${haltTime}${resumption.tradeTime ? `，恢复交易 ${resumption.tradeTime}` : ''}`,
      url: 'https://www.nasdaqtrader.com/trader.aspx?id=TradeHalts',
      publishedAt,
      // 恢复交易时间更新时哈希变化 → 停牌和复牌各推一次
      contentHash: sha256({ reason, resumption }),
      raw: it,
      severity: 'urgent',
    });
  }

  log('halts', `${items.length} halts market-wide, ${events.length} on watchlist`);
  return events;
}
