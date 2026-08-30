import { log, logError } from './config';
import type { MonitorConfig, StoredEvent } from './types';

const SOURCE_LABEL: Record<string, string> = {
  clinicaltrials: '临床试验',
  edgar: 'SEC 申报',
  halts: '停牌',
  rss: '新闻',
};

/** ISO 时间转北京时间显示；纯日期（如 2026-06-15）原样返回 */
function toBeijingTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value;
  const d = new Date(t + 8 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `北京时间 ${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function formatBody(ev: StoredEvent): string {
  const lines = [
    ev.symbol ? `标的: ${ev.symbol}` : null,
    ev.publishedAt ? `源发布: ${toBeijingTime(ev.publishedAt)}` : null,
    `抓取: ${toBeijingTime(ev.fetchedAt)}`,
    ev.analysis ? `AI 分析: ${ev.analysis}` : null,
    ev.url ?? null,
  ].filter(Boolean);
  return lines.join('\n');
}

export interface PushMessage {
  title: string;
  body: string;
  /** true → Bark critical 级别（绕过静音/勿扰） */
  urgent: boolean;
  url?: string;
}

/** 供 daemon 和网页端（测试推送）共用 */
export async function sendBark(barkUrl: string, msg: PushMessage): Promise<void> {
  const payload: Record<string, string> = {
    title: msg.title.slice(0, 200),
    body: msg.body.slice(0, 1000),
    group: 'catalyst-monitor',
    // critical 级别在 iOS 上可绕过静音/勿扰——只给紧急事件用
    level: msg.urgent ? 'critical' : 'timeSensitive',
  };
  if (msg.url) payload.url = msg.url;

  const res = await fetch(barkUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Bark HTTP ${res.status}`);
}

/**
 * 推送策略：全部走 Bark，urgent 用 critical 级别（绕过静音/勿扰）。
 * 渠道未配置或发送失败只记日志，不中断采集主流程。
 */
export async function notify(config: MonitorConfig, ev: StoredEvent): Promise<boolean> {
  const { barkUrl } = config.env;
  if (!barkUrl) {
    log('notify', `(未配置推送渠道，仅记录) ${ev.title}`);
    return false;
  }

  const msg: PushMessage = {
    title: `[${SOURCE_LABEL[ev.source] ?? ev.source}] ${ev.title}`,
    body: formatBody(ev),
    urgent: ev.severity === 'urgent',
    url: ev.url,
  };

  try {
    await sendBark(barkUrl, msg);
    return true;
  } catch (err) {
    logError('notify:bark', err);
    return false;
  }
}
