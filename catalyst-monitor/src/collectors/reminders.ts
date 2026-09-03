import { log, logError } from '../config';
import { getKv, listUpcomingCustomEvents, listTrials, setKv } from '../store';
import { pushMessage } from '../notify';
import { recordSignal } from '../signals';
import type { MonitorConfig, NewEvent } from '../types';

const REMIND_DAYS = [7, 1]; // 催化剂前 7 天和前 1 天各提醒一次

const KIND_ZH: Record<string, string> = {
  'data-readout': '数据读出',
  pdufa: 'PDUFA 审批',
  adcom: 'FDA 咨询委员会',
  earnings: '财报',
  conference: '会议',
  other: '催化剂',
};

function daysUntil(date: string): number {
  // 只有年月的（如试验的 2027-02）按当月 1 日计
  const iso = /^\d{4}-\d{2}$/.test(date) ? `${date}-01` : date;
  return Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
}

/**
 * 催化剂临近提醒：自定义催化剂 + 试验主要完成日期，
 * T-7 / T-1 各推送一次（kv 去重）。不产生时间线事件。
 */
export async function collectReminders(config: MonitorConfig): Promise<NewEvent[]> {
  const candidates: Array<{ id: string; symbol: string; label: string; date: string }> = [];

  try {
    for (const ev of await listUpcomingCustomEvents()) {
      candidates.push({
        id: `custom:${ev.id}`,
        symbol: ev.symbol,
        label: `${KIND_ZH[ev.kind] ?? ev.kind}：${ev.title}`,
        date: ev.date,
      });
    }
    const watched = new Set(config.watchlist.map((w) => w.symbol));
    for (const t of await listTrials()) {
      if (!watched.has(t.symbol) || !t.primaryCompletionDate) continue;
      candidates.push({
        id: `trial:${t.nctId}`,
        symbol: t.symbol,
        label: `试验主要完成日期：${t.nctId}`,
        date: t.primaryCompletionDate,
      });
    }

    let sent = 0;
    for (const c of candidates) {
      const days = daysUntil(c.date);
      if (!REMIND_DAYS.includes(days)) continue;
      const dedupeKey = `reminded:${c.id}:${days}`;
      if (await getKv(dedupeKey)) continue;

      const delivered = await pushMessage(config.env, {
        title: `催化剂提醒｜${c.symbol} ${days} 天后`,
        body: `${c.label}\n日期: ${c.date}\n事件前请核对情景预案与仓位（二元事件注意 gap 风险）`,
        urgent: false,
      });
      if (delivered) {
        await setKv(dedupeKey, new Date().toISOString());
        sent++;
      }
      // 账本：提醒无方向，只用来量化"催化剂前 N 天"这段时间的实际波动
      await recordSignal({
        kind: `reminder.t${days}`,
        symbol: c.symbol,
        dedupeKey: c.id,
        direction: 'none',
        title: `${c.label} ${c.date}`,
        benchmark: config.market.benchmark,
        delivered,
      });
    }
    log('reminders', `${candidates.length} catalysts checked, ${sent} reminders sent`);
  } catch (err) {
    logError('reminders', err);
  }
  return [];
}
