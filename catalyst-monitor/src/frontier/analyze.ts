import mongoose from 'mongoose';
import { connectToDatabase } from '@/database/mongoose';
import {
  FrontierDeal,
  FrontierEvent,
  FrontierItem,
  FrontierMilestone,
  type FrontierAnalysisDoc,
  type FrontierBeneficiaryDoc,
  type IFrontierEvent,
} from '@/database/models/frontier.model';
import { universeOf, type LoadedTheme } from '@/lib/frontier-db';
import {
  checkFact,
  cleanHtmlText,
  companyCore,
  isTickerShape,
  keywordHit,
  parseJsonLoose,
  parseUsd,
  phraseInSource,
  type BeneficiaryRelation,
} from '@/lib/frontier-math';
import { BROWSER_UA } from '@/lib/source-probes';
import { log, logError } from '../config';
import { fetchWithRetry } from '../http';
import { fetchEdgarDoc } from '../analyze';
import { frontierLlm, hasBudget } from './llm';
import { IMPORTANCE_GUIDE } from './triage';
import type { MonitorConfig } from '../types';

/**
 * 漏斗第 4 步：只对重要度 ≥4 的事件抓原文做深度分析。
 * 防编造的三道关：事实必须附原文引文且引文能在原文里找到、引文外的数字一律不认、
 * 交易金额必须在原文里原样出现——过不了关的标"未核实"，页面上看得见。
 */

const MIN_IMPORTANCE = 4;
const PER_RUN = 4;
const MAX_ATTEMPTS = 2;
const MAX_SOURCE_CHARS = 14_000;
const MAX_WINDOW_DAYS = 3;

// 一手来源优先：监管/申报/登记库原文比媒体转述更可靠
const SOURCE_PRIORITY: Record<string, number> = { approval: 0, deal: 0, fda: 1, adcom: 1, trial: 1, news: 2, paper: 3 };

async function fetchPage(url: string, contact: string): Promise<string> {
  // fetchEdgarDoc 只去标签不解数字实体（&#8217;），再过一遍
  if (url.includes('sec.gov/Archives')) return cleanHtmlText(await fetchEdgarDoc(url, contact));
  const nct = url.match(/clinicaltrials\.gov\/study\/(NCT\d{8})/)?.[1];
  if (nct) {
    // 试验详情页是前端渲染的，直接取 API 的 JSON
    const res = await fetchWithRetry(`https://clinicaltrials.gov/api/v2/studies/${nct}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`ClinicalTrials HTTP ${res.status}`);
    const json = (await res.json()) as { protocolSection?: unknown };
    return JSON.stringify(json.protocolSection ?? {}).slice(0, MAX_SOURCE_CHARS);
  }
  const res = await fetchWithRetry(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' } }, { retries: 1 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let html = await res.text();
  // 文章正文通常在 <article> 里；没有就退回整页（去掉导航/页脚）
  const article = html.match(/<article[\s\S]*?<\/article>/i)?.[0];
  if (article && article.length > 2000) html = article;
  else html = html.replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ');
  return cleanHtmlText(html);
}

/** 汇集原文：首选一手来源全文，失败退回各来源的标题+摘要 */
async function gatherCorpus(config: MonitorConfig, ev: IFrontierEvent): Promise<{ text: string; fullText: boolean }> {
  const items = await FrontierItem.find({ eventId: ev._id }).select({ source: 1, feed: 1, title: 1, url: 1, snippet: 1 }).lean();
  const snippets = items.map((i) => `[${i.feed}] ${i.title}\n${i.snippet}`).join('\n\n');
  const ranked = [...ev.sources].filter((s) => s.url).sort((a, b) => (SOURCE_PRIORITY[a.source] ?? 9) - (SOURCE_PRIORITY[b.source] ?? 9));
  for (const s of ranked.slice(0, 2)) {
    try {
      const page = await fetchPage(s.url!, config.env.edgarContact);
      if (page.length >= 600) {
        return { text: `${page.slice(0, MAX_SOURCE_CHARS)}\n\n——其他来源摘要——\n${snippets}`.slice(0, MAX_SOURCE_CHARS + 3000), fullText: true };
      }
    } catch (err) {
      logError(`frontier:analyze:fetch`, `${s.url}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { text: snippets.slice(0, MAX_SOURCE_CHARS), fullText: false };
}

interface LlmAnalysis {
  titleZh?: string;
  importance?: number;
  summary?: string;
  facts?: Array<{ text?: string; quote?: string }>;
  interpretation?: string;
  stance?: string;
  beneficiaries?: Array<{ symbol?: string; name?: string; relation?: string; reason?: string }>;
  glossary?: Array<{ term?: string; explain?: string }>;
  deal?: { type?: string; buyer?: string; seller?: string; asset?: string; upfront?: string; total?: string } | null;
  milestone?: { drug?: string; note?: string } | null;
  newAiDrug?: { drug?: string; company?: string; symbol?: string; indication?: string; approach?: string } | null;
}

function buildPrompt(ev: IFrontierEvent, themes: LoadedTheme[], corpus: string, milestones: Array<{ drug: string; company: string }>, knownDrugs: string[]): string {
  const themeNames = ev.themes.map((k) => themes.find((t) => t.key === k)?.name ?? k).join('、') || '未归类';
  const milestoneBlock = milestones.length
    ? `\n本事件涉及 AI 药物记分板上的药：${milestones.map((m) => `${m.drug}（${m.company}）`).join('、')}。` +
      '若原文给出了它的新进展（新阶段、数据结果、下次读出时间），在 milestone 里写一句；否则 milestone 为 null。'
    : '\nmilestone 固定为 null。';
  const newDrugBlock = ev.themes.includes('ai-drug')
    ? `\n已在记分板上的 AI 药物：${knownDrugs.join('、')}。若原文明确说某个已进入临床的药物是 AI 设计/发现的，且不在上面名单里，填 newAiDrug；否则为 null。`
    : '\nnewAiDrug 固定为 null。';
  return (
    '你是美股生物医药行业分析师，读者是不熟悉医药的中国投资者，要用大白话讲清楚。' +
    '严格只依据下面的原文；原文没写的不要推测成事实；不确定就说不确定。\n\n' +
    `事件：${ev.titleZh || ev.title}\n类型：${ev.eventType}\n所属主题：${themeNames}\n相关代码：${ev.tickers.join(', ') || '无'}\n` +
    milestoneBlock +
    newDrugBlock +
    '\n\n只输出一个 JSON 对象，不要任何其他文字：\n' +
    '{"titleZh":"读完原文后更准确的中文标题，不超过 40 字（如「Zymeworks 将 ZW209 授权给罗氏，首付 $55 million」）",' +
    `"importance":读完原文后重新评估的重要度 1–5（${IMPORTANCE_GUIDE}）,` +
    '"summary":"不超过 120 字：发生了什么、为什么值得关注，专业词第一次出现时用括号解释",' +
    '"facts":[{"text":"一条中文事实，金额和数字必须保留原文写法（如 $1.2 billion、Phase 3、45%）","quote":"支撑这条事实的英文原文句子，逐字摘抄，不要改写"}],' +
    '"interpretation":"不超过 150 字：这件事对所属主题意味着什么（这是推演，不是事实）",' +
    '"stance":"bullish|bearish|mixed|neutral（对所属主题整体）",' +
    '"beneficiaries":[{"symbol":"美股代码","name":"公司名","relation":"direct|indirect|hurt","reason":"不超过 40 字"}],' +
    '"glossary":[{"term":"术语","explain":"不超过 40 字的大白话解释"}],' +
    '"deal":null 或 {"type":"license|collaboration|acquisition|option|other","buyer":"付钱方","seller":"出让方","asset":"标的资产/药物","upfront":"首付款原文写法，没有就空字符串","total":"总金额原文写法（含里程碑），没有就空字符串"},' +
    '"milestone":null 或 {"drug":"记分板药名","note":"不超过 60 字"},' +
    '"newAiDrug":null 或 {"drug":"","company":"","symbol":"美股代码或空","indication":"中文适应症","approach":"AI 用在哪一步"}}\n' +
    'facts 最多 5 条，挑最关键的；beneficiaries 最多 5 个，只写美股上市公司，direct=直接受益，indirect=产业链间接受益，hurt=受损（如竞争对手），拿不准的不要写；' +
    'glossary 最多 3 个，挑读者最可能看不懂的专业词，用通用知识解释（这是唯一允许使用原文以外知识的字段）；只有交易/并购类事件才填 deal。\n\n' +
    `原文：\n${corpus}`
  );
}

/** 读完原文后的重新评级：分拣只看了标题，允许修正，但一次最多 ±2 星，防止单次回复把事件拉满或打没 */
export function reassess(current: number, proposed: unknown): number {
  const n = Math.round(Number(proposed));
  if (!Number.isFinite(n)) return current;
  return Math.min(5, Math.max(1, Math.min(current + 2, Math.max(current - 2, n))));
}

const RELATIONS = new Set(['direct', 'indirect', 'hurt']);
const STANCES = new Set(['bullish', 'bearish', 'mixed', 'neutral']);
const DEAL_TYPES = new Set(['license', 'collaboration', 'acquisition', 'option', 'other']);

export function validateAnalysis(raw: LlmAnalysis, corpus: string, fullText: boolean): FrontierAnalysisDoc {
  const facts = (raw.facts ?? [])
    .filter((f) => f?.text && f?.quote)
    .slice(0, 5)
    .map((f) => checkFact({ text: String(f.text).slice(0, 200), quote: String(f.quote).slice(0, 400) }, corpus));
  const beneficiaries: FrontierBeneficiaryDoc[] = [];
  for (const b of raw.beneficiaries ?? []) {
    const symbol = String(b?.symbol ?? '').toUpperCase().trim();
    if (!isTickerShape(symbol) || !RELATIONS.has(String(b?.relation))) continue;
    if (beneficiaries.some((x) => x.symbol === symbol)) continue;
    beneficiaries.push({
      symbol,
      name: String(b.name ?? '').slice(0, 60),
      relation: b.relation as BeneficiaryRelation,
      reason: String(b.reason ?? '').slice(0, 100),
    });
    if (beneficiaries.length >= 5) break;
  }
  return {
    summary: String(raw.summary ?? '').trim().slice(0, 300),
    facts,
    interpretation: String(raw.interpretation ?? '').trim().slice(0, 400),
    stance: STANCES.has(String(raw.stance)) ? (raw.stance as FrontierAnalysisDoc['stance']) : 'neutral',
    beneficiaries,
    glossary: (raw.glossary ?? [])
      .filter((g) => g?.term && g?.explain)
      .slice(0, 3)
      .map((g) => ({ term: String(g.term).slice(0, 40), explain: String(g.explain).slice(0, 120) })),
    fullText,
  };
}

function amount(text: string | undefined, corpus: string) {
  const t = (text ?? '').trim();
  if (!t) return null;
  return { text: t.slice(0, 60), usd: parseUsd(t), verified: phraseInSource(t, corpus) };
}

async function saveDeal(ev: IFrontierEvent, deal: NonNullable<LlmAnalysis['deal']>, corpus: string, themes: LoadedTheme[], summary: string): Promise<void> {
  const universe = universeOf(themes);
  const filer = ev.sources.find((s) => s.source === 'deal');
  const filerItem = filer ? await FrontierItem.findOne({ eventId: ev._id, source: 'deal' }).select({ raw: 1 }).lean() : null;
  const filerRaw = (filerItem?.raw ?? null) as { company?: string; ticker?: string | null } | null;
  const resolve = (name: string | undefined): string | null => {
    const n = (name ?? '').trim();
    if (!n) return null;
    for (const [symbol, info] of universe) {
      if (keywordHit(n, companyCore(info.company)) || keywordHit(info.company, companyCore(n))) return symbol;
    }
    if (filerRaw?.ticker && filerRaw.company && (keywordHit(n, companyCore(filerRaw.company)) || keywordHit(filerRaw.company, companyCore(n)))) {
      return filerRaw.ticker;
    }
    const exch = n.match(/\b([A-Z]{1,5})\b/);
    return exch && ev.tickers.includes(exch[1]) ? exch[1] : null;
  };
  await FrontierDeal.updateOne(
    { eventId: ev._id },
    {
      $set: {
        date: ev.publishedAt ?? ev.firstSeenAt,
        dealType: DEAL_TYPES.has(String(deal.type)) ? deal.type : 'other',
        buyer: String(deal.buyer ?? '').slice(0, 80),
        seller: String(deal.seller ?? '').slice(0, 80),
        buyerSymbol: resolve(deal.buyer),
        sellerSymbol: resolve(deal.seller),
        asset: String(deal.asset ?? '').slice(0, 120),
        themes: ev.themes,
        upfront: amount(deal.upfront, corpus),
        total: amount(deal.total, corpus),
        summary: summary.slice(0, 300),
        url: ev.sources[0]?.url,
      },
    },
    { upsert: true },
  );
}

/** 原文里提到的记分板药物（按全部别名全词匹配） */
async function matchMilestones(corpus: string) {
  const all = await FrontierMilestone.find({ status: { $in: ['active', 'proposed'] } }).select({ drug: 1, aliases: 1, company: 1, status: 1 }).lean();
  const hit = all.filter((m) => m.status === 'active' && [m.drug, ...(m.aliases ?? [])].some((a) => a.length >= 4 && keywordHit(corpus, a)));
  return { hit, allNames: all.map((m) => m.drug), all };
}

async function linkMilestones(
  ev: IFrontierEvent,
  hit: Array<{ _id: unknown; drug: string }>,
  raw: LlmAnalysis,
): Promise<void> {
  const url = ev.sources[0]?.url;
  for (const m of hit) {
    const update: Record<string, unknown> = {
      $push: { history: { at: new Date(), kind: 'event', text: ev.titleZh || ev.title, url } },
    };
    // LLM 的进展判断只作为"待确认的提议"，由用户在记分板上采纳或忽略
    if (raw.milestone?.note && raw.milestone.drug && raw.milestone.drug.toLowerCase() === m.drug.toLowerCase()) {
      (update.$push as Record<string, unknown>).proposals = {
        _id: new mongoose.Types.ObjectId(),
        text: String(raw.milestone.note).slice(0, 200),
        eventId: ev._id,
        url,
        createdAt: new Date(),
      };
    }
    await FrontierMilestone.updateOne({ _id: m._id, 'history.text': { $ne: ev.titleZh || ev.title } }, update);
  }
  if (hit.length) {
    await FrontierEvent.updateOne({ _id: ev._id }, { $addToSet: { milestoneIds: { $each: hit.map((m) => m._id) } } });
  }
}

async function proposeNewDrug(ev: IFrontierEvent, raw: LlmAnalysis, known: Array<{ drug: string; aliases?: string[] }>, corpus: string): Promise<void> {
  const d = raw.newAiDrug;
  const drug = String(d?.drug ?? '').trim();
  // 药名必须在原文里出现过，且不在记分板上（含别名）
  if (!drug || drug.length < 3 || !keywordHit(corpus, drug)) return;
  const lower = drug.toLowerCase();
  if (known.some((k) => k.drug.toLowerCase() === lower || (k.aliases ?? []).some((a) => a.toLowerCase() === lower))) return;
  const symbol = String(d?.symbol ?? '').toUpperCase();
  await FrontierMilestone.updateOne(
    { drug },
    {
      $setOnInsert: {
        drug,
        aliases: [drug],
        company: String(d?.company ?? '').slice(0, 80),
        symbol: isTickerShape(symbol) ? symbol : null,
        approach: String(d?.approach ?? '').slice(0, 120),
        indication: String(d?.indication ?? '').slice(0, 80),
        status: 'proposed',
        source: 'ai',
        history: [{ at: new Date(), kind: 'event', text: ev.titleZh || ev.title, url: ev.sources[0]?.url }],
        proposals: [],
      },
    },
    { upsert: true },
  );
  log('frontier:analyze', `AI 药物候选：${drug}（待确认）`);
}

export async function deepAnalyze(config: MonitorConfig, themes: LoadedTheme[]): Promise<number> {
  await connectToDatabase();
  const since = new Date(Date.now() - MAX_WINDOW_DAYS * 24 * 3600_000);
  // SEC 交易申报在分拣时只看得到条目编号，常被低估；只要不是噪音就读原文，交易表靠它们
  const queue = await FrontierEvent.find({
    $or: [{ importance: { $gte: MIN_IMPORTANCE } }, { importance: { $gte: 2 }, 'sources.source': 'deal' }],
    analyzedAt: null,
    dismissed: false,
    analysisAttempts: { $lt: MAX_ATTEMPTS },
    firstSeenAt: { $gte: since },
  })
    .sort({ importance: -1, firstSeenAt: -1 })
    .limit(PER_RUN);

  let done = 0;
  for (const ev of queue) {
    if (!(await hasBudget(config, 'deep'))) {
      log('frontier:analyze', '今日深度分析额度已用完，剩余事件顺延');
      break;
    }
    const corpus = await gatherCorpus(config, ev);
    const { hit, allNames, all } = await matchMilestones(`${corpus.text} ${ev.title}`);
    const reply = await frontierLlm(config, 'deep', buildPrompt(ev, themes, corpus.text, hit, allNames));
    const raw = reply ? parseJsonLoose<LlmAnalysis>(reply) : null;
    if (!raw || typeof raw !== 'object') {
      await FrontierEvent.updateOne({ _id: ev._id }, { $inc: { analysisAttempts: 1 } });
      continue;
    }
    const analysis = validateAnalysis(raw, corpus.text, corpus.fullText);
    const betterTitle = String(raw.titleZh ?? '').trim().slice(0, 80);
    const importance = reassess(ev.importance ?? 3, raw.importance);
    await FrontierEvent.updateOne(
      { _id: ev._id },
      {
        $set: { analysis, analyzedAt: new Date(), importance, ...(betterTitle ? { titleZh: betterTitle } : {}) },
        $inc: { analysisAttempts: 1 },
      },
    );
    if (betterTitle) ev.titleZh = betterTitle;
    if (raw.deal && (ev.eventType === 'deal' || ev.eventType === 'acquisition' || raw.deal.buyer)) {
      await saveDeal(ev, raw.deal, corpus.text, themes, analysis.summary);
    }
    await linkMilestones(ev, hit, raw);
    await proposeNewDrug(ev, raw, all, corpus.text);
    const unverified = analysis.facts.filter((f) => !f.verified).length;
    log('frontier:analyze', `${ev.titleZh || ev.title}：事实 ${analysis.facts.length} 条（未核实 ${unverified}），受益链 ${analysis.beneficiaries.length}`);
    done++;
  }
  return done;
}
