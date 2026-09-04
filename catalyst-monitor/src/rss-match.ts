import type { WatchItem } from './types';

/** 新闻条目 ↔ 监控清单的匹配（纯函数，__tests__/rss-match.test.ts） */

// 公司名的第一个词（"Moderna Inc" → "moderna"）；法律后缀不算
const COMPANY_SUFFIXES = new Set(['inc', 'inc.', 'corp', 'corp.', 'co', 'co.', 'ltd', 'plc', 'llc', 'holdings', 'therapeutics', 'biologics']);
function companyStem(company: string): string {
  const words = company.toLowerCase().split(/\s+/).filter((w) => w && !COMPANY_SUFFIXES.has(w));
  return words[0] ?? company.toLowerCase();
}

/**
 * 命中第一个匹配的 watchlist 条目：公司名（全名或首词）/关键词做子串匹配，
 * 代码做区分大小写的全词匹配——ticker 只能以原文大写出现，之前把文本整体
 * 转大写后再匹配，"mRNA"（技术名词）就命中了 MRNA，一篇与 Moderna 无关的
 * 第三方新闻稿被当成 Moderna 新闻推送并进了记分卡
 */
export function matchWatchItem(text: string, watchlist: WatchItem[]): WatchItem | null {
  const lower = text.toLowerCase();
  for (const item of watchlist) {
    const needles = [item.company, companyStem(item.company), ...item.keywords]
      .map((k) => k.toLowerCase())
      .filter((k) => k.length >= 4);
    if (needles.some((n) => lower.includes(n))) return item;
    if (item.symbol.length >= 2 && new RegExp(`(^|[^A-Za-z0-9])\\$?${item.symbol}(?![A-Za-z0-9])`).test(text)) return item;
  }
  return null;
}

/**
 * 通用新闻 RSS 采集：拉取配置的 feed，仅保留命中 watchlist 关键词的条目。
 * 这是"新闻 wire 早于公司 IR 页面"问题的第一道补丁。
 */
