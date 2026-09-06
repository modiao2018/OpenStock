import { log, logError } from '../config';
import { fetchWithRetry } from '../http';
import { etToday } from '../alpaca-daily';
import { getKv, setKv } from '../store';
import { pushMessage } from '../notify';
import { recordSignal } from '../signals';
import { connectToDatabase } from '@/database/mongoose';
import { Thesis, type IThesis, type ThesisFollowup } from '@/database/models/thesis.model';
import { CatalystEvent } from '@/database/models/catalyst.model';
import { InsiderTrade } from '@/database/models/insider.model';
import { Signal } from '@/database/models/signal.model';
import { callAIProviderWithConfig } from '@/lib/ai-provider';
import { resolveLlmConfig } from '@/lib/llm-config';
import { frameThesis } from '@/lib/thesis-framing';
import {
  DIRECTION_ZH,
  THESIS_BENCHMARK,
  TRIGGER_ZH,
  evaluateThesis,
  fmtPct,
  fmtPrice,
  formatThesisStatus,
  matchesThesisKeywords,
  thesisPushTitle,
  type ThesisEvaluation,
  type ThesisNewItem,
} from '../../../lib/thesis-math';
import type { MonitorConfig, NewEvent } from '../types';

const ALPACA_TRADES = 'https://data.alpaca.markets/v2/stocks/trades/latest';
const FINNHUB_QUOTE = 'https://finnhub.io/api/v1/quote';
const FINNHUB_NEWS = 'https://finnhub.io/api/v1/company-news';
// 首次检查回看多久的事件（避免把建档前的旧事件当"新信息"）
const FIRST_CHECK_LOOKBACK_MS = 6 * 3600_000;
// 免费 API 的额度是和网页端、内部人采集器共用的，这里几道闸：
// 公司新闻每个标的最多每小时查一次（Finnhub 60/min，新闻本来也不需要 15 分钟刷）
const NEWS_MIN_INTERVAL_MS = 60 * 60_000;
// Finnhub 逐次调用之间留间隔，和 insider 采集器一样串行
const FINNHUB_GAP_MS = 1100;
// 框架补生成失败（LLM 慢/挂）后最多每小时重试一次，别每轮都撞
const FRAMING_RETRY_MS = 60 * 60_000;
// 美东盘前盘后之外（20:00–04:00 ET）价格不动，每小时只跑一轮
const QUIET_HOURS_INTERVAL_MS = 60 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const etHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', hour12: false });
const framingRetryAt = new Map<string, number>();
let running = false;

const SOURCE_ZH: Record<string, string> = {
  clinicaltrials: '临床试验',
  edgar: 'SEC 申报',
  halts: '停牌',
  rss: '新闻',
  market: '盘面异动',
};
const SIGNAL_KIND_ZH: Record<string, string> = {
  'insider.buy': '内部人买入',
  'insider.largeSell': '内部人大额卖出',
  'insider.clusterSell': '内部人集中卖出',
  'insider.intentSell': '内部人拟卖出',
  'aidips.streak5': '连跌 5 天',
  'aidips.streak7': '连跌 7 天',
  'aidips.streak10': '连跌 10 天',
  'reminder.t7': '催化剂 7 天后',
  'reminder.t1': '催化剂明天',
};

/** 最新成交价：Alpaca 批量优先（盘中实时），缺 key 或失败时逐只回落 Finnhub 报价 */
async function loadPrices(config: MonitorConfig, symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (symbols.length === 0) return out;
  if (config.env.alpacaKey && config.env.alpacaSecret) {
    try {
      const url = `${ALPACA_TRADES}?symbols=${symbols.join(',')}&feed=iex`;
      const res = await fetchWithRetry(url, {
        headers: { 'APCA-API-KEY-ID': config.env.alpacaKey, 'APCA-API-SECRET-KEY': config.env.alpacaSecret },
      }, { timeoutMs: 15_000 });
      if (res.ok) {
        const data = (await res.json()) as { trades?: Record<string, { p?: number }> };
        for (const [s, t] of Object.entries(data.trades ?? {})) if (t?.p && t.p > 0) out.set(s, t.p);
      }
    } catch (err) {
      logError('thesis:alpaca', err);
    }
  }
  const missing = symbols.filter((s) => !out.has(s));
  if (missing.length > 0 && config.env.finnhubKey) {
    for (const [i, s] of missing.entries()) {
      if (i > 0) await sleep(FINNHUB_GAP_MS);
      try {
        const res = await fetchWithRetry(`${FINNHUB_QUOTE}?symbol=${encodeURIComponent(s)}&token=${config.env.finnhubKey}`, {}, { timeoutMs: 10_000 });
        if (!res.ok) continue;
        const q = (await res.json()) as { c?: number };
        if (q.c && q.c > 0) out.set(s, q.c);
      } catch (err) {
        logError('thesis:finnhub', err);
      }
    }
  }
  return out;
}

/**
 * 任意标的的公司新闻（Finnhub）：催化剂清单/AI 池之外的股票没有事件采集，
 * 用户随手记的点子多半就是这种。只保留命中 AI 框架关键词或代码的条目，
 * 免得财经媒体的例行提及把用户吵醒。
 */
async function loadCompanyNews(config: MonitorConfig, symbol: string, since: Date, keywords: string[]): Promise<ThesisNewItem[]> {
  if (!config.env.finnhubKey) return [];
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = `${FINNHUB_NEWS}?symbol=${encodeURIComponent(symbol)}&from=${fmt(since)}&to=${fmt(new Date())}&token=${config.env.finnhubKey}`;
  try {
    const res = await fetchWithRetry(url, {}, { timeoutMs: 10_000 });
    if (!res.ok) return [];
    const list = (await res.json()) as Array<{ headline?: string; summary?: string; source?: string; datetime?: number }>;
    const sinceSec = since.getTime() / 1000;
    return list
      .filter((a) => a.headline && (a.datetime ?? 0) >= sinceSec)
      .filter((a) => matchesThesisKeywords(`${a.headline} ${a.summary ?? ''}`, keywords, symbol))
      .slice(0, 6)
      .map((a) => ({ kind: `新闻·${a.source ?? 'Finnhub'}`, title: a.headline!.slice(0, 160), urgent: false }));
  } catch (err) {
    logError('thesis:news', err);
    return [];
  }
}

/** 网页保存时框架没生成（LLM 超时/未配置/用户补充了想法）→ 这里补 */
async function ensureFraming(t: IThesis): Promise<void> {
  if (t.framing) return;
  const id = String(t._id);
  const retryAt = framingRetryAt.get(id) ?? 0;
  if (Date.now() < retryAt) return;
  try {
    const framing = await frameThesis({ symbol: t.symbol, name: t.name, direction: t.direction, note: t.note });
    if (framing) {
      t.framing = framing;
      t.markModified('framing');
      await t.save();
      framingRetryAt.delete(id);
      log('thesis', `${t.symbol} 想法已梳理成框架：${framing.thesis}`);
      return;
    }
  } catch (err) {
    logError('thesis:framing', err);
  }
  framingRetryAt.set(id, Date.now() + FRAMING_RETRY_MS);
}

/** 上次检查以来该标的的新事件 / 内部人交易 / 其他模块的信号 */
async function loadNewItems(symbol: string, since: Date): Promise<ThesisNewItem[]> {
  const items: ThesisNewItem[] = [];
  const events = await CatalystEvent.find({ symbol, fetchedAt: { $gte: since }, firstSnapshot: { $ne: true } }).sort({ fetchedAt: -1 }).limit(10).lean();
  for (const e of events) items.push({ kind: SOURCE_ZH[e.source] ?? e.source, title: e.title, urgent: e.severity === 'urgent' });
  const trades = await InsiderTrade.find({ symbol, createdAt: { $gte: since }, firstSeen: { $ne: true } }).sort({ createdAt: -1 }).limit(10).lean();
  for (const t of trades) {
    const amt = t.amountUsd ? ` $${Math.round(t.amountUsd / 1000)}K` : '';
    items.push({ kind: '内部人', title: `${t.name} ${t.transactionCode === 'P' ? '买入' : '卖出'}${amt}（${t.transactionDate}）`, urgent: false });
  }
  const signals = await Signal.find({ symbol, firedAt: { $gte: since }, kind: { $not: /^(thesis|event)\./ } }).sort({ firedAt: -1 }).limit(10).lean();
  for (const s of signals) items.push({ kind: SIGNAL_KIND_ZH[s.kind] ?? s.kind, title: s.title, urgent: false });
  return items;
}

interface Snapshot {
  price: number | null;
  today: string;
  evaluation: ThesisEvaluation;
  newItems: ThesisNewItem[];
}

function statusLine(t: IThesis, snap: Snapshot): string {
  return formatThesisStatus({
    symbol: t.symbol,
    direction: t.direction,
    entryPrice: t.entryPrice ?? null,
    price: snap.price,
    changePct: snap.evaluation.changePct,
    targetPrice: t.targetPrice ?? null,
    stopPrice: t.stopPrice ?? null,
    daysLeft: snap.evaluation.daysLeft,
  });
}

/** AI 对照用户的思考给点评；LLM 未配置或失败时退回纯状态行 */
async function composeNote(t: IThesis, snap: Snapshot): Promise<string> {
  const status = statusLine(t, snap);
  const llm = await resolveLlmConfig();
  if (!llm) return status;

  const history = (t.followups ?? []).slice(-3).map((f) => `- ${new Date(f.at).toISOString().slice(0, 10)} ${fmtPrice(f.price)}：${f.note.slice(0, 120)}`).join('\n');
  const triggers = snap.evaluation.triggers.map((x) => `${TRIGGER_ZH[x.id]}：${x.detail}`).join('\n');
  const items = snap.newItems.map((n) => `- [${n.kind}] ${n.title}`).join('\n');
  const final = snap.evaluation.expired;

  const fr = t.framing;
  const framingBlock = fr
    ? `AI 此前把想法梳理为：\n观点：${fr.thesis}\n兑现的迹象：${fr.confirm.join('；') || '（无）'}\n不成立的迹象：${fr.refute.join('；') || '（无）'}\n`
    : '';
  const prompt =
    '你是用户的投资笔记助手，用户是中国投资者，不熟悉行业术语。用户之前对一只美股随手记了一个想法——' +
    '可能只是一个方向或点子，不一定有明确的价格和指标，这很正常，不要苛责。现在到了该提醒的时候。' +
    '请对照用户原话和梳理出的框架，用简体中文输出不超过 180 字的纯文本（不要 markdown、不要列表符号）：' +
    (final
      ? '这是最终回顾：1) 一句话说想法有没有兑现，用能看到的事实说话（价格只是其中一项）；' +
        '2) 一句话说这次判断的经验教训；3) 最后一行必须是"结论：兑现 / 证伪 / 不明确"三选一，不清楚就选不明确。'
      : '1) 一句话说明这次为什么提醒；2) 对照想法说现在的证据是加强了、削弱了还是没变化——新消息比价格更重要，' +
        '引用具体事实；3) 如果想法还不成熟，帮用户往前推一步：指出接下来最值得弄清楚的一件事；' +
        '4) 最后一行必须是"建议：X"，X 只能从【按计划执行 / 继续观察 / 考虑止损 / 考虑止盈 / 重新评估】中选一个，' +
        '后接一句执行说明。没有目标价/失效价时不要假装有，按"继续观察"或"重新评估"处理。') +
    '不要编造用户没提供的信息，不要给出确定性的价格预测。\n\n' +
    `标的: ${t.symbol}（${t.name}）\n倾向: ${DIRECTION_ZH[t.direction]}\n记录于: ${new Date(t.createdAt).toISOString().slice(0, 10)}，截止 ${t.horizonDate}\n` +
    `用户的原话:\n${t.note}\n\n${framingBlock}当前状态: ${status}\n触发原因:\n${triggers || '（无）'}\n` +
    `上次检查以来的新信息:\n${items || '（无）'}\n` +
    (history ? `此前跟进记录:\n${history}\n` : '');

  try {
    const reply = await callAIProviderWithConfig(prompt, { name: llm.provider, apiKey: llm.apiKey, baseUrl: llm.baseUrl, model: llm.model });
    const text = reply.trim().slice(0, 600);
    return text || status;
  } catch (err) {
    logError('thesis:llm', err);
    return status;
  }
}

/**
 * 洞察跟进：对每条进行中的用户观点取现价，判断是否到了该提醒的时候
 * （触及目标/失效价、到期、紧急事件、新信息、大幅波动、定期回顾），
 * 提醒时让 AI 对照用户原话给点评并 Bark 推送。用户已明确表示关注，
 * 所以不走关注分闸门；截止日过后做最终回顾并结束。不产生时间线事件。
 */
export async function collectThesis(config: MonitorConfig): Promise<NewEvent[]> {
  // LLM 慢的时候一轮可能超过 15 分钟，下一轮直接跳过而不是叠着跑
  if (running) {
    log('thesis', '上一轮尚未结束，跳过');
    return [];
  }
  running = true;
  try {
    return await runThesis(config);
  } finally {
    running = false;
  }
}

async function runThesis(config: MonitorConfig): Promise<NewEvent[]> {
  await connectToDatabase();
  const active = await Thesis.find({ status: 'active' });
  if (active.length === 0) {
    log('thesis', '无进行中的跟进');
    return [];
  }

  const now = new Date();
  const hour = Number(etHour.format(now));
  if (hour >= 20 || hour < 4) {
    const last = Number((await getKv('thesis_quiet_last_run')) ?? '0');
    if (now.getTime() - last < QUIET_HOURS_INTERVAL_MS) return [];
    await setKv('thesis_quiet_last_run', String(now.getTime()));
  }

  const symbols = [...new Set(active.map((t) => t.symbol))];
  const prices = await loadPrices(config, symbols);
  const today = etToday();
  const siteUrl = process.env.BETTER_AUTH_URL;
  let pushed = 0;
  let retired = 0;
  // 同一标的多条想法只查一次新闻；每个标的每小时最多查一次
  const newsCache = new Map<string, ThesisNewItem[]>();
  const loadNewsThrottled = async (t: IThesis, since: Date): Promise<ThesisNewItem[]> => {
    const cached = newsCache.get(t.symbol);
    if (cached) return cached;
    const key = `thesis_news_at:${t.symbol}`;
    const lastAt = Number((await getKv(key)) ?? '0');
    if (now.getTime() - lastAt < NEWS_MIN_INTERVAL_MS) return [];
    if (newsCache.size > 0) await sleep(FINNHUB_GAP_MS);
    // 窗口从上次真正查新闻的时刻起（被节流跳过的那几轮不能漏）；首次用最早的 since；关键词取同标的并集
    const siblings = active.filter((x) => x.symbol === t.symbol);
    const earliest = siblings.reduce((m, x) => (x.lastCheckedAt && x.lastCheckedAt < m ? x.lastCheckedAt : m), since);
    const from = lastAt > 0 ? new Date(Math.min(lastAt, earliest.getTime())) : earliest;
    const keywords = [...new Set(siblings.flatMap((x) => x.framing?.keywords ?? []))];
    const items = await loadCompanyNews(config, t.symbol, from, keywords);
    newsCache.set(t.symbol, items);
    await setKv(key, String(now.getTime()));
    return items;
  };

  for (const t of active) {
    try {
      const price = prices.get(t.symbol) ?? null;
      const isFirstCheck = !t.lastCheckedAt;
      const since = t.lastCheckedAt ?? new Date(Math.max(new Date(t.createdAt).getTime(), now.getTime() - FIRST_CHECK_LOOKBACK_MS));
      await ensureFraming(t);
      const newItems = [...(await loadNewItems(t.symbol, since)), ...(await loadNewsThrottled(t, since))];

      // 用户自己的观点也进信号账本：日后能在记分卡里看到"我的判断"命中率
      if (isFirstCheck) {
        await recordSignal({
          kind: 'thesis.open',
          symbol: t.symbol,
          dedupeKey: String(t._id),
          direction: t.direction === 'long' ? 'up' : t.direction === 'short' ? 'down' : 'none',
          title: `${DIRECTION_ZH[t.direction]}：${(t.framing?.thesis ?? t.note).slice(0, 80)}`,
          benchmark: THESIS_BENCHMARK,
          delivered: true,
          firedAt: new Date(t.createdAt),
        });
      }

      const evaluation = evaluateThesis({
        direction: t.direction,
        entryPrice: t.entryPrice ?? null,
        targetPrice: t.targetPrice ?? null,
        stopPrice: t.stopPrice ?? null,
        horizonDate: t.horizonDate,
        today,
        price,
        lastAlertPrice: t.lastAlertPrice ?? null,
        hits: t.hits ?? {},
        newItems,
        createdAtMs: new Date(t.createdAt).getTime(),
        lastFollowupAtMs: t.followups?.length ? new Date(t.followups[t.followups.length - 1].at).getTime() : null,
        nowMs: now.getTime(),
        checkinDays: t.checkinDays,
        movePct: t.movePct,
      });

      t.lastCheckedAt = now;
      if (evaluation.triggers.length === 0) {
        await t.save();
        continue;
      }

      const snap: Snapshot = { price, today, evaluation, newItems };
      const note = await composeNote(t, snap);
      const urgent = evaluation.triggers.some((x) => x.urgent);
      const reasons = evaluation.triggers.map((x) => `· ${TRIGGER_ZH[x.id]}：${x.detail}`).join('\n');
      const body =
        `${statusLine(t, snap)}\n${reasons}\n\n${note}\n\n你当时的想法：${(t.framing?.thesis ?? t.note).replace(/\s+/g, ' ').slice(0, 160)}` +
        (evaluation.expired ? '\n（已到截止日，本条跟进自动结束；可在关注队列页重新打开）' : '\n（不想再跟进可在关注队列页关闭）');
      const delivered = await pushMessage(config.env, {
        title: thesisPushTitle(t.symbol, evaluation.triggers),
        body,
        urgent,
        url: siteUrl ? `${siteUrl}/focus` : undefined,
      });

      const followup: ThesisFollowup = { at: now, triggers: evaluation.triggers.map((x) => x.id), price, note, delivered };
      t.followups.push(followup);
      t.lastAlertPrice = price ?? t.lastAlertPrice ?? null;
      const hits = { ...(t.hits ?? {}) };
      for (const x of evaluation.triggers) {
        if (x.id === 'target') hits.target = true;
        if (x.id === 'stop') hits.stop = true;
        if (x.id === 'horizonSoon') hits.horizonSoon = true;
      }
      t.hits = hits;
      t.markModified('hits');
      if (evaluation.expired) {
        t.status = 'expired';
        t.closedAt = now;
        const m = note.match(/结论[：:]\s*(兑现|证伪|不明确)/);
        t.outcome = m?.[1] === '兑现' ? 'confirmed' : m?.[1] === '证伪' ? 'refuted' : null;
        retired++;
      }
      await t.save();
      pushed++;
      log('thesis', `${t.symbol} 跟进推送（${evaluation.triggers.map((x) => x.id).join('+')}，现价 ${fmtPrice(price)} ${fmtPct(evaluation.changePct)}，${delivered ? '已送达' : '未送达'}）`);
    } catch (err) {
      logError(`thesis:${t.symbol}`, err);
    }
  }

  log('thesis', `${active.length} 条进行中，推送 ${pushed}，到期结束 ${retired}`);
  return [];
}
