import { transporter } from '@/lib/nodemailer';
import { callAIProviderWithConfig } from '@/lib/ai-provider';
import { resolveLlmConfig } from '@/lib/llm-config';
import { log, logError } from '../config';
import { getKv, getRecentEvents, listTrials, listUpcomingCustomEvents, setKv } from '../store';
import { pushMessage } from '../notify';
import type { MonitorConfig, NewEvent } from '../types';

const SOURCE_ZH: Record<string, string> = {
  clinicaltrials: '临床试验',
  edgar: 'SEC 申报',
  halts: '停牌',
  rss: '新闻',
  market: '盘面异动',
};

function beijingNow(): Date {
  return new Date(Date.now() + 8 * 3600_000);
}

function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

/** 组装周报正文（复盘 + 前瞻），供定时任务和手动 CLI 共用 */
export async function composeWeeklyReport(config: MonitorConfig): Promise<{ subject: string; text: string }> {
  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const events = (await getRecentEvents(since)).filter((e) => !e.firstSnapshot);

  const bySource = new Map<string, number>();
  for (const e of events) bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);
  const statLine =
    [...bySource.entries()].map(([s, n]) => `${SOURCE_ZH[s] ?? s} ${n} 条`).join('、') || '无新事件';

  const urgentLines = events
    .filter((e) => e.severity === 'urgent')
    .slice(0, 10)
    .map((e) => `· ${e.title}${e.analysis ? `\n  ${e.analysis.slice(0, 100)}` : ''}`);

  const in21d = new Date(Date.now() + 21 * 24 * 3600_000).toISOString().slice(0, 10);
  const watched = new Set(config.watchlist.map((w) => w.symbol));
  const upcoming: string[] = [];
  for (const c of await listUpcomingCustomEvents()) {
    if (c.date <= in21d) upcoming.push(`· ${c.date} ${c.symbol} ${c.title}`);
  }
  for (const t of await listTrials()) {
    const d = t.primaryCompletionDate;
    if (d && watched.has(t.symbol) && d <= in21d) upcoming.push(`· ${d} ${t.symbol} ${t.nctId} 主要完成`);
  }
  upcoming.sort();

  const sections = [
    `【本周事件】共 ${events.length} 条：${statLine}`,
    urgentLines.length ? `【重要事件】\n${urgentLines.join('\n')}` : null,
    upcoming.length ? `【未来 21 天催化剂】\n${upcoming.join('\n')}` : '【未来 21 天催化剂】暂无——考虑补充公司指引或手动添加',
  ].filter(Boolean);

  // LLM 一段话点评（未配置或失败则省略）
  try {
    const llm = await resolveLlmConfig();
    if (llm && events.length > 0) {
      const summary = await callAIProviderWithConfig(
        '你是医药股催化剂监控助手。基于以下一周事件清单，用简体中文写不超过 100 字的一段话周度点评' +
          '（重点：有无值得注意的信号、下周该盯什么），纯文本：\n' +
          events.slice(0, 30).map((e) => `${SOURCE_ZH[e.source] ?? e.source}: ${e.title}`).join('\n'),
        { name: llm.provider, apiKey: llm.apiKey, baseUrl: llm.baseUrl, model: llm.model }
      );
      sections.unshift(`【AI 周评】${summary.trim().slice(0, 300)}`);
    }
  } catch (err) {
    logError('weekly:llm', err);
  }

  const monitorLine = `监控标的: ${config.watchlist.map((w) => w.symbol).join(', ') || '（空）'}`;
  return {
    subject: `催化剂监控周报 ${new Date().toISOString().slice(0, 10)}`,
    text: `${monitorLine}\n\n${sections.join('\n\n')}`,
  };
}

/** 优先邮件（完整正文），无邮件配置时降级 Bark 推送（截断） */
export async function sendWeeklyReport(config: MonitorConfig): Promise<boolean> {
  const report = await composeWeeklyReport(config);
  const to = process.env.ALERT_EMAIL || process.env.NODEMAILER_EMAIL;

  if (transporter && to) {
    try {
      await transporter.sendMail({
        from: `"Catalyst Monitor" <${process.env.NODEMAILER_EMAIL}>`,
        to,
        subject: report.subject,
        text: report.text,
      });
      log('weekly', `周报已邮件发送至 ${to}`);
      return true;
    } catch (err) {
      logError('weekly:email', err);
    }
  }
  return pushMessage(config, { title: report.subject, body: report.text, urgent: false });
}

/**
 * 每周一北京时间上午（9–12 点窗口内的第一次轮询）发送复盘周报，按 ISO 周去重。
 */
export async function collectWeekly(config: MonitorConfig): Promise<NewEvent[]> {
  try {
    const bj = beijingNow();
    if (bj.getUTCDay() !== 1 || bj.getUTCHours() < 9 || bj.getUTCHours() >= 12) return [];

    const week = isoWeek(new Date());
    const dedupeKey = `weekly_report:${week}`;
    if (await getKv(dedupeKey)) return [];

    const delivered = await sendWeeklyReport(config);
    if (delivered) await setKv(dedupeKey, new Date().toISOString());
  } catch (err) {
    logError('weekly', err);
  }
  return [];
}
