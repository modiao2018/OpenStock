import { ensureFrontierSeed, loadThemes } from '@/lib/frontier-db';
import { log, logError } from '../config';
import { insertItems, readSourceStatus, writeSourceStatus, type NewFrontierItem, type SourceContext } from './store';
import { collectNews } from './sources/news';
import { collectFda } from './sources/fda';
import { collectDeals } from './sources/deals';
import { collectTrials } from './sources/trials';
import { collectPapers } from './sources/papers';
import { collectFunds } from './sources/funds';
import { collectBaskets } from './sources/baskets';
import type { MonitorConfig, NewEvent } from '../types';

/**
 * 生物科技前沿的采集入口（daemon 每 30 分钟调度一次）：
 * 各数据源按自己的节奏到点才跑，结果规则初筛后入库，等 brain 合并与分拣。
 */

type SourceRunner = (ctx: SourceContext) => Promise<{ items: NewFrontierItem[]; seen: number }>;

export const FRONTIER_SOURCES: Array<{ id: string; minutes: number; run: SourceRunner }> = [
  { id: 'news', minutes: 30, run: collectNews },
  { id: 'deals', minutes: 120, run: collectDeals },
  { id: 'fda', minutes: 360, run: collectFda },
  { id: 'baskets', minutes: 360, run: collectBaskets },
  { id: 'trials', minutes: 720, run: collectTrials },
  { id: 'papers', minutes: 1440, run: collectPapers },
  { id: 'funds', minutes: 1440, run: collectFunds },
];

// 调度粒度是 30 分钟，留 2 分钟余量，免得"差几秒没到点"整轮错过
const SLACK_MS = 2 * 60_000;

export async function collectFrontierIngest(config: MonitorConfig): Promise<NewEvent[]> {
  await ensureFrontierSeed();
  const themes = await loadThemes();
  let ran = 0;
  let failed = 0;
  let lastError = '';

  for (const src of FRONTIER_SOURCES) {
    const status = await readSourceStatus(src.id);
    const lastAt = status ? Date.parse(status.at) : 0;
    // 失败的源下一轮（30 分钟后）就重试，不必等满自己的周期
    const interval = status && !status.ok ? Math.min(src.minutes, 30) : src.minutes;
    if (Date.now() - lastAt < interval * 60_000 - SLACK_MS) continue;

    const lastOkAt = status?.lastOkAt ? new Date(status.lastOkAt) : null;
    ran++;
    try {
      const { items, seen } = await src.run({ config, themes, lastRun: lastOkAt });
      const added = await insertItems(items);
      const now = new Date().toISOString();
      await writeSourceStatus(src.id, { at: now, ok: true, added, seen, lastOkAt: now });
      if (added > 0) log('frontier:ingest', `${src.id} 新增 ${added} 条`);
    } catch (err) {
      failed++;
      lastError = `${src.id}: ${err instanceof Error ? err.message : String(err)}`;
      logError(`frontier:ingest:${src.id}`, err);
      await writeSourceStatus(src.id, {
        at: new Date().toISOString(),
        ok: false,
        added: 0,
        seen: 0,
        error: lastError.slice(0, 300),
        lastOkAt: status?.lastOkAt,
      });
    }
  }
  // 单个源失败只记在源状态里；本轮跑的源全部失败才算采集器本身故障（触发 daemon 的连续失败告警）
  if (ran > 0 && failed === ran) throw new Error(lastError);
  return [];
}
