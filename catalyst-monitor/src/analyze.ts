import { callAIProviderWithConfig } from '@/lib/ai-provider';
import { resolveLlmConfig } from '@/lib/llm-config';
import { log, logError } from './config';
import type { MonitorConfig, StoredEvent } from './types';

const MAX_DOC_CHARS = 6000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** EDGAR 申报原文（SEC 要求 User-Agent 带联系方式） */
async function fetchEdgarDoc(url: string, contact: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': `catalyst-monitor/0.1 (${contact})` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`EDGAR doc HTTP ${res.status}`);
  return stripHtml(await res.text()).slice(0, MAX_DOC_CHARS);
}

/** 按事件类型组装给 LLM 的上下文；返回 null 表示该类型不做分析（如停牌） */
async function buildContext(config: MonitorConfig, ev: StoredEvent): Promise<string | null> {
  switch (ev.source) {
    case 'edgar': {
      let docText = '';
      if (ev.url && ev.url.includes('sec.gov/Archives')) {
        try {
          docText = await fetchEdgarDoc(ev.url, config.env.edgarContact);
        } catch (err) {
          logError('analyze:edgar-doc', err);
        }
      }
      return `事件类型: SEC 申报\n申报元数据: ${JSON.stringify(ev.raw)}\n${docText ? `申报原文节选:\n${docText}` : '（原文获取失败，仅按元数据分析）'}`;
    }
    case 'rss': {
      const raw = ev.raw as { feed?: string; title?: string; description?: string };
      return `事件类型: 新闻\n来源: ${raw.feed ?? ''}\n标题: ${raw.title ?? ''}\n摘要: ${raw.description ?? ''}`;
    }
    case 'clinicaltrials':
      return `事件类型: ClinicalTrials.gov 注册信息变更\n最新关键字段: ${JSON.stringify(ev.raw)}`;
    case 'halts':
      // 停牌事件本身没有"报告内容"，且推送时效优先，不做 LLM 分析
      return null;
    default:
      return null;
  }
}

/**
 * 对报告类事件生成简体中文分析（概要 + 关键信息 + 倾向判断）。
 * LLM 未配置或调用失败返回 null，调用方照常推送，不阻塞。
 */
export async function analyzeEvent(config: MonitorConfig, ev: StoredEvent): Promise<string | null> {
  const context = await buildContext(config, ev);
  if (!context) return null;

  const llm = await resolveLlmConfig();
  if (!llm) {
    log('analyze', 'LLM 未配置，跳过分析');
    return null;
  }

  const prompt =
    '你是美股医药催化剂监控助手，用户是中国投资者。请用简体中文分析以下事件，' +
    '输出不超过 150 字的纯文本（不要使用 markdown 或列表符号）：' +
    '先一句话概括发生了什么；再给出关键数据或条款（如有）；' +
    '最后给出倾向判断（利好/利空/中性/不确定）及一句理由。\n\n' +
    `监控标的: ${ev.symbol ?? '未知'}\n事件标题: ${ev.title}\n${context}`;

  try {
    const start = Date.now();
    const reply = await callAIProviderWithConfig(prompt, {
      name: llm.provider,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      model: llm.model,
    });
    log('analyze', `${ev.externalId} 分析完成（${Date.now() - start}ms）`);
    return reply.trim().slice(0, 500);
  } catch (err) {
    logError('analyze', err);
    return null;
  }
}
