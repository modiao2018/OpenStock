import { connectToDatabase } from '@/database/mongoose';
import { FocusEntry, FocusDigestItem } from '@/database/models/focus.model';
import { log, logError } from './config';
import { pushMessage, type PushMessage } from './notify';
import type { MonitorConfig } from './types';

/**
 * 推送闸门：非紧急、绑定标的的提醒先看该标的的关注分。
 * 分数达到阈值 → 立即 Bark；否则归入每日摘要（不丢，只是不打扰）。
 * 紧急消息（停牌/8-K）、无标的消息、未开启安静模式、标的尚未打过分：一律直推。
 */
export interface GateResult {
  /** 实际 Bark 送达 */
  delivered: boolean;
  /** 已归入摘要（调用方应视作"已处理"，避免下一轮重复触发） */
  deferred: boolean;
}

export async function pushOrDefer(
  config: MonitorConfig,
  msg: PushMessage,
  ctx: { symbol: string; kind: string }
): Promise<GateResult> {
  if (!config.focus.quiet || msg.urgent) {
    return { delivered: await pushMessage(config.env, msg), deferred: false };
  }
  let score: number | null = null;
  try {
    await connectToDatabase();
    const entry = await FocusEntry.findOne({ symbol: ctx.symbol.toUpperCase() }).lean();
    score = entry?.score ?? null;
  } catch (err) {
    logError('focus-gate', err);
  }
  if (score === null || score >= config.focus.threshold) {
    return { delivered: await pushMessage(config.env, msg), deferred: false };
  }
  try {
    await FocusDigestItem.create({
      symbol: ctx.symbol.toUpperCase(),
      kind: ctx.kind,
      title: msg.title.slice(0, 200),
      body: msg.body.slice(0, 1000),
      scoreAtDefer: score,
    });
    log('focus-gate', `${ctx.symbol} 关注分 ${score} < ${config.focus.threshold}，归入摘要: ${msg.title}`);
    return { delivered: false, deferred: true };
  } catch (err) {
    // 归档失败就退回直推，宁可吵也不能丢
    logError('focus-gate:defer', err);
    return { delivered: await pushMessage(config.env, msg), deferred: false };
  }
}
