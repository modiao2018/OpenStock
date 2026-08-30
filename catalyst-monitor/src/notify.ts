import { log, logError } from './config';
import type { MonitorConfig, StoredEvent } from './types';

const SOURCE_LABEL: Record<string, string> = {
  clinicaltrials: '临床试验',
  edgar: 'SEC 申报',
  halts: '停牌',
  rss: '新闻',
};

function formatBody(ev: StoredEvent): string {
  const lines = [
    ev.symbol ? `标的: ${ev.symbol}` : null,
    ev.publishedAt ? `源发布: ${ev.publishedAt}` : null,
    `抓取于: ${ev.fetchedAt}`,
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

export async function sendFeishu(webhookUrl: string, msg: PushMessage): Promise<void> {
  const prefix = msg.urgent ? '🚨' : '📌';
  const text = `${prefix} ${msg.title}\n${msg.body}`;
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: { text } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Feishu HTTP ${res.status}`);
  const body = (await res.json()) as { code?: number; msg?: string };
  if (body.code && body.code !== 0) throw new Error(`Feishu code ${body.code}: ${body.msg}`);
}

/**
 * 推送策略：urgent → Bark(critical) + 飞书；normal → 飞书，无飞书时降级 Bark。
 * 渠道未配置或发送失败只记日志，不中断采集主流程。
 */
export async function notify(config: MonitorConfig, ev: StoredEvent): Promise<boolean> {
  const { barkUrl, feishuWebhookUrl } = config.env;
  if (!barkUrl && !feishuWebhookUrl) {
    log('notify', `(未配置推送渠道，仅记录) ${ev.title}`);
    return false;
  }

  const msg: PushMessage = {
    title: `[${SOURCE_LABEL[ev.source] ?? ev.source}] ${ev.title}`,
    body: formatBody(ev),
    urgent: ev.severity === 'urgent',
    url: ev.url,
  };

  let delivered = false;
  const useBark = barkUrl && (ev.severity === 'urgent' || !feishuWebhookUrl);

  if (useBark) {
    try {
      await sendBark(barkUrl, msg);
      delivered = true;
    } catch (err) {
      logError('notify:bark', err);
    }
  }
  if (feishuWebhookUrl) {
    try {
      await sendFeishu(feishuWebhookUrl, msg);
      delivered = true;
    } catch (err) {
      logError('notify:feishu', err);
    }
  }
  return delivered;
}
