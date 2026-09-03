import { log, logError } from '../config';
import { etToday, fetchDailyBars, formingSessionDate } from '../alpaca-daily';
import { connectToDatabase } from '@/database/mongoose';
import { Signal } from '@/database/models/signal.model';
import { completedBars } from '../../../lib/ai-dips-math';
import { daysBetween, resolveOutcomes, ENTRY_GRACE_DAYS } from '../../../lib/signal-math';
import type { MonitorConfig, NewEvent } from '../types';

// Alpaca 一次请求的标的上限（URL 长度），分批
const BATCH = 50;

/**
 * 信号结果回补：对所有未完结的信号，用 Alpaca 日线补 T+1/5/20 收盘与相对
 * 基准的超额收益。每轮全量扫描 pending/partial，量小（每天几条信号）。
 * 不产生时间线事件。
 */
export async function collectOutcomes(config: MonitorConfig): Promise<NewEvent[]> {
  if (!config.env.alpacaKey || !config.env.alpacaSecret) {
    log('outcomes', '未配置 ALPACA_API_KEY/SECRET，跳过');
    return [];
  }
  await connectToDatabase();
  const open = await Signal.find({ status: { $in: ['pending', 'partial'] } }).lean();
  if (open.length === 0) {
    log('outcomes', '无待回补信号');
    return [];
  }

  const symbols = [...new Set([...open.map((s) => s.symbol), ...open.map((s) => s.benchmark)])];
  const excludeDate = formingSessionDate();
  const barsBySymbol: Record<string, ReturnType<typeof completedBars>> = {};
  for (let i = 0; i < symbols.length; i += BATCH) {
    const chunk = symbols.slice(i, i + BATCH);
    try {
      const raw = await fetchDailyBars(config, chunk);
      for (const s of chunk) barsBySymbol[s] = completedBars(raw[s] ?? [], excludeDate);
    } catch (err) {
      logError('outcomes:bars', err);
    }
  }

  const today = etToday();
  let updated = 0;
  let expired = 0;
  for (const sig of open) {
    const bars = barsBySymbol[sig.symbol];
    if (!bars) continue;
    const bench = barsBySymbol[sig.benchmark] ?? [];
    const resolved = resolveOutcomes(bars, bench, sig.entryDate);
    if (!resolved) {
      // 入场日迟迟没有 bar（退市/行情源不覆盖），或日线窗口已滚过入场日：超过宽限期放弃
      if (daysBetween(sig.entryDate, today) > ENTRY_GRACE_DAYS) {
        await Signal.updateOne({ _id: sig._id }, { $set: { status: 'expired' } });
        expired++;
      }
      continue;
    }
    const status = resolved.complete ? 'complete' : 'partial';
    const changed =
      status !== sig.status ||
      Object.keys(resolved.horizons).length !== Object.keys(sig.horizons ?? {}).length;
    if (!changed) continue;
    await Signal.updateOne(
      { _id: sig._id },
      {
        $set: {
          entryDate: resolved.entryDate,
          entryClose: resolved.entryClose,
          benchmarkEntryClose: resolved.benchmarkEntryClose,
          horizons: resolved.horizons,
          status,
        },
      }
    );
    updated++;
  }
  log('outcomes', `${open.length} 条待回补，更新 ${updated}，放弃 ${expired}`);
  return [];
}
