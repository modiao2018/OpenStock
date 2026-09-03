import { log } from '../config';
import { getKv, setKv } from '../store';
import { pushMessage } from '../notify';
import { connectToDatabase } from '@/database/mongoose';
import { FocusDigestItem, FocusEntry } from '@/database/models/focus.model';
import type { MonitorConfig, NewEvent } from '../types';

const MAX_DEFERRED_LINES = 15;
const TOP_N = 5;
const STANCE_ZH = { bullish: '偏多', bearish: '偏空', mixed: '多空交织', watch: '观察' } as const;

const beijingDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' });
const beijingHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false });

/**
 * 每日摘要：北京时间指定小时发一条，汇总闸门拦下的提醒 + 关注队列前几名。
 * 每小时被调度一次，靠 kv 按日期去重；没有被拦提醒且队列为空时不发。
 */
export async function collectDigest(config: MonitorConfig): Promise<NewEvent[]> {
  const now = new Date();
  const hour = Number(beijingHour.format(now));
  const date = beijingDate.format(now);
  if (hour !== config.focus.digestHourBeijing) return [];
  if ((await getKv('focus_digest_sent')) === date) return [];

  await connectToDatabase();
  const deferred = await FocusDigestItem.find({ sentAt: null }).sort({ scoreAtDefer: -1, createdAt: 1 }).lean();
  const top = await FocusEntry.find({ score: { $gt: 0 } }).sort({ score: -1 }).limit(TOP_N).lean();
  if (deferred.length === 0 && top.length === 0) {
    await setKv('focus_digest_sent', date);
    return [];
  }

  const sections: string[] = [];
  if (top.length > 0) {
    sections.push(
      '【关注队列 Top】\n' +
        top.map((e) => `· ${e.symbol} ${e.score} 分（${STANCE_ZH[e.stance]}）${e.caution ? ' ⚠勿追高' : ''}` +
          (e.nextCatalyst ? ` 催化剂 ${e.nextCatalyst.days} 天后` : '')).join('\n')
    );
  }
  if (deferred.length > 0) {
    const bySymbol = new Map<string, typeof deferred>();
    for (const d of deferred) (bySymbol.get(d.symbol) ?? bySymbol.set(d.symbol, []).get(d.symbol)!).push(d);
    const lines: string[] = [];
    for (const [symbol, items] of bySymbol) {
      if (lines.length >= MAX_DEFERRED_LINES) break;
      lines.push(`· ${symbol}（${items[0].scoreAtDefer} 分）${items.map((i) => i.title.replace(/｜.*$/, '')).join('，')}`);
    }
    const more = bySymbol.size > lines.length ? `\n…另有 ${bySymbol.size - lines.length} 只标的，见关注队列页` : '';
    sections.push(`【昨日低优先级提醒 ${deferred.length} 条】\n${lines.join('\n')}${more}`);
  }

  const siteUrl = process.env.BETTER_AUTH_URL;
  const delivered = await pushMessage(config.env, {
    title: `每日摘要 ${date}｜关注 ${top.length} 只，低优先级 ${deferred.length} 条`,
    body: sections.join('\n\n'),
    urgent: false,
    url: siteUrl ? `${siteUrl}/focus` : undefined,
  });
  if (delivered || !config.env.barkUrl) {
    await FocusDigestItem.updateMany({ _id: { $in: deferred.map((d) => d._id) } }, { $set: { sentAt: now } });
    await setKv('focus_digest_sent', date);
  }
  log('digest', `${date} 摘要：队列 ${top.length}，被拦提醒 ${deferred.length}（推送${delivered ? '成功' : '未送达'}）`);
  return [];
}
