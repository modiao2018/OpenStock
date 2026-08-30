export interface WatchItem {
  symbol: string;
  company: string;
  nctIds: string[];
  keywords: string[];
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
  };
  env: {
    barkUrl?: string;
    feishuWebhookUrl?: string;
    edgarContact: string;
  };
}

export type EventSource = 'clinicaltrials' | 'edgar' | 'halts' | 'rss';
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
}

/** 入库后的事件（含首次抓取时间与是否为该实体的首个快照） */
export interface StoredEvent extends NewEvent {
  id: number;
  fetchedAt: string;
  /** 首次见到该 externalId（首轮建档快照，不推送，避免启动时刷屏） */
  isFirstSnapshot: boolean;
}
