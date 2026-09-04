import { XMLParser } from 'fast-xml-parser';
import { log } from '../config';
import { fetchWithRetry } from '../http';
import { sha256 } from '../store';
import type { MonitorConfig, NewEvent } from '../types';

const HALTS_RSS = 'https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts';

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

// Nasdaq 停牌原因码的中文含义（对医药股最关键的是 T1/T2：公告前后的停牌）
const REASON_ZH: Record<string, string> = {
  T1: '消息待发布',
  T2: '消息已发布',
  T5: '个股价格异动暂停',
  T6: '异常市场活动',
  T8: 'ETF 相关暂停',
  T12: '等待公司补充信息',
  H4: '未满足持续上市要求',
  H9: '未按要求披露',
  H10: 'SEC 暂停交易',
  H11: '监管机构要求暂停',
  LUDP: '波动性暂停（涨跌限制）',
  LUDS: '波动性暂停（单边报价）',
  MWC1: '全市场熔断（一级）',
  MWC2: '全市场熔断（二级）',
  MWC3: '全市场熔断（三级）',
  IPO1: 'IPO 待开盘',
};

function reasonZh(code: string): string {
  return REASON_ZH[code] ? `${REASON_ZH[code]}(${code})` : code;
}

/**
 * Nasdaq 全市场停牌 RSS。T1 (News Pending) / T2 (News Released) 对
 * 临床数据公告是最强的"官方即将发布"信号——只推 watchlist 内的标的。
 */
export async function collectHalts(config: MonitorConfig): Promise<NewEvent[]> {
  const res = await fetchWithRetry(HALTS_RSS, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
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
      title: `${symbol} 停牌：${reasonZh(reason)} ${haltDate} ${haltTime}(美东)${resumption.tradeTime ? `，恢复交易 ${resumption.tradeTime}(美东)` : ''}`,
      url: 'https://www.nasdaqtrader.com/trader.aspx?id=TradeHalts',
      publishedAt,
      // 恢复交易时间更新时哈希变化 → 停牌和复牌各推一次
      contentHash: sha256({ reason, resumption }),
      raw: it,
      severity: 'urgent',
      // 停牌/新闻条目天然一次性，首次见到就是事件本身，不是建档快照
      archival: false,
    });
  }

  log('halts', `${items.length} halts market-wide, ${events.length} on watchlist`);
  return events;
}
