import { completedBars } from '@/lib/ai-dips-math';
import { universeOf } from '@/lib/frontier-db';
import { basketStat, type BasketStat } from '@/lib/frontier-math';
import { log } from '../../config';
import { etToday, fetchDailyBars, formingSessionDate } from '../../alpaca-daily';
import { getKv, setKv } from '../../store';
import type { NewFrontierItem, SourceContext } from '../store';

/**
 * 主题篮子：每个主题的标的等权组合，对比 XBI（生物科技行业 ETF）的 5/20/60 日表现。
 * 看的是"市场认不认这个主题"——消息很热但篮子不涨，说明预期早已打满或没人信。
 * 每个美东交易日收盘后算一次，结果存 KV 供页面与周报读取。
 */

export const BASKETS_KEY = 'frontier_baskets';
const BENCHMARK = 'XBI';
// 60 个交易日 ≈ 90 个自然日，多留余量
const LOOKBACK_DAYS = 100;

export interface BasketSnapshot {
  computedAt: string;
  session: string;
  benchmark: string;
  themes: Record<string, BasketStat>;
}

export async function collectBaskets(ctx: SourceContext): Promise<{ items: NewFrontierItem[]; seen: number }> {
  const { alpacaKey, alpacaSecret } = ctx.config.env;
  if (!alpacaKey || !alpacaSecret) {
    log('frontier:baskets', '未配置 Alpaca，跳过主题篮子');
    return { items: [], seen: 0 };
  }
  // 当天收盘未定稿就用到昨天；同一交易日只算一次
  const session = formingSessionDate() ? `pre:${etToday()}` : etToday();
  const prev = await getKv(BASKETS_KEY);
  if (prev && (JSON.parse(prev) as BasketSnapshot).session === session) return { items: [], seen: 0 };

  const universe = universeOf(ctx.themes);
  const symbols = [...universe.keys(), BENCHMARK];
  const raw = await fetchDailyBars(ctx.config, symbols, LOOKBACK_DAYS);
  const forming = formingSessionDate();
  const bars = Object.fromEntries(Object.entries(raw).map(([s, b]) => [s, completedBars(b, forming)]));

  const themes: Record<string, BasketStat> = {};
  for (const theme of ctx.themes) {
    themes[theme.key] = basketStat(bars, [...new Set(theme.tickers.map((t) => t.symbol))], BENCHMARK);
  }
  const snapshot: BasketSnapshot = { computedAt: new Date().toISOString(), session, benchmark: BENCHMARK, themes };
  await setKv(BASKETS_KEY, JSON.stringify(snapshot));
  log('frontier:baskets', `${ctx.themes.length} 个主题篮子已更新（${symbols.length} 只标的）`);
  return { items: [], seen: symbols.length };
}
