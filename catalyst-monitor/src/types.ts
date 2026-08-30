export interface WatchItem {
  symbol: string;
  company: string;
  nctIds: string[];
  keywords: string[];
  /** 情景预案（成功/模糊/失败判据），事件分析时 LLM 据此对档 */
  scenarioNotes?: string;
  /** 自动发现该公司在研试验（默认开启） */
  autoDiscover?: boolean;
}

export interface FeedConfig {
  name: string;
  url: string;
}

export interface MonitorConfig {
  watchlist: WatchItem[];
  edgar: {
    forms: string[];
    lookbackDays: number;
  };
  feeds: FeedConfig[];
  poll: {
    clinicaltrialsMinutes: number;
    edgarMinutes: number;
    haltsMinutes: number;
    rssMinutes: number;
    marketMinutes: number;
  };
  market: {
    /** 行业基准 ETF，用于扣除板块共振（默认 XBI） */
    benchmark: string;
    /** abnormal return 触发阈值（σ 倍数） */
    sigmaThreshold: number;
    /** 相对成交量触发阈值 */
    rvolThreshold: number;
  };
  env: {
    barkUrl?: string;
    edgarContact: string;
    alpacaKey?: string;
    alpacaSecret?: string;
  };
}

export type EventSource = 'clinicaltrials' | 'edgar' | 'halts' | 'rss' | 'market';
export type Severity = 'urgent' | 'normal';

/** 采集器产出的一条待入库事件 */
export interface NewEvent {
  source: EventSource;
  /** 同一实体的稳定标识（NCT 编号、EDGAR accession number、停牌 ID、RSS guid） */
  externalId: string;
  symbol?: string;
  title: string;
  url?: string;
  /** 信息源自己声明的发布时间（ISO/UTC），用于事后归因对比 fetched_at */
  publishedAt?: string;
  /** 关键字段的哈希；同 externalId 下哈希变化 = 实体发生了更新 */
  contentHash: string;
  raw: unknown;
  severity: Severity;
  /** 历史回补的存量记录：入库并分析，但不推送（如新增标的时回看的旧 8-K） */
  archival?: boolean;
}

/** 入库后的事件（含首次抓取时间与是否为该实体的首个快照） */
export interface StoredEvent extends NewEvent {
  id: string;
  fetchedAt: string;
  /** 首次见到该 externalId（首轮建档快照，不推送，避免启动时刷屏） */
  isFirstSnapshot: boolean;
  /** LLM 生成的中文分析（报告类事件），推送和时间线展示用 */
  analysis?: string;
}
