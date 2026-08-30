import { log, logError } from '../config.js';
import { sha256, type Store } from '../store.js';
import type { MonitorConfig, NewEvent } from '../types.js';

const API_BASE = 'https://clinicaltrials.gov/api/v2/studies';

// 这些状态说明试验出了问题，值得响铃
const BAD_STATUSES = new Set(['TERMINATED', 'SUSPENDED', 'WITHDRAWN']);

/**
 * 轮询 watchlist 里每个 NCT 试验的注册信息。
 * 关键字段（状态、完成日期、是否发布结果等）哈希变化即产生事件；
 * 同时把最新快照写入 trials 表供催化剂日历使用。
 */
export async function collectClinicalTrials(config: MonitorConfig, store: Store): Promise<NewEvent[]> {
  const events: NewEvent[] = [];

  for (const item of config.watchlist) {
    for (const nctId of item.nctIds) {
      try {
        const res = await fetch(`${API_BASE}/${nctId}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`${nctId} HTTP ${res.status}`);
        const study = (await res.json()) as any;

        const proto = study.protocolSection ?? {};
        const status = proto.statusModule ?? {};
        const title: string = proto.identificationModule?.briefTitle ?? nctId;
        const overallStatus: string = status.overallStatus ?? 'UNKNOWN';
        const phases: string[] = proto.designModule?.phases ?? [];
        const hasResults: boolean = Boolean(study.hasResults);

        // 参与变更检测的关键字段——任何一个变化都值得知道
        const watched = {
          overallStatus,
          whyStopped: status.whyStopped ?? null,
          hasResults,
          lastUpdatePostDate: status.lastUpdatePostDateStruct?.date ?? null,
          primaryCompletionDate: status.primaryCompletionDateStruct?.date ?? null,
          completionDate: status.completionDateStruct?.date ?? null,
          resultsFirstPostDate: status.resultsFirstPostDateStruct?.date ?? null,
        };

        store.upsertTrial({
          nctId,
          symbol: item.symbol,
          title,
          overallStatus,
          phase: phases.join('/') || 'N/A',
          primaryCompletionDate: watched.primaryCompletionDate ?? undefined,
          completionDate: watched.completionDate ?? undefined,
          lastUpdatePostDate: watched.lastUpdatePostDate ?? undefined,
          hasResults,
        });

        const urgent = hasResults || BAD_STATUSES.has(overallStatus);
        events.push({
          source: 'clinicaltrials',
          externalId: nctId,
          symbol: item.symbol,
          title: `${item.symbol} ${nctId} 注册信息更新: ${overallStatus}${hasResults ? '（已发布结果）' : ''}`,
          url: `https://clinicaltrials.gov/study/${nctId}`,
          publishedAt: watched.lastUpdatePostDate ?? undefined,
          contentHash: sha256(watched),
          raw: watched,
          severity: urgent ? 'urgent' : 'normal',
        });
      } catch (err) {
        logError('clinicaltrials', err);
      }
    }
  }

  log('clinicaltrials', `checked ${events.length} trials`);
  return events;
}
