import { log, logError } from '../config';
import { fetchWithRetry } from '../http';
import { latestEventRaw, listTrialsMissingZh, setTrialTitleZh, sha256, upsertTrial } from '../store';
import { translateTrialTitles } from '../analyze';
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
  let attempted = 0;
  let failed = 0;
  let lastError: unknown = null;

  for (const item of config.watchlist) {
    for (const nctId of item.nctIds) {
      attempted++;
      try {
        const res = await fetchWithRetry(`${API_BASE}/${nctId}`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`${nctId} HTTP ${res.status}`);
        const study = (await res.json()) as any;

        const proto = study.protocolSection ?? {};
        const status = proto.statusModule ?? {};
        const title: string = proto.identificationModule?.briefTitle ?? nctId;
        const overallStatus: string = status.overallStatus ?? 'UNKNOWN';
        const phases: string[] = proto.designModule?.phases ?? [];
        const hasResults: boolean = Boolean(study.hasResults);

        const lastUpdatePostDate: string | null = status.lastUpdatePostDateStruct?.date ?? null;
        // 参与变更检测的关键字段——任何一个变化都值得知道。
        // lastUpdatePostDate 不参与：申办方改个联系人/站点也会刷新它，
        // 状态、完成日期、结果一个没变却推"注册信息变更"（MRNA NCT03313778 2026-09-03）
        const watched = {
          overallStatus,
          whyStopped: status.whyStopped ?? null,
          hasResults,
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
          lastUpdatePostDate: lastUpdatePostDate ?? undefined,
          hasResults,
        });

        // 与上次入库的关键字段逐项比较：都没变就不产生事件。
        // 也顺带兼容老记录（其 raw 多一个 lastUpdatePostDate 字段），避免升级后全量误报
        const prev = (await latestEventRaw('clinicaltrials', nctId)) as Record<string, unknown> | null;
        if (prev && (Object.keys(watched) as Array<keyof typeof watched>).every((k) => (prev[k] ?? null) === watched[k])) {
          continue;
        }

        const urgent = hasResults || BAD_STATUSES.has(overallStatus);
        events.push({
          source: 'clinicaltrials',
          externalId: nctId,
          symbol: item.symbol,
          // "建档/更新"语义由时间线上的徽章表达，标题只描述当前状态
          title: `${item.symbol} ${nctId} ${statusZh(overallStatus)}${hasResults ? '（已发布结果）' : ''}`,
          url: `https://clinicaltrials.gov/study/${nctId}`,
          publishedAt: lastUpdatePostDate ?? undefined,
          contentHash: sha256(watched),
          raw: { ...watched, lastUpdatePostDate },
          severity: urgent ? 'urgent' : 'normal',
        });
      } catch (err) {
        logError('clinicaltrials', err);
        failed++;
        lastError = err;
      }
    }
  }

  // 个别试验失败只记日志；全军覆没说明源整体不可用，抛给 daemon 的错误追踪
  if (attempted > 0 && failed === attempted) {
    throw new Error(`全部 ${attempted} 个试验查询失败，最近错误: ${lastError instanceof Error ? lastError.message : lastError}`);
  }

  // 补翻中文标题（一批一次 LLM 调用；未配置 LLM 则静默跳过）
  try {
    await translateTrialTitles(await listTrialsMissingZh(), setTrialTitleZh);
  } catch (err) {
    logError('clinicaltrials:translate', err);
  }

  log('clinicaltrials', `checked ${attempted} trials, ${events.length} changed`);
  return events;
}
