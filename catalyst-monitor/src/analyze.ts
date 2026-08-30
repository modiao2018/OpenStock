import { callAIProviderWithConfig } from '@/lib/ai-provider';
import { resolveLlmConfig } from '@/lib/llm-config';
import { log, logError } from './config';
import { fetchWithRetry } from './http';
import { getRecentEvents, listTrials, listUpcomingCustomEvents } from './store';
import type { MonitorConfig, StoredEvent } from './types';

// 正文+附件合计上限：8-K 的新闻稿和幻灯片常见 2 万+ 字符，
// 时间指引（NEXT STEPS/milestones）往往在末尾，截太短会漏掉
const MAX_DOC_CHARS = 28_000;

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
  const headers = { 'User-Agent': `catalyst-monitor/0.1 (${contact})` };
  const res = await fetchWithRetry(url, { headers });
  if (!res.ok) throw new Error(`EDGAR doc HTTP ${res.status}`);
  let text = stripHtml(await res.text());

  // 8-K 正文常常只是封面，真正的新闻稿在 Exhibit 99 附件里——时间指引都写在那
  try {
    const dir = url.slice(0, url.lastIndexOf('/'));
    const primaryName = url.slice(url.lastIndexOf('/') + 1).toLowerCase();
    const idxRes = await fetchWithRetry(`${dir}/index.json`, { headers });
    if (idxRes.ok) {
      const idx = (await idxRes.json()) as { directory?: { item?: Array<{ name: string; size?: string }> } };
      // 附件命名五花八门（ex99 / 公司自定义），按"除正文外最大的 .htm"取——新闻稿必然是大文件
      const exhibits = (idx.directory?.item ?? [])
        .filter((i) => {
          const n = i.name.toLowerCase();
          return (
            /\.html?$/.test(n) &&
            n !== primaryName &&
            !/^r\d+\.htm/.test(n) &&
            !n.includes('index') &&
            !n.includes('report')
          );
        })
        .sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))
        .slice(0, 2);
      for (const item of exhibits) {
        const exRes = await fetchWithRetry(`${dir}/${item.name}`, { headers });
        if (exRes.ok) text += '\n\n【附件文件】' + stripHtml(await exRes.text());
      }
    }
  } catch (err) {
    logError('analyze:edgar-exhibit', err);
  }
  return text.slice(0, MAX_DOC_CHARS);
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
    case 'market':
      return buildMarketContext(ev);
    case 'halts':
      // 停牌事件本身没有"报告内容"，且推送时效优先，不做 LLM 分析
      return null;
    default:
      return null;
  }
}

/** 盘面异动简报的上下文：信号数据 + 该标的近期事件 + 临近催化剂 */
async function buildMarketContext(ev: StoredEvent): Promise<string> {
  const symbol = ev.symbol;
  const parts = [
    '事件类型: 盘面异动信号（价格/成交量异常，非新闻）',
    `信号数据: ${JSON.stringify(ev.raw)}`,
  ];

  try {
    const recent = (await getRecentEvents(new Date(Date.now() - 48 * 3600_000)))
      .filter((e) => e.symbol === symbol && e.source !== 'market' && !e.firstSnapshot)
      .slice(0, 8);
    parts.push(
      recent.length
        ? `该标的近 48 小时公开事件:\n${recent.map((e) => `- [${e.source}] ${e.title}`).join('\n')}`
        : '该标的近 48 小时无已捕获的公开事件（异动无公开信息对应）'
    );

    const in30d = new Date(Date.now() + 30 * 24 * 3600_000).toISOString().slice(0, 10);
    const catalysts: string[] = [];
    for (const c of await listUpcomingCustomEvents()) {
      if (c.symbol === symbol && c.date <= in30d) catalysts.push(`- ${c.date} ${c.title}`);
    }
    for (const t of await listTrials()) {
      if (t.symbol === symbol && t.primaryCompletionDate && t.primaryCompletionDate <= in30d) {
        catalysts.push(`- ${t.primaryCompletionDate} ${t.nctId} 主要完成`);
      }
    }
    parts.push(catalysts.length ? `未来 30 天催化剂:\n${catalysts.join('\n')}` : '未来 30 天无已知催化剂');
  } catch (err) {
    logError('analyze:market-context', err);
  }

  return parts.join('\n');
}

/** 固定操作评级词表——推送标题和时间线标签据此解析 */
export const ACTION_WORDS = ['买入', '加仓', '持有', '减仓', '卖出', '观望'] as const;
export type ActionWord = (typeof ACTION_WORDS)[number];
export const ACTION_PREFIX = '操作建议：';

/** 从分析文本中提取操作评级（买入/卖出/持有…），没有则返回 null */
export function extractAction(analysis?: string | null): ActionWord | null {
  if (!analysis) return null;
  const m = analysis.match(new RegExp(`操作建议[：:]\\s*(${ACTION_WORDS.join('|')})`));
  return (m?.[1] as ActionWord) ?? null;
}

/** 批量把英文试验标题译成中文短句（一次 LLM 调用处理一批），存回 trials 表 */
export async function translateTrialTitles(
  trials: Array<{ nctId: string; title: string }>,
  save: (nctId: string, zh: string) => Promise<void>
): Promise<number> {
  if (trials.length === 0) return 0;
  const llm = await resolveLlmConfig();
  if (!llm) return 0;

  const prompt =
    '把以下临床试验英文标题翻译成简洁的中文（每条不超过 40 字，保留药物代号原文，突出适应症和分期）。' +
    '只输出 JSON 数组，不要其他文字：[{"nctId":"...","zh":"..."}]\n\n' +
    trials.map((t) => `${t.nctId}: ${t.title}`).join('\n');

  try {
    const reply = await callAIProviderWithConfig(prompt, {
      name: llm.provider,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      model: llm.model,
    });
    const parsed = (reply.match(/\[[\s\S]*\]/) ? JSON.parse(reply.match(/\[[\s\S]*\]/)![0]) : []) as Array<{
      nctId?: string;
      zh?: string;
    }>;
    let saved = 0;
    const valid = new Set(trials.map((t) => t.nctId));
    for (const item of parsed) {
      if (item.nctId && item.zh && valid.has(item.nctId)) {
        await save(item.nctId, String(item.zh).slice(0, 80));
        saved++;
      }
    }
    if (saved > 0) log('analyze', `试验标题翻译完成 ${saved}/${trials.length} 条`);
    return saved;
  } catch (err) {
    logError('analyze:translate', err);
    return 0;
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
  guidances: GuidanceCatalyst[];
}

/** 从 LLM 回复中提取 JSON 数组（容忍 ```json 围栏和前后废话） */
function parseJsonArrayReply(reply: string): any[] | null {
  const match = reply.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const GUIDANCE_KINDS = new Set(['data-readout', 'pdufa', 'adcom', 'earnings', 'conference', 'other']);

async function extractGuidance(
  llm: NonNullable<Awaited<ReturnType<typeof resolveLlmConfig>>>,
  ev: StoredEvent,
  context: string
): Promise<GuidanceCatalyst[]> {
  // 只有申报和新闻里才会出现公司给的时间指引
  if (ev.source !== 'edgar' && ev.source !== 'rss') return [];

  const prompt =
    '从以下内容中找出公司给出的所有未来催化剂时间指引（数据读出/topline、后续随访数据、' +
    'PDUFA 审批日、FDA 咨询委员会、启动新试验、财报日、医学会议展示等）。' +
    '只输出 JSON 数组（最多 3 项，没有则输出 []），不要任何其他文字：\n' +
    '[{"title": "简短中文标题（含药物名/事件类型）", "dateText": "原文时间表述", ' +
    '"isoDate": "YYYY-MM-DD 估计值", "kind": "data-readout|pdufa|adcom|earnings|conference|other"}]\n' +
    '模糊表述的估计规则：具体日期照抄；仅月份取 15 日；季度取中间月 15 日；' +
    '"上半年/H1"取 04-15，"下半年/H2"取 10-15；"年内/later this year"取 11-15。\n\n' +
    `${context}`;

  try {
    const reply = await callAIProviderWithConfig(prompt, {
      name: llm.provider,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      model: llm.model,
    });
    const today = new Date().toISOString().slice(0, 10);
    return (parseJsonArrayReply(reply) ?? [])
      .filter((g) => g?.isoDate && /^\d{4}-\d{2}-\d{2}$/.test(g.isoDate) && g.isoDate >= today)
      .slice(0, 3)
      .map((g) => ({
        title: String(g.title ?? '').slice(0, 120) || '数据读出指引',
        date: g.isoDate as string,
        kind: GUIDANCE_KINDS.has(g.kind) ? g.kind : 'other',
        dateText: String(g.dateText ?? '').slice(0, 200),
      }));
  } catch (err) {
    logError('analyze:guidance', err);
    return [];
  }
}

/**
 * 对报告类事件生成简体中文分析（概要 + 关键信息 + 倾向判断），
 * 并顺带抽取公司给出的催化剂时间指引（自动补进催化剂日历）。
 * LLM 未配置或调用失败返回 null 字段，调用方照常推送，不阻塞。
 */
export async function analyzeEvent(config: MonitorConfig, ev: StoredEvent): Promise<AnalysisResult> {
  const none: AnalysisResult = { analysis: null, guidances: [] };
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
    ? `\n用户预设的情景预案：\n${watchItem.scenarioNotes}\n若本事件是数据/审批结果，请指明结果落在哪一档（成功/模糊/失败/无法判断），且"${ACTION_PREFIX}"必须与该档位预案一致。`
    : '';

  // 盘面异动是"没有新闻的异常"，分析目标是排查原因而不是解读报告
  const instruction =
    ev.source === 'market'
      ? '这是一条盘面异动告警。请用简体中文输出不超过 200 字的异动简报（纯文本，不要 markdown）：' +
        '1) 解读异动方向与力度；2) 结合近期事件与催化剂日历给出最可能的原因假设' +
        '（有公告对应 / 临近催化剂的提前定价 / 无信息对应的可疑资金流——若无对应信息要明确提示警惕未公开消息）；' +
        `3) 最后一行必须是"${ACTION_PREFIX}X"，X 只能从【${ACTION_WORDS.join(' / ')}】中选一个，` +
        '后接一句执行说明（如先查停牌与新闻 wire、勿盲目追价）。'
      : '请用简体中文分析以下事件，输出不超过 180 字的纯文本（不要使用 markdown 或列表符号）：' +
        '先一句话概括发生了什么；再给出关键数据或条款（如有）；' +
        '然后给出倾向判断（利好/利空/中性/不确定）及一句理由；' +
        `最后一行必须是"${ACTION_PREFIX}X"，X 只能从【${ACTION_WORDS.join(' / ')}】中选一个，` +
        '后接一句执行说明（时机/仓位/止损）。信息不足时选"观望"并写明等什么信号再动。';

  const prompt =
    '你是美股医药催化剂监控助手，用户是中国投资者。' +
    instruction +
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

  const guidances = await extractGuidance(llm, ev, context);
  return { analysis, guidances };
}
