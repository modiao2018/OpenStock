import { log, logError } from '../config';
import { connectToDatabase } from '@/database/mongoose';
import { SourceStats } from '@/database/models/source-stats.model';
import { recordSourceCall } from '@/lib/source-calls';
import { staleBucketKeys } from '@/lib/source-stats-math';
import { isSourceConfigured, probeSource } from '@/lib/source-probes';
import { SOURCES, rssSourceId } from '@/lib/sources-registry';
import type { MonitorConfig, NewEvent } from '../types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 外部资源探活：每 30 分钟对所有已配置的可探活资源发一次最轻量请求，
 * 结果记入资源统计（/status 页），并清理 48h 前的小时桶。不产生时间线事件。
 * Bark / healthcheck 为被动资源（不发合成流量），只看真实调用记录。
 */
export async function collectSources(config: MonitorConfig): Promise<NewEvent[]> {
  const ctx = { edgarContact: config.env.edgarContact, feeds: config.feeds };
  let okCount = 0;
  let failCount = 0;

  for (const spec of SOURCES) {
    if (spec.probe === 'none') continue;
    if (!(await isSourceConfigured(spec.id))) continue;
    // rss 按 config.feeds 展开为子源逐个探
    const rawIds = spec.dynamicPrefix ? config.feeds.map((f) => rssSourceId(f.name)) : [spec.id];
    for (const rawId of rawIds) {
      const r = await probeSource(rawId, ctx);
      await recordSourceCall(rawId, r.ok, r.latencyMs, r.error, { probe: true });
      if (r.ok) okCount++;
      else {
        failCount++;
        log('sources', `${rawId} 探活失败: ${r.error ?? 'unknown'}`);
      }
      await sleep(300);
    }
  }
  log('sources', `探活完成：${okCount} 正常 / ${failCount} 异常`);

  // 小时桶只保留 48h，避免文档无限增长
  try {
    await connectToDatabase();
    const docs = await SourceStats.find({}, { source: 1, hours: 1 }).lean();
    const now = Date.now();
    for (const d of docs) {
      const stale = staleBucketKeys(d.hours, now);
      if (stale.length === 0) continue;
      const unset: Record<string, 1> = {};
      for (const k of stale) unset[`hours.${k}`] = 1;
      await SourceStats.updateOne({ source: d.source }, { $unset: unset });
    }
  } catch (err) {
    logError('sources:cleanup', err);
  }
  return [];
}
