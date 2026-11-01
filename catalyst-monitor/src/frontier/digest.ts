import { connectToDatabase } from '@/database/mongoose';
import { FrontierConference, FrontierEvent, FrontierTheme } from '@/database/models/frontier.model';
import { daysBetween } from '@/lib/frontier-math';

/**
 * 每日摘要里的「生物科技前沿」一节：过去 36 小时重要度 ≥3、没即时推送过的事件，
 * 外加 7 天内开幕的行业会议。由 collectors/digest.ts 在早上统一发送。
 */

const MAX_LINES = 8;

export interface FrontierDigest {
  text: string | null;
  eventIds: unknown[];
}

export async function frontierDigestSection(now = new Date()): Promise<FrontierDigest> {
  await connectToDatabase();
  const events = await FrontierEvent.find({
    importance: { $gte: 3 },
    digestedAt: null,
    pushedAt: null,
    dismissed: false,
    firstSeenAt: { $gte: new Date(now.getTime() - 36 * 3600_000) },
  })
    .sort({ importance: -1, sourceCount: -1, firstSeenAt: -1 })
    .limit(40)
    .lean();
  const themes = await FrontierTheme.find().select({ key: 1, name: 1 }).lean();
  const themeName = new Map(themes.map((t) => [t.key, t.name]));

  const today = now.toISOString().slice(0, 10);
  const confs = (await FrontierConference.find({ startDate: { $gte: today } }).sort({ startDate: 1 }).limit(10).lean()).filter(
    (c) => c.precision === 'day' && daysBetween(today, c.startDate) <= 7,
  );

  if (events.length === 0 && confs.length === 0) return { text: null, eventIds: [] };
  const lines = events.slice(0, MAX_LINES).map((e) => {
    const theme = e.themes[0] ? `[${themeName.get(e.themes[0]) ?? e.themes[0]}] ` : '';
    return `· ${theme}${e.titleZh || e.title}${'★'.repeat(e.importance ?? 0)}`;
  });
  if (events.length > MAX_LINES) lines.push(`…另有 ${events.length - MAX_LINES} 条，见生物科技前沿页`);
  for (const c of confs) lines.push(`· 📅 ${daysBetween(today, c.startDate)} 天后：${c.name}`);
  return { text: `【生物科技前沿 ${events.length} 条】\n${lines.join('\n')}`, eventIds: events.map((e) => e._id) };
}

export async function markFrontierDigested(ids: unknown[]): Promise<void> {
  if (ids.length === 0) return;
  await FrontierEvent.updateMany({ _id: { $in: ids } }, { $set: { digestedAt: new Date() } });
}
