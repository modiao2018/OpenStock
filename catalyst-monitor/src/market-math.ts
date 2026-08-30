/** 盘面异动的纯计算逻辑，供实时检测（market collector）与事后归因回放共用 */
import type { Bar } from './store';

export const WINDOW_MS = 5 * 60_000; // 5 分钟异动窗口

export interface WindowSample {
  t: number;
  ret: number;
  vol: number;
}

/** 由分钟线构造滚动 5 分钟收益/成交量序列（跨隔夜断档的窗口剔除） */
export function rollingWindows(bars: Bar[]): WindowSample[] {
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
    if (tEnd - base.t.getTime() > 15 * 60_000) continue;
    out.push({ t: tEnd, ret: bars[i].c / base.c - 1, vol: volSum });
  }
  return out;
}

export function stddev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** 个股窗口序列扣除基准同时刻窗口 → abnormal return 序列 */
export function abnormalSeries(stock: WindowSample[], bench: WindowSample[]): WindowSample[] {
  const benchMap = new Map(bench.map((w) => [w.t, w]));
  const out: WindowSample[] = [];
  for (const w of stock) {
    const b = benchMap.get(w.t);
    if (b) out.push({ t: w.t, ret: w.ret - b.ret, vol: w.vol });
  }
  return out;
}
