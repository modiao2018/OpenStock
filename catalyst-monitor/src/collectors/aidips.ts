import { log } from '../config';
import { fetchWithRetry } from '../http';
import { getKv, setKv } from '../store';
import { pushMessage } from '../notify';
import { AI_DIP_CATALOG } from '../../../lib/ai-dips-catalog';
import { completedBars, computeDipStats, type DailyBar } from '../../../lib/ai-dips-math';
import type { MonitorConfig, NewEvent } from '../types';

const DATA_BASE = 'https://data.alpaca.markets/v2/stocks/bars';
// 与网页端 ai-dips.actions 相同的回看窗口
const LOOKBACK_DAYS = 70;
// 连跌达到 5/7/10 天各推送一次（里程碑制：5→7→10 逐级提醒，中途不刷屏）
const MILESTONES = [10, 7, 5];

const etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const etClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
});

async function fetchDailyBars(config: MonitorConfig, symbols: string[]): Promise<Record<string, DailyBar[]>> {
  const headers = {
    'APCA-API-KEY-ID': config.env.alpacaKey ?? '',
    'APCA-API-SECRET-KEY': config.env.alpacaSecret ?? '',
  };
  const start = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600_000).toISOString();
  const out: Record<string, DailyBar[]> = {};
  let pageToken: string | undefined;

  for (let page = 0; page < 3; page++) {
    const url =
      // split 复权：raw 会在拆股日伪造 -50%/-90% 的假下跌
      `${DATA_BASE}?symbols=${symbols.join(',')}&timeframe=1Day&adjustment=split&feed=iex&limit=10000` +
      `&start=${encodeURIComponent(start)}` +
      (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '');
    const res = await fetchWithRetry(url, { headers }, { timeoutMs: 30_000 });
    if (!res.ok) throw new Error(`Alpaca daily bars HTTP ${res.status}`);
    const data = (await res.json()) as {
      bars?: Record<string, Array<{ t: string; c: number }>>;
      next_page_token?: string | null;
    };
    for (const [symbol, bars] of Object.entries(data.bars ?? {})) {
      const list = (out[symbol] ??= []);
      for (const b of bars) list.push({ date: etDate.format(new Date(b.t)), c: b.c });
    }
    pageToken = data.next_page_token ?? undefined;
    if (!pageToken) break;
  }

  for (const list of Object.values(out)) list.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

const fmtPct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

/**
 * AI 低吸提醒：每个交易日收盘后检查一次 AI 池的连跌天数，
 * 达到 5/7/10 天里程碑时聚合成一条 Bark 推送（kv 去重，
 * 连跌中断即复位，下一轮下跌可再次触发）。不产生时间线事件。
 */
export async function collectAiDips(config: MonitorConfig): Promise<NewEvent[]> {
  if (!config.env.alpacaKey || !config.env.alpacaSecret) {
    log('aidips', '未配置 ALPACA_API_KEY/SECRET，跳过');
    return [];
  }

  // 16:05 ET 前当日 bar 尚未定稿，剔除后自然回退到上一交易日
  const now = new Date();
  const excludeDate = etClock.format(now) >= '16:05' ? undefined : etDate.format(now);

  const symbols = AI_DIP_CATALOG.map((s) => s.symbol);
  const barsBySymbol = await fetchDailyBars(config, symbols);

  const rows = AI_DIP_CATALOG.map((meta) => ({
    meta,
    stats: computeDipStats(completedBars(barsBySymbol[meta.symbol] ?? [], excludeDate)),
  }));

  // 以数据里实际最新的完成交易日做会话门闩：每个交易日只处理一次，
  // 周末/节假日 bars 不变，天然跳过
  const sessionDate = rows.reduce<string>((max, r) => {
    const bars = completedBars(barsBySymbol[r.meta.symbol] ?? [], excludeDate);
    const last = bars[bars.length - 1]?.date ?? '';
    return last > max ? last : max;
  }, '');
  if (!sessionDate) {
    log('aidips', '无可用日线数据，跳过');
    return [];
  }
  if ((await getKv('aidips_last_session')) === sessionDate) return [];

  const triggered: Array<{ symbol: string; name: string; days: number; declinePct: number | null; drawdownPct: number; close: number }> = [];
  for (const { meta, stats } of rows) {
    if (!stats) continue;
    const milestone = MILESTONES.find((m) => stats.streakDays >= m) ?? 0;
    const kvKey = `aidips_milestone:${meta.symbol}`;
    const prev = Number((await getKv(kvKey)) ?? '0');
    if (milestone > prev) {
      triggered.push({
        symbol: meta.symbol,
        name: meta.name,
        days: stats.streakDays,
        declinePct: stats.streakDeclinePct,
        drawdownPct: stats.drawdownFromHighPct,
        close: stats.lastClose,
      });
      await setKv(kvKey, String(milestone));
    } else if (milestone === 0 && prev > 0) {
      // 连跌中断，复位里程碑，下一轮连跌可重新提醒
      await setKv(kvKey, '0');
    }
  }

  if (triggered.length > 0) {
    triggered.sort((a, b) => b.days - a.days);
    const siteUrl = process.env.BETTER_AUTH_URL;
    const title =
      triggered.length === 1
        ? `AI 低吸｜${triggered[0].symbol} 连跌 ${triggered[0].days} 天`
        : `AI 低吸｜${triggered.length} 只标的连跌达标`;
    const body =
      triggered
        .map((s) => `${s.symbol} 连跌 ${s.days} 天 累计 ${fmtPct(s.declinePct)}（30 日回撤 ${fmtPct(s.drawdownPct)}，收 $${s.close.toFixed(2)}）`)
        .join('\n') + '\n仅统计已完成交易日，不构成投资建议';
    const delivered = await pushMessage(config.env, {
      title,
      body,
      urgent: false,
      url: siteUrl ? `${siteUrl}/ai-dips` : undefined,
    });
    log('aidips', `${sessionDate} 触发 ${triggered.length} 只（推送${delivered ? '成功' : '未送达'}）`);
  } else {
    log('aidips', `${sessionDate} 无新增连跌里程碑`);
  }

  await setKv('aidips_last_session', sessionDate);
  return [];
}
