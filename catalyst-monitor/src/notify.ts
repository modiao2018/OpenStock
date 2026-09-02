import { transporter } from '@/lib/nodemailer';
import { timed } from '@/lib/source-calls';
import { log, logError } from './config';
import type { StoredEvent } from './types';

/** 推送只依赖渠道配置，daemon 传 config.env，网页端可直接用 process.env 构造 */
export interface PushEnv {
  barkUrl?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  clinicaltrials: '临床试验',
  edgar: 'SEC 申报',
  halts: '停牌',
  rss: '新闻',
  market: '盘面异动',
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

// 停牌不走 LLM（时效优先），给固定的操作提示
const HALT_ADVICE =
  '操作建议：观望——停牌大概率预示重大公告；复牌初期点差和波动极大，勿挂市价单追价，等消息落地后按情景预案操作。';

function formatBody(ev: StoredEvent): string {
  const lines = [
    ev.symbol ? `标的: ${ev.symbol}` : null,
    ev.publishedAt ? `源发布: ${toBeijingTime(ev.publishedAt)}` : null,
    `抓取: ${toBeijingTime(ev.fetchedAt)}`,
    ev.analysis ? `AI 分析: ${ev.analysis}` : null,
    ev.source === 'halts' ? HALT_ADVICE : null,
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

  await timed('bark', async () => {
    const res = await fetch(barkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Bark HTTP ${res.status}`);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 邮件兜底：Bark 彻底失败且事件紧急时使用；未配置 SMTP 则静默跳过 */
async function emailFallback(msg: PushMessage): Promise<boolean> {
  const to = process.env.ALERT_EMAIL || process.env.NODEMAILER_EMAIL;
  if (!transporter || !to) return false;
  try {
    await transporter.sendMail({
      from: `"Catalyst Monitor" <${process.env.NODEMAILER_EMAIL}>`,
      to,
      subject: `🚨 ${msg.title}`,
      text: `${msg.body}\n\n（Bark 推送失败，本邮件为兜底通知）`,
    });
    log('notify', '已通过邮件兜底送达');
    return true;
  } catch (err) {
    logError('notify:email', err);
    return false;
  }
}

/**
 * 推送一条消息：Bark 重试 3 次（1.5s/3s 退避），
 * 仍失败且为紧急消息时走邮件兜底。返回是否成功送达任一渠道。
 */
export async function pushMessage(env: PushEnv, msg: PushMessage): Promise<boolean> {
  const { barkUrl } = env;
  if (!barkUrl) {
    log('notify', `(未配置推送渠道，仅记录) ${msg.title}`);
    return false;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await sendBark(barkUrl, msg);
      return true;
    } catch (err) {
      logError(`notify:bark(第${attempt}次)`, err);
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  if (msg.urgent) return emailFallback(msg);
  return false;
}

export async function notify(env: PushEnv, ev: StoredEvent): Promise<boolean> {
  return pushMessage(env, {
    title: `[${SOURCE_LABEL[ev.source] ?? ev.source}] ${ev.title}`,
    body: formatBody(ev),
    urgent: ev.severity === 'urgent',
    url: ev.url,
  });
}
