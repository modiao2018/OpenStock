import { log, logError } from '../config';
import { sha256, upsertTrial } from '../store';
import type { MonitorConfig, NewEvent } from '../types';

const API_BASE = 'https://clinicaltrials.gov/api/v2/studies';

// 这些状态说明试验出了问题，值得响铃
const BAD_STATUSES = new Set(['TERMINATED', 'SUSPENDED', 'WITHDRAWN']);

const STATUS_ZH: Record<string, string> = {
  RECRUITING: '招募中',
  NOT_YET_RECRUITING: '尚未招募',
  ENROLLING_BY_INVITATION: '邀请入组',
  ACTIVE_NOT_RECRUITING: '进行中（停止招募）',
  COMPLETED: '已完成',
  TERMINATED: '已终止',
  SUSPENDED: '已暂停',
  WITHDRAWN: '已撤回',
  UNKNOWN: '状态未知',
};

function statusZh(status: string): string {
  return STATUS_ZH[status] ?? status;
}

/**
 * 轮询 watchlist 里每个 NCT 试验的注册信息。
 * 关键字段（状态、完成日期、是否发布结果等）哈希变化即产生事件；
 * 同时把最新快照写入 trials 表供催化剂日历使用。
 */
export async function collectClinicalTrials(config: MonitorConfig): Promise<NewEvent[]> {
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

        await upsertTrial({
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
          title: `${item.symbol} ${nctId} 注册信息更新: ${statusZh(overallStatus)}${hasResults ? '（已发布结果）' : ''}`,
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
