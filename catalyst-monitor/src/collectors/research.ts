import { log, logError } from '../config';
import { fetchWithRetry } from '../http';
import { getKv, setKv } from '../store';
import { pushMessage } from '../notify';
import { fetchDailyBars, formingSessionDate } from '../alpaca-daily';
import { completedBars } from '../../../lib/ai-dips-math';
import { listThemes, readMomentum, reviseTheme, saveMomentum } from '../../../lib/research-themes';
import { RESEARCH_RECHECK_MS } from '../../../lib/research-math';
import { recomputeMomentum } from '../../../lib/research-momentum';
import { describeMarketForPrompt, normalizeMarket, type FinnhubMetricPayload } from '../../../lib/ai-profile-math';
import type { MonitorConfig, NewEvent } from '../types';

const FINNHUB = 'https://finnhub.io/api/v1';
// Finnhub 逐次调用之间留间隔，和 insider / thesis 采集器一样串行
const FINNHUB_GAP_MS = 1100;
const NEWS_LOOKBACK_DAYS = 7;
const NEWS_PER_SYMBOL = 5;
// 45 个交易日窗口 + 50 日均线：约 100 个日历日的日线才够
const MOMENTUM_LOOKBACK_DAYS = 110;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmtDay = (d: Date) => d.toISOString().slice(0, 10);

/** 每只标的：报价 + 基本财务指标 + 近一周新闻标题，串行拉取以免撞免费额度 */
async function collectFacts(config: MonitorConfig, symbols: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const token = config.env.finnhubKey;
  if (!token) return out;
  const to = new Date();
  const from = new Date(to.getTime() - NEWS_LOOKBACK_DAYS * 86_400_000);
  for (const symbol of symbols) {
    const lines: string[] = [];
    try {
      const q = await fetchWithRetry(`${FINNHUB}/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`, {}, { timeoutMs: 10_000 });
      const quote = q.ok ? ((await q.json()) as { c?: number }) : null;
      await sleep(FINNHUB_GAP_MS);
      const m = await fetchWithRetry(`${FINNHUB}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${token}`, {}, { timeoutMs: 10_000 });
      const metrics = m.ok ? ((await m.json()) as FinnhubMetricPayload) : null;
      await sleep(FINNHUB_GAP_MS);
      const price = typeof quote?.c === 'number' && quote.c > 0 ? quote.c : null;
      const cap = typeof metrics?.metric?.marketCapitalization === 'number' ? (metrics.metric.marketCapitalization as number) : null;
      lines.push(`market: ${describeMarketForPrompt(normalizeMarket(metrics, { price, marketCapUsdM: cap }))}`);

      const n = await fetchWithRetry(
        `${FINNHUB}/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmtDay(from)}&to=${fmtDay(to)}&token=${token}`,
        {},
        { timeoutMs: 10_000 },
      );
      if (n.ok) {
        const list = (await n.json()) as Array<{ headline?: string; datetime?: number; source?: string }>;
        for (const a of list.filter((a) => a.headline).slice(0, NEWS_PER_SYMBOL)) {
          const day = a.datetime ? fmtDay(new Date(a.datetime * 1000)) : '';
          lines.push(`news ${day} (${a.source ?? 'Finnhub'}): ${a.headline!.slice(0, 160)}`);
        }
      }
      await sleep(FINNHUB_GAP_MS);
    } catch (err) {
      logError(`research:facts:${symbol}`, err);
    }
    if (lines.length > 0) out.set(symbol, lines);
  }
  return out;
}

/** 每个交易日收盘后：用 Alpaca 日线重算各主题走势表的数字（涨跌 / 回撤 / 均线 / 基准），文字不动 */
async function refreshMomentum(config: MonitorConfig, slugs: string[]): Promise<void> {
  if (!config.env.alpacaKey || !config.env.alpacaSecret) return;
  const excludeDate = formingSessionDate();
  for (const slug of slugs) {
    try {
      const stored = await readMomentum(slug);
      if (!stored) continue;
      const symbols = stored.momentum.rows.map((r) => r.symbol);
      const all = [...new Set([...symbols, stored.momentum.benchmarkSymbol].filter(Boolean))];
      const raw = await fetchDailyBars(config, all, MOMENTUM_LOOKBACK_DAYS);
      const barsBySymbol: Record<string, typeof raw[string]> = {};
      for (const s of symbols) barsBySymbol[s] = completedBars(raw[s] ?? [], excludeDate);
      const benchmarkBars = completedBars(raw[stored.momentum.benchmarkSymbol] ?? [], excludeDate);
      const sessionDate = Object.values(barsBySymbol).reduce((max, b) => (b[b.length - 1]?.date ?? '') > max ? (b[b.length - 1]?.date ?? '') : max, '');
      if (!sessionDate) continue;
      if ((await getKv(`research_momentum_session:${slug}`)) === sessionDate) continue;
      const next = recomputeMomentum({ current: stored.momentum, barsBySymbol, benchmarkBars, lang: stored.lang });
      await saveMomentum(slug, next);
      await setKv(`research_momentum_session:${slug}`, sessionDate);
      log('research', `${slug} 走势表已按 ${sessionDate} 收盘重算（${symbols.length} 只，基准 ${stored.momentum.benchmarkSymbol} ${next.benchmarkReturnPct ?? '—'}%）`);
    } catch (err) {
      logError(`research:momentum:${slug}`, err);
    }
  }
}

/**
 * 主题研究笔记：每轮先按最新收盘重算走势表数字（每个交易日一次）；每周一次
 * 把每个主题交给 LLM 对照最新行情、财务指标和一周新闻复核，有实质修改时存新
 * 版本并推送变更摘要。不产生时间线事件。
 */
export async function collectResearch(config: MonitorConfig): Promise<NewEvent[]> {
  const themes = await listThemes();
  if (themes.length === 0) return [];
  await refreshMomentum(config, themes.map((t) => t.slug));

  const last = await getKv('research_last_run');
  if (last && Date.now() - new Date(last).getTime() < RESEARCH_RECHECK_MS) return [];
  // 先记时间戳：一次失败也别每小时重跑 LLM
  await setKv('research_last_run', new Date().toISOString());

  for (const theme of themes) {
    try {
      const out = await reviseTheme(theme.slug, { facts: (symbols) => collectFacts(config, symbols) }, 'llm');
      if (out.status === 'updated') {
        log('research', `${theme.slug} 更新到第 ${out.theme.version} 版：${out.changes.length} 处变化`);
        await pushMessage(config.env, {
          title: `主题研究更新｜${out.theme.title}`,
          body: out.changes.slice(0, 6).map((c) => `· ${c}`).join('\n') + (out.changes.length > 6 ? `\n… 共 ${out.changes.length} 处` : ''),
          urgent: false,
        });
      } else if (out.status === 'unchanged') {
        log('research', `${theme.slug} 复核无实质变化`);
      } else if (out.status === 'noLlm') {
        log('research', '未配置 LLM，跳过');
        return [];
      } else {
        log('research', `${theme.slug} 复核失败：${out.reason}`);
      }
    } catch (err) {
      logError(`research:${theme.slug}`, err);
    }
  }
  return [];
}
