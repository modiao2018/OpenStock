import { log, logError } from '../config';
import { fetchWithRetry } from '../http';
import { getBars, getKv, getLatestBarTime, insertBars, setKv, sha256, type Bar } from '../store';
import type { MonitorConfig, NewEvent } from '../types';

const DATA_BASE = 'https://data.alpaca.markets/v2/stocks/bars';
const CLOCK_URL = 'https://paper-api.alpaca.markets/v2/clock';
const WINDOW_MS = 5 * 60_000; // 5 分钟异动窗口
const BASELINE_DAYS = 12; // 基线回看自然日（约 8 个交易日）
const MIN_BASELINE_SAMPLES = 300; // 基线样本不足时不触发，避免冷启动误报
const COOLDOWN_MS = 30 * 60_000; // 同一标的告警冷却

function alpacaHeaders(config: MonitorConfig): Record<string, string> {
  return {
    'APCA-API-KEY-ID': config.env.alpacaKey ?? '',
    'APCA-API-SECRET-KEY': config.env.alpacaSecret ?? '',
  };
}

async function isMarketOpen(config: MonitorConfig): Promise<boolean> {
  const res = await fetchWithRetry(CLOCK_URL, { headers: alpacaHeaders(config) }, { timeoutMs: 10_000 });
  if (!res.ok) throw new Error(`Alpaca clock HTTP ${res.status}`);
  const clock = (await res.json()) as { is_open: boolean };
  return clock.is_open;
}

/** 增量拉取分钟线（首轮回补基线天数），多标的一次请求，翻页取完 */
async function syncBars(config: MonitorConfig, symbols: string[]): Promise<void> {
  const latest = await Promise.all(symbols.map((s) => getLatestBarTime(s)));
  const oldest = latest.reduce<Date | null>((min, d) => (d && (!min || d < min) ? d : min), null);
  const bootstrap = latest.some((d) => d === null);
  const start = bootstrap
    ? new Date(Date.now() - BASELINE_DAYS * 24 * 3600_000)
    : new Date((oldest ?? new Date()).getTime() - 10 * 60_000);

  let pageToken: string | undefined;
  let total = 0;
  for (let page = 0; page < 10; page++) {
    const url =
      `${DATA_BASE}?symbols=${symbols.join(',')}&timeframe=1Min&adjustment=raw&feed=iex&limit=10000` +
      `&start=${encodeURIComponent(start.toISOString())}` +
      (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '');
    const res = await fetchWithRetry(url, { headers: alpacaHeaders(config) }, { timeoutMs: 30_000 });
    if (!res.ok) throw new Error(`Alpaca bars HTTP ${res.status}`);
    const data = (await res.json()) as {
      bars: Record<string, Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>>;
      next_page_token?: string;
    };
    const batch: Bar[] = [];
    for (const [symbol, bars] of Object.entries(data.bars ?? {})) {
      for (const b of bars) {
        batch.push({ symbol, t: new Date(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
      }
    }
    total += await insertBars(batch);
    pageToken = data.next_page_token ?? undefined;
    if (!pageToken) break;
  }
  if (total > 0) log('market', `bars 入库 ${total} 条${bootstrap ? '（首轮回补基线）' : ''}`);
}

interface WindowSample {
  t: number;
  ret: number;
  vol: number;
}

/** 由分钟线构造滚动 5 分钟收益/成交量序列 */
function rollingWindows(bars: Bar[]): WindowSample[] {
  const out: WindowSample[] = [];
  let j = 0;
  let volSum = 0;
  for (let i = 0; i < bars.length; i++) {
    const tEnd = bars[i].t.getTime();
    volSum += bars[i].v;
    while (bars[j].t.getTime() <= tEnd - WINDOW_MS) {
      volSum -= bars[j].v;
      j++;
    }
    if (j === 0) continue; // 窗口尚未填满
    const base = bars[j - 1];
    // 隔夜/跨午休的窗口不计入（前收盘距今超过 15 分钟视为断档）
    if (tEnd - base.t.getTime() > 15 * 60_000) continue;
    out.push({ t: tEnd, ret: bars[i].c / base.c - 1, vol: volSum });
  }
  return out;
}

function stddev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * 盘面异动检测：5 分钟 abnormal return（扣除基准 ETF）超过历史 σ 阈值
 * 且相对成交量放大时，产出"疑似事件资金流"事件。
 */
export async function collectMarket(config: MonitorConfig): Promise<NewEvent[]> {
  if (!config.env.alpacaKey || !config.env.alpacaSecret) {
    log('market', '未配置 ALPACA_API_KEY/SECRET，跳过盘面监控');
    return [];
  }
  if (!(await isMarketOpen(config))) {
    log('market', '休市中，跳过');
    return [];
  }

  const symbols = [...new Set([...config.watchlist.map((w) => w.symbol), config.market.benchmark])];
  await syncBars(config, symbols);

  const since = new Date(Date.now() - BASELINE_DAYS * 24 * 3600_000);
  const benchBars = await getBars(config.market.benchmark, since);
  const benchWindows = new Map(rollingWindows(benchBars).map((w) => [w.t, w]));
  if (benchWindows.size === 0) {
    log('market', `基准 ${config.market.benchmark} 无数据，跳过检测`);
    return [];
  }

  const events: NewEvent[] = [];
  for (const item of config.watchlist) {
    try {
      const bars = await getBars(item.symbol, since);
      if (bars.length === 0) continue;

      // abnormal return = 个股 5 分钟收益 − 基准同窗口收益
      const arSeries: WindowSample[] = [];
      for (const w of rollingWindows(bars)) {
        const bench = benchWindows.get(w.t);
        if (bench) arSeries.push({ t: w.t, ret: w.ret - bench.ret, vol: w.vol });
      }
      if (arSeries.length < MIN_BASELINE_SAMPLES) {
        log('market', `${item.symbol} 基线样本不足（${arSeries.length}/${MIN_BASELINE_SAMPLES}），继续积累`);
        continue;
      }

      const current = arSeries[arSeries.length - 1];
      // 最新窗口太旧（IEX 无成交或数据延迟）不判定
      if (Date.now() - current.t > 10 * 60_000) continue;

      const baseline = arSeries.slice(0, -6); // 剔除最近 30 分钟避免污染基线
      const sigma = stddev(baseline.map((s) => s.ret));
      const volAvg = baseline.reduce((a, s) => a + s.vol, 0) / baseline.length;
      if (sigma === 0 || volAvg === 0) continue;

      const zScore = current.ret / sigma;
      const rvol = current.vol / volAvg;
      if (Math.abs(zScore) < config.market.sigmaThreshold || rvol < config.market.rvolThreshold) continue;

      // 冷却：30 分钟内同一标的只报一次
      const lastSignal = await getKv(`market_cooldown:${item.symbol}`);
      if (lastSignal && Date.now() - Date.parse(lastSignal) < COOLDOWN_MS) continue;
      await setKv(`market_cooldown:${item.symbol}`, new Date().toISOString());

      const benchRet = benchWindows.get(current.t)?.ret ?? 0;
      const dir = current.ret > 0 ? '拉升' : '下挫';
      const bucket = new Date(Math.floor(current.t / WINDOW_MS) * WINDOW_MS).toISOString();
      events.push({
        source: 'market',
        externalId: `${item.symbol}-${bucket}`,
        symbol: item.symbol,
        title:
          `${item.symbol} 疑似事件资金流：5分钟异常${dir} ${(current.ret * 100).toFixed(2)}%` +
          `（${zScore.toFixed(1)}σ），量比 ${rvol.toFixed(1)}，同期 ${config.market.benchmark} ${(benchRet * 100).toFixed(2)}%`,
        publishedAt: new Date(current.t).toISOString(),
        contentHash: sha256(`${item.symbol}-${bucket}`),
        raw: { ar: current.ret, sigma, zScore, rvol, benchRet, window: bucket },
        severity: 'urgent',
      });
    } catch (err) {
      logError(`market:${item.symbol}`, err);
    }
  }

  log('market', `checked ${config.watchlist.length} symbols, ${events.length} signals`);
  return events;
}
