import { connectToDatabase } from '@/database/mongoose';
import { FrontierEvent, type IFrontierEvent } from '@/database/models/frontier.model';
import { ensureFrontierSeed, loadThemes } from '@/lib/frontier-db';
import { beneficiarySignals, shouldPushNow } from '@/lib/frontier-math';
import { log } from '../config';
import { pushMessage } from '../notify';
import { recordSignal } from '../signals';
import { clusterAndTriage } from './triage';
import { deepAnalyze } from './analyze';
import { hasBudget, llmConfigured } from './llm';
import type { MonitorConfig, NewEvent } from '../types';

/**
 * 生物科技前沿的处理入口（daemon 每 15 分钟一轮）：合并 → 分拣 → 深度分析 → 推送 / 记信号。
 */

// 重要事件最多等深度分析 2 小时再推送；LLM 不可用时立即推送规则结果
const WAIT_FOR_ANALYSIS_MS = 2 * 3600_000;

const STANCE_ZH: Record<string, string> = { bullish: '利好', bearish: '利空', mixed: '多空交织', neutral: '中性' };
const RELATION_ZH: Record<string, string> = { direct: '直接受益', indirect: '间接受益', hurt: '受损' };

function pushBody(ev: IFrontierEvent): string {
  const a = ev.analysis;
  const lines: string[] = [];
  if (a?.summary) lines.push(a.summary);
  else if (ev.why) lines.push(ev.why);
  if (a?.interpretation) lines.push(`解读（${STANCE_ZH[a.stance] ?? a.stance}）：${a.interpretation}`);
  if (a?.beneficiaries.length) {
    lines.push(a.beneficiaries.map((b) => `${RELATION_ZH[b.relation]} ${b.symbol}`).join('、'));
  }
  if (ev.sourceCount > 1) lines.push(`${ev.sourceCount} 个来源`);
  return lines.join('\n');
}

async function pushAndRecord(config: MonitorConfig): Promise<void> {
  const now = new Date();
  const candidates = await FrontierEvent.find({
    importance: 5,
    pushedAt: null,
    dismissed: false,
    firstSeenAt: { $gte: new Date(now.getTime() - 24 * 3600_000) },
  });
  const canAnalyze = (await llmConfigured()) && (await hasBudget(config, 'deep'));
  for (const ev of candidates) {
    if (!shouldPushNow(ev.importance ?? 0, ev.publishedAt ?? null, now)) {
      // 旧闻（源发布超过 24 小时）不即时推，留给每日摘要
      continue;
    }
    const waiting = !ev.analyzedAt && ev.analysisAttempts < 2 && canAnalyze && now.getTime() - ev.firstSeenAt.getTime() < WAIT_FOR_ANALYSIS_MS;
    if (waiting) continue;
    const site = process.env.BETTER_AUTH_URL;
    const delivered = await pushMessage(config.env, {
      title: `生物科技前沿｜${ev.titleZh || ev.title}`,
      body: pushBody(ev),
      urgent: false,
      url: site ? `${site}/frontier?event=${ev._id}` : ev.sources[0]?.url,
    });
    // 推送失败也标记，避免每 15 分钟重试刷屏；每日摘要会再列出（digestedAt 仍为空）
    await FrontierEvent.updateOne({ _id: ev._id }, { $set: { pushedAt: now } });
    log('frontier:push', `${delivered ? '已推送' : '推送未送达'}：${ev.titleZh || ev.title}`);
  }

  // 信号账本：分析过的重要事件，直接受益/受损的标的各记一条，事后统计这类判断准不准
  const toRecord = await FrontierEvent.find({
    importance: { $gte: 4 },
    analyzedAt: { $ne: null },
    signalsRecorded: { $ne: true },
    dismissed: false,
  }).limit(50);
  for (const ev of toRecord) {
    for (const s of beneficiarySignals(ev.analysis?.beneficiaries ?? [])) {
      await recordSignal({
        kind: `frontier.${ev.eventType}`,
        symbol: s.symbol,
        dedupeKey: String(ev._id),
        direction: s.direction,
        action: null,
        title: ev.titleZh || ev.title,
        benchmark: config.market.benchmark,
        delivered: Boolean(ev.pushedAt),
        firedAt: ev.analyzedAt ?? ev.firstSeenAt,
      });
    }
    await FrontierEvent.updateOne({ _id: ev._id }, { $set: { signalsRecorded: true } });
  }
}

export async function collectFrontierBrain(config: MonitorConfig): Promise<NewEvent[]> {
  await ensureFrontierSeed();
  await connectToDatabase();
  const themes = await loadThemes();
  await clusterAndTriage(config, themes);
  await deepAnalyze(config, themes);
  await pushAndRecord(config);
  return [];
}
