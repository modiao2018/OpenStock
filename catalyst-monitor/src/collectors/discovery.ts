import { log, logError } from '../config';
import { fetchWithRetry } from '../http';
import { addNctIdsToWatchItem, getKv, setKv } from '../store';
import { pushMessage } from '../notify';
import type { MonitorConfig, NewEvent, WatchItem } from '../types';

const MAX_AUTO_TRIALS = 10; // 每家公司自动跟踪的试验上限（大药企在研试验可能几十个）
const SPONSOR_CACHE_MS = 30 * 24 * 3600_000;

const PHASE_RANK: Record<string, number> = { PHASE3: 3, PHASE2: 2, PHASE1: 1, EARLY_PHASE1: 0 };

/** 取名称中首个有意义的词作查询/匹配词（"ModernaTX, Inc." → modernatx） */
function firstToken(name: string): string {
  const first = (name.trim().split(/\s+/)[0] ?? name).replace(/[.,;]+$/, '');
  return (first.length >= 4 ? first : name).toLowerCase();
}

/**
 * 登记库搜索按"整词"匹配：公司股票名（Moderna Inc）常与登记名（ModernaTX, Inc.）
 * 对不上。已跟踪试验里的 leadSponsor 是权威名称——取一次并缓存 30 天。
 */
async function resolveSponsorToken(item: WatchItem): Promise<string> {
  const cacheKey = `sponsor_name:${item.symbol}`;
  const cached = await getKv(cacheKey, SPONSOR_CACHE_MS);
  if (cached) return firstToken(cached);

  if (item.nctIds.length > 0) {
    try {
      const res = await fetchWithRetry(
        `https://clinicaltrials.gov/api/v2/studies/${item.nctIds[0]}?fields=protocolSection.sponsorCollaboratorsModule.leadSponsor`,
        { headers: { Accept: 'application/json' } }
      );
      if (res.ok) {
        const data = (await res.json()) as any;
        const name = data?.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name;
        if (name) {
          await setKv(cacheKey, String(name));
          return firstToken(String(name));
        }
      }
    } catch (err) {
      logError(`discovery:sponsor:${item.symbol}`, err);
    }
  }
  return firstToken(item.company);
}

interface DiscoveredTrial {
  nctId: string;
  title: string;
  phase: string;
  rank: number;
  lastUpdate: string;
}

/**
 * 试验自动发现：按主办方查询 ClinicalTrials.gov 的在研试验，
 * 自动并入监控清单并推送提醒——新试验登记本身就是值得知道的信号。
 * 只增不减：用户手选的试验永远保留。
 */
export async function collectDiscovery(config: MonitorConfig): Promise<NewEvent[]> {
  for (const item of config.watchlist) {
    if (item.autoDiscover === false) continue;
    try {
      const token = await resolveSponsorToken(item);
      const fields = [
        'protocolSection.identificationModule.nctId',
        'protocolSection.identificationModule.briefTitle',
        'protocolSection.designModule.phases',
        'protocolSection.sponsorCollaboratorsModule.leadSponsor.name',
        'protocolSection.statusModule.lastUpdatePostDateStruct',
      ].join(',');
      const url =
        `https://clinicaltrials.gov/api/v2/studies?query.spons=${encodeURIComponent(token)}` +
        `&filter.overallStatus=RECRUITING,NOT_YET_RECRUITING,ENROLLING_BY_INVITATION,ACTIVE_NOT_RECRUITING` +
        `&pageSize=50&fields=${fields}`;
      const res = await fetchWithRetry(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`${item.symbol} discovery HTTP ${res.status}`);
      const data = (await res.json()) as { studies?: any[] };

      const candidates: DiscoveredTrial[] = (data.studies ?? [])
        .map((s) => {
          const proto = s.protocolSection ?? {};
          const phases: string[] = proto.designModule?.phases ?? [];
          return {
            nctId: String(proto.identificationModule?.nctId ?? '').toUpperCase(),
            title: String(proto.identificationModule?.briefTitle ?? ''),
            sponsor: String(proto.sponsorCollaboratorsModule?.leadSponsor?.name ?? ''),
            phase: phases.join('/'),
            rank: Math.max(0, ...phases.map((p) => PHASE_RANK[p] ?? 0)),
            lastUpdate: String(proto.statusModule?.lastUpdatePostDateStruct?.date ?? ''),
          };
        })
        // 只认自己作为主办方的试验，排除仅作为合作方挂名的项目
        .filter((c) => c.nctId && c.sponsor.toLowerCase().includes(token))
        .sort((a, b) => b.rank - a.rank || b.lastUpdate.localeCompare(a.lastUpdate))
        .slice(0, MAX_AUTO_TRIALS);

      const existing = new Set(item.nctIds);
      const fresh = candidates.filter((c) => !existing.has(c.nctId));
      if (fresh.length === 0) continue;

      await addNctIdsToWatchItem(item.symbol, fresh.map((c) => c.nctId));
      log('discovery', `${item.symbol} 自动加入 ${fresh.length} 个试验: ${fresh.map((c) => c.nctId).join(', ')}`);
      await pushMessage(config.env, {
        title: `试验发现｜${item.symbol} 新增 ${fresh.length} 个在研试验`,
        body:
          fresh.map((c) => `· ${c.nctId} [${c.phase || 'N/A'}] ${c.title.slice(0, 60)}`).join('\n') +
          '\n已自动加入监控；新试验登记本身可能是管线扩张的信号',
        urgent: false,
      });
    } catch (err) {
      logError(`discovery:${item.symbol}`, err);
    }
  }
  return [];
}
