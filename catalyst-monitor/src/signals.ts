import { connectToDatabase } from '@/database/mongoose';
import { Signal } from '@/database/models/signal.model';
import { entryTargetDate, type SignalDirection } from '../../lib/signal-math';
import { logError } from './config';

/**
 * 信号账本写入口：每个推送点在送出 Bark 后调用一次。失败只记日志，
 * 绝不阻塞推送。同 (kind, symbol, dedupeKey) 只记一次。
 */

/** AI 池信号相对 QQQ；医药催化剂相对 XBI（config.market.benchmark） */
export const AI_BENCHMARK = 'QQQ';

export interface SignalInput {
  kind: string;
  symbol: string;
  dedupeKey: string;
  direction: SignalDirection;
  action?: string | null;
  title: string;
  benchmark: string;
  delivered: boolean;
  firedAt?: Date;
}

export async function recordSignal(input: SignalInput): Promise<void> {
  const firedAt = input.firedAt ?? new Date();
  try {
    await connectToDatabase();
    await Signal.updateOne(
      { kind: input.kind, symbol: input.symbol.toUpperCase(), dedupeKey: input.dedupeKey },
      {
        $setOnInsert: {
          direction: input.direction,
          action: input.action ?? null,
          title: input.title.slice(0, 200),
          firedAt,
          entryDate: entryTargetDate(firedAt),
          benchmark: input.benchmark,
          delivered: input.delivered,
          status: 'pending',
          horizons: {},
        },
      },
      { upsert: true }
    );
  } catch (err) {
    logError('signals:record', err);
  }
}

/** 事件源 → 信号方向：申报/停牌/异动本身无方向，靠 AI 操作建议定向 */
export function eventDirection(action: string | null | undefined, fallback: SignalDirection = 'none'): SignalDirection {
  if (action === '买入' || action === '加仓') return 'up';
  if (action === '卖出' || action === '减仓') return 'down';
  return fallback;
}
