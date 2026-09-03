import type { MonitorConfig } from './types';

/**
 * 采集器清单的唯一权威定义：daemon 据此注册定时器，网页端 getMonitorStatus
 * 据此列出心跳——两边共用一份，避免再出现"daemon 有 12 个、面板只列 6 个"的漂移。
 */

export const COLLECTOR_NAMES = [
  'market', 'halts', 'edgar', 'rss', 'clinicaltrials', 'discovery',
  'reminders', 'weekly', 'aidips', 'insider', 'insider-edgar',
  'sources', 'xcheck', 'outcomes',
] as const;
export type CollectorName = (typeof COLLECTOR_NAMES)[number];

type PollKey = keyof MonitorConfig['poll'];

export interface CollectorSpec {
  name: CollectorName;
  /** 间隔取自 config.yaml poll 段 */
  pollKey?: PollKey;
  /** 固定间隔（分钟） */
  fixedMinutes?: number;
  /** 依赖催化剂监控清单；为 false 的采集器在清单为空时照常运行 */
  needsWatchlist: boolean;
}

export const COLLECTOR_SPECS: CollectorSpec[] = [
  { name: 'market', pollKey: 'marketMinutes', needsWatchlist: true },
  { name: 'halts', pollKey: 'haltsMinutes', needsWatchlist: true },
  { name: 'edgar', pollKey: 'edgarMinutes', needsWatchlist: true },
  { name: 'rss', pollKey: 'rssMinutes', needsWatchlist: true },
  { name: 'clinicaltrials', pollKey: 'clinicaltrialsMinutes', needsWatchlist: true },
  { name: 'discovery', fixedMinutes: 720, needsWatchlist: true },
  { name: 'reminders', fixedMinutes: 360, needsWatchlist: true },
  { name: 'weekly', fixedMinutes: 60, needsWatchlist: true },
  // 内部以「最新完成交易日」做门闩，实际每个交易日只处理一次
  { name: 'aidips', fixedMinutes: 60, needsWatchlist: false },
  // Form 4 本身有 T+2 申报延迟，90 分钟足够及时；靠唯一索引对新交易去重
  { name: 'insider', fixedMinutes: 90, needsWatchlist: false },
  // EDGAR 即时链路：Form 4 申报即知 + Form 144 拟卖预告；ET 受理时段外自动空转
  { name: 'insider-edgar', fixedMinutes: 10, needsWatchlist: false },
  // 外部资源探活 + 统计桶清理
  { name: 'sources', fixedMinutes: 30, needsWatchlist: false },
  // 行情 / 内部人多源交叉验证（内部按 session / 日期做门闩）
  { name: 'xcheck', fixedMinutes: 60, needsWatchlist: false },
  // 信号结果回补（T+1/5/20 收益），只处理未完结的账本记录
  { name: 'outcomes', fixedMinutes: 60, needsWatchlist: false },
];

export const DEFAULT_POLL: MonitorConfig['poll'] = {
  clinicaltrialsMinutes: 15,
  edgarMinutes: 5,
  haltsMinutes: 2,
  rssMinutes: 5,
  marketMinutes: 2,
};

export function collectorIntervals(poll: Partial<MonitorConfig['poll']>): Record<CollectorName, number> {
  const merged = { ...DEFAULT_POLL, ...poll };
  const out = {} as Record<CollectorName, number>;
  for (const spec of COLLECTOR_SPECS) {
    out[spec.name] = spec.pollKey ? merged[spec.pollKey] : (spec.fixedMinutes ?? 60);
  }
  return out;
}
