import { fetchWithRetry } from './http';
import type { DailyBar } from '../../lib/ai-dips-math';
import type { MonitorConfig } from './types';

/** Alpaca 日线拉取与「未定稿交易日」判定，aidips / insider 两个采集器共用 */

const DATA_BASE = 'https://data.alpaca.markets/v2/stocks/bars';
// 与网页端 ai-dips.actions 相同的回看窗口
const LOOKBACK_DAYS = 70;

const etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const etClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
});

export function etToday(): string {
  return etDate.format(new Date());
}

/** 16:05 ET 前当日 bar 尚未定稿，返回应剔除的日期；收盘后返回 undefined */
export function formingSessionDate(): string | undefined {
  const now = new Date();
  return etClock.format(now) >= '16:05' ? undefined : etDate.format(now);
}

export async function fetchDailyBars(config: MonitorConfig, symbols: string[]): Promise<Record<string, DailyBar[]>> {
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
