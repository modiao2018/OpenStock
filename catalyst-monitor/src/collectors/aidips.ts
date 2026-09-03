import { log } from '../config';
import { getKv, setKv } from '../store';
import { pushOrDefer } from '../focus-gate';
import { fetchDailyBars, formingSessionDate } from '../alpaca-daily';
import { getAiDipPool } from '../../../lib/ai-dips-pool';
import { completedBars, computeDipStats } from '../../../lib/ai-dips-math';
import { AI_BENCHMARK, recordSignal } from '../signals';
import type { MonitorConfig, NewEvent } from '../types';

// 连跌达到 5/7/10 天各推送一次（里程碑制：5→7→10 逐级提醒，中途不刷屏）
const MILESTONES = [10, 7, 5];

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
  const excludeDate = formingSessionDate();

  // 每轮从 DB 读股票池——网页端改动无需重启 daemon
  const pool = await getAiDipPool();
  const symbols = pool.map((s) => s.symbol);
  const barsBySymbol = await fetchDailyBars(config, symbols);

  const rows = pool.map((meta) => ({
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
    const footer = '\n仅统计已完成交易日，不构成投资建议';
    let sent = 0;
    let deferred = 0;
    // 逐标的过闸门：关注分决定实时推送还是归入每日摘要
    for (const s of triggered) {
      const line = `${s.symbol} 连跌 ${s.days} 天 累计 ${fmtPct(s.declinePct)}（30 日回撤 ${fmtPct(s.drawdownPct)}，收 $${s.close.toFixed(2)}）`;
      const milestone = MILESTONES.find((m) => s.days >= m) ?? s.days;
      const gate = await pushOrDefer(
        config,
        { title: `AI 低吸｜${s.symbol} 连跌 ${s.days} 天`, body: line + footer, urgent: false, url: siteUrl ? `${siteUrl}/ai-dips` : undefined },
        { symbol: s.symbol, kind: `aidips.streak${milestone}` }
      );
      if (gate.delivered) sent++;
      if (gate.deferred) deferred++;
      // 账本：连跌里程碑是看多（低吸）信号，按里程碑+交易日去重
      await recordSignal({
        kind: `aidips.streak${milestone}`,
        symbol: s.symbol,
        dedupeKey: `${sessionDate}:${milestone}`,
        direction: 'up',
        title: line,
        benchmark: AI_BENCHMARK,
        delivered: gate.delivered,
      });
    }
    log('aidips', `${sessionDate} 触发 ${triggered.length} 只（实时 ${sent}，归入摘要 ${deferred}）`);
  } else {
    log('aidips', `${sessionDate} 无新增连跌里程碑`);
  }

  await setKv('aidips_last_session', sessionDate);
  return [];
}
