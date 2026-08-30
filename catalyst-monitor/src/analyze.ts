import { callAIProviderWithConfig } from '@/lib/ai-provider';
import { resolveLlmConfig } from '@/lib/llm-config';
import { log, logError } from './config';
import { fetchWithRetry } from './http';
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
  const res = await fetchWithRetry(url, {
    headers: { 'User-Agent': `catalyst-monitor/0.1 (${contact})` },
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

export interface GuidanceCatalyst {
  title: string;
  date: string; // YYYY-MM-DD
  kind: 'data-readout' | 'pdufa' | 'adcom' | 'earnings' | 'conference' | 'other';
  dateText: string;
}

export interface AnalysisResult {
  analysis: string | null;
  guidance: GuidanceCatalyst | null;
}

/** 从 LLM 回复中提取 JSON（容忍 ```json 围栏和前后废话） */
function parseJsonReply(reply: string): any | null {
  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

const GUIDANCE_KINDS = new Set(['data-readout', 'pdufa', 'adcom', 'earnings', 'conference', 'other']);

async function extractGuidance(
  llm: NonNullable<Awaited<ReturnType<typeof resolveLlmConfig>>>,
  ev: StoredEvent,
  context: string
): Promise<GuidanceCatalyst | null> {
  // 只有申报和新闻里才会出现公司给的时间指引
  if (ev.source !== 'edgar' && ev.source !== 'rss') return null;

  const prompt =
    '判断以下内容中公司是否给出了未来催化剂的时间指引（数据读出/topline、PDUFA 审批日、' +
    'FDA 咨询委员会、财报日、医学会议展示等）。只输出 JSON，不要任何其他文字：\n' +
    '{"found": true|false, "title": "简短中文标题（含药物名/事件类型）", ' +
    '"dateText": "原文时间表述", "isoDate": "YYYY-MM-DD（估计值：季度取中间月的15日，仅月份取15日）", ' +
    '"kind": "data-readout|pdufa|adcom|earnings|conference|other"}\n\n' +
    `${context}`;

  try {
    const reply = await callAIProviderWithConfig(prompt, {
      name: llm.provider,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      model: llm.model,
    });
    const parsed = parseJsonReply(reply);
    if (!parsed?.found || !parsed.isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.isoDate)) return null;
    // 过去的日期不是催化剂
    if (parsed.isoDate < new Date().toISOString().slice(0, 10)) return null;
    return {
      title: String(parsed.title ?? '').slice(0, 120) || '数据读出指引',
      date: parsed.isoDate,
      kind: GUIDANCE_KINDS.has(parsed.kind) ? parsed.kind : 'other',
      dateText: String(parsed.dateText ?? '').slice(0, 200),
    };
  } catch (err) {
    logError('analyze:guidance', err);
    return null;
  }
}

/**
 * 对报告类事件生成简体中文分析（概要 + 关键信息 + 倾向判断），
 * 并顺带抽取公司给出的催化剂时间指引（自动补进催化剂日历）。
 * LLM 未配置或调用失败返回 null 字段，调用方照常推送，不阻塞。
 */
export async function analyzeEvent(config: MonitorConfig, ev: StoredEvent): Promise<AnalysisResult> {
  const none: AnalysisResult = { analysis: null, guidance: null };
  const context = await buildContext(config, ev);
  if (!context) return none;

  const llm = await resolveLlmConfig();
  if (!llm) {
    log('analyze', 'LLM 未配置，跳过分析');
    return none;
  }

  // 用户对该标的的情景预案（如有）纳入分析，让 LLM 直接对档
  const watchItem = config.watchlist.find((w) => w.symbol === ev.symbol);
  const scenarioBlock = watchItem?.scenarioNotes
    ? `\n用户预设的情景预案：\n${watchItem.scenarioNotes}\n若本事件是数据/审批结果，请在最后指明结果落在哪一档（成功/模糊/失败/无法判断）。`
    : '';

  const prompt =
    '你是美股医药催化剂监控助手，用户是中国投资者。请用简体中文分析以下事件，' +
    '输出不超过 150 字的纯文本（不要使用 markdown 或列表符号）：' +
    '先一句话概括发生了什么；再给出关键数据或条款（如有）；' +
    '最后给出倾向判断（利好/利空/中性/不确定）及一句理由。' +
    scenarioBlock +
    '\n\n' +
    `监控标的: ${ev.symbol ?? '未知'}\n事件标题: ${ev.title}\n${context}`;

  let analysis: string | null = null;
  try {
    const start = Date.now();
    const reply = await callAIProviderWithConfig(prompt, {
      name: llm.provider,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      model: llm.model,
    });
    analysis = reply.trim().slice(0, 500);
    log('analyze', `${ev.externalId} 分析完成（${Date.now() - start}ms）`);
  } catch (err) {
    logError('analyze', err);
  }

  const guidance = await extractGuidance(llm, ev, context);
  return { analysis, guidance };
}
