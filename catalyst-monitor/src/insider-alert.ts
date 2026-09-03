import { log, logError } from './config';
import { getKv, setKv } from './store';
import { pushMessage } from './notify';
import { ACTION_PREFIX, ACTION_WORDS, extractAction } from './analyze';
import { fetchDailyBars, formingSessionDate, etToday } from './alpaca-daily';
import { InsiderInsight, InsiderTrade } from '@/database/models/insider.model';
import { resolveLlmConfig } from '@/lib/llm-config';
import { callAIProviderWithConfig } from '@/lib/ai-provider';
import { completedBars, computeDipStats, type DipStats } from '../../lib/ai-dips-math';
import {
  formatUsdCompact,
  shiftDate,
  summarizeInsiderTxs,
  txAmountUsd,
  type InsiderSummary,
  type InsiderTx,
  type NotifyReason,
} from '../../lib/insider-math';
import { AI_BENCHMARK, recordSignal } from './signals';
import type { MonitorConfig } from './types';

/**
 * 内部人提醒的共享管线：Finnhub 轮询（insider）与 EDGAR 即时监控
 * （insider-edgar）都汇到这里——行情上下文 + 近 90 日净动向 + LLM 分析 +
 * Bark 推送 + 洞察入库，并做跨源去重（同一 symbol 同一申报日只报一次，
 * 避免 EDGAR 先报、Finnhub 摄取后又报同一笔）。
 */

// 页面与聚合统计的回看窗口（天）
export const WINDOW_DAYS = 90;
// 集中卖出判定：7 日内 ≥3 名不同内部人卖出
export const CLUSTER_DAYS = 7;
export const CLUSTER_MIN_SELLERS = 3;

/** decideNotify 的三类 + Form 144 拟卖预告 */
export type AlertReason = NotifyReason | 'intentSell';

export interface InsiderAlertItem {
  tx: InsiderTx;
  reason: AlertReason;
  /** Form 144 预告：尚未成交的拟卖出 */
  intent?: boolean;
}

const REASON_ZH: Record<AlertReason, string> = {
  buy: '内部人买入',
  largeSell: '内部人大额卖出',
  clusterSell: '内部人集中卖出',
  intentSell: '内部人拟卖出（144 预告）',
};

const alertedKey = (symbol: string, filingDate: string, intent: boolean) =>
  `insider_alerted:${symbol}:${filingDate}:${intent ? 'intent' : 'executed'}`;

export const fmtTx = (tx: InsiderTx, intent = false): string => {
  const side = intent ? '拟卖出' : tx.transactionCode === 'P' ? '买入' : '卖出';
  const amount = txAmountUsd(tx);
  const price = !intent && tx.transactionPrice > 0 ? ` @ $${tx.transactionPrice.toFixed(2)}` : '';
  const usd = amount !== null ? ` ≈ ${formatUsdCompact(amount)}` : '（金额未知）';
  return `${tx.name} ${tx.transactionDate.slice(5)} ${side} ${Math.abs(tx.change).toLocaleString('en-US')} 股${price}${usd}`;
};

const fmtSummary = (s: InsiderSummary): string =>
  `近 ${WINDOW_DAYS} 日内部人：买 ${s.buyCount} 笔 ${formatUsdCompact(s.buyUsd)} / 卖 ${s.sellCount} 笔 ${formatUsdCompact(s.sellUsd)}，净${s.netUsd >= 0 ? '买入' : '卖出'} ${formatUsdCompact(Math.abs(s.netUsd))}`;

const fmtPct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

const fmtDipLine = (symbol: string, stats: DipStats | null): string =>
  stats
    ? `${symbol} 收 $${stats.lastClose.toFixed(2)}，连跌 ${stats.streakDays} 天 累计 ${fmtPct(stats.streakDeclinePct)}（30 日回撤 ${fmtPct(stats.drawdownFromHighPct)}）`
    : `${symbol} 无行情数据`;

const itemLine = (item: InsiderAlertItem): string => {
  const suffix = item.intent
    ? `（Form 144 预告，申报 ${item.tx.filingDate}，尚未成交）`
    : `（申报 ${item.tx.filingDate}）`;
  return `- ${fmtTx(item.tx, item.intent)}${suffix}`;
};

/**
 * 用户核心纪律「不管基本面如何，不能买贵」写死在 prompt 里：
 * 内部人买入公布时（Form 4 有 T+2 延迟）价格往往已反应，
 * 回撤不足时必须提示勿追高，只有跌得够深利好才值得低吸。
 */
function buildPrompt(
  meta: { symbol: string; name: string },
  stats: DipStats | null,
  items: InsiderAlertItem[],
  summary: InsiderSummary
): string {
  return (
    '你是美股 AI 板块低吸监控助手，用户是中国投资者，核心纪律是：' +
    '「不管基本面如何，不能买贵」——利好（含内部人买入）公布前股价往往已提前反应，' +
    '若当前股价并未处于回撤低位（连跌很短、30 日回撤很小甚至接近高位），' +
    '即使出现内部人买入也必须提示谨慎/观望，防止追高；只有回撤充分时利好才值得低吸。\n\n' +
    `标的: ${meta.symbol} ${meta.name}\n` +
    `当前行情: ${fmtDipLine(meta.symbol, stats)}\n` +
    '本次触发的内部人动向（Form 4 为已成交申报、有 T+2 延迟；Form 144 为拟卖出预告、下单当天提交）:\n' +
    items.map(itemLine).join('\n') +
    `\n${fmtSummary(summary)}\n\n` +
    '请用简体中文输出不超过 200 字的纯文本（不要 markdown）：' +
    '先一句话概括本次内部人动向及其信号强度；' +
    '再结合当前回撤位置判断是否符合"买得便宜"的纪律——回撤不足时明确提示勿追高；' +
    `最后一行必须是"${ACTION_PREFIX}X"，X 只能从【${ACTION_WORDS.join(' / ')}】中选一个，` +
    '后接一句执行说明（时机/仓位/等待信号）。'
  );
}

async function analyzeTrigger(
  scope: string,
  meta: { symbol: string; name: string },
  stats: DipStats | null,
  items: InsiderAlertItem[],
  summary: InsiderSummary
): Promise<string | null> {
  const llm = await resolveLlmConfig();
  if (!llm) {
    log(scope, 'LLM 未配置，跳过分析');
    return null;
  }
  try {
    const start = Date.now();
    const reply = await callAIProviderWithConfig(buildPrompt(meta, stats, items, summary), {
      name: llm.provider,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      model: llm.model,
    });
    const analysis = reply.trim().slice(0, 500);
    log(scope, `${meta.symbol} 分析完成（${Date.now() - start}ms）`);
    return analysis;
  } catch (err) {
    logError(`${scope}:analyze`, err);
    return null;
  }
}

/** 库里查该 symbol 近 7 日 S 单，供 decideNotify 的集中卖出判定 */
export async function recentSellsFromDb(symbol: string, sinceDate: string): Promise<InsiderTx[]> {
  const docs = await InsiderTrade.find({
    symbol,
    transactionCode: 'S',
    transactionDate: { $gte: sinceDate },
  }).lean();
  return docs.map((d) => ({
    symbol: d.symbol, name: d.name, change: d.change, transactionPrice: d.transactionPrice,
    transactionCode: d.transactionCode, transactionDate: d.transactionDate, filingDate: d.filingDate,
  }));
}

/**
 * 对每个触发 symbol：跨源/冷却去重 → 行情+净动向上下文 → LLM → 洞察入库 →
 * Bark。返回实际送达的 symbol 集合（调用方据此标记自己的数据行）。
 * LLM 失败不阻塞推送（body 退化为交易概要）。
 */
export async function notifyInsiderTriggers(
  scope: string,
  config: MonitorConfig,
  pool: Array<{ symbol: string; name: string }>,
  triggers: Map<string, InsiderAlertItem[]>
): Promise<Set<string>> {
  const delivered = new Set<string>();
  if (triggers.size === 0) return delivered;
  const today = etToday();
  const from = shiftDate(today, -WINDOW_DAYS);

  // 逐 symbol 过滤：同一申报日已报过（跨源）或集中卖出冷却期内的项剔除
  const effective = new Map<string, InsiderAlertItem[]>();
  for (const [symbol, items] of triggers) {
    const kept: InsiderAlertItem[] = [];
    for (const item of items) {
      if (await getKv(alertedKey(symbol, item.tx.filingDate, Boolean(item.intent)))) continue;
      if (item.reason === 'clusterSell') {
        const lastNotified = await getKv(`insider_cluster_notified:${symbol}`);
        if (lastNotified && lastNotified >= shiftDate(today, -CLUSTER_DAYS)) continue;
      }
      kept.push(item);
    }
    if (kept.length > 0) effective.set(symbol, kept);
  }
  if (effective.size === 0) return delivered;

  // 行情上下文：仅为触发标的拉日线（未配 Alpaca 则降级为无行情分析）
  let barsBySymbol: Record<string, Array<{ date: string; c: number }>> = {};
  const excludeDate = formingSessionDate();
  if (config.env.alpacaKey && config.env.alpacaSecret) {
    try {
      barsBySymbol = await fetchDailyBars(config, [...effective.keys()]);
    } catch (err) {
      logError(`${scope}:bars`, err);
    }
  }

  const siteUrl = process.env.BETTER_AUTH_URL;
  for (const [symbol, items] of effective) {
    const meta = pool.find((m) => m.symbol === symbol) ?? { symbol, name: symbol };
    const stats = computeDipStats(completedBars(barsBySymbol[symbol] ?? [], excludeDate));
    const summary = summarizeInsiderTxs(await recentSellsAndBuys(symbol, from), today, WINDOW_DAYS);

    const analysis = await analyzeTrigger(scope, meta, stats, items, summary);
    const action = extractAction(analysis);
    if (analysis) {
      await InsiderInsight.findOneAndUpdate(
        { symbol },
        { $set: { analysis, action, trigger: items.map((i) => fmtTx(i.tx, i.intent)).join('；') } },
        { upsert: true }
      );
    }

    // 标题取最强信号：买入 > 已成交卖出 > 拟卖预告
    const reason: AlertReason = items.some((i) => i.reason === 'buy')
      ? 'buy'
      : (items.find((i) => i.reason !== 'intentSell') ?? items[0]).reason;
    const first = items[0];
    const firstAmount = txAmountUsd(first.tx);
    const title =
      `${REASON_ZH[reason]}${action ? `【${action}】` : ''}｜${symbol} ` +
      (items.length === 1
        ? `${first.tx.transactionCode === 'P' ? '增持' : '减持'}${firstAmount !== null ? ' ' + formatUsdCompact(firstAmount) : ''}`
        : `${items.length} 笔`);
    const body =
      `${fmtDipLine(symbol, stats)}\n` +
      items.map((i) => fmtTx(i.tx, i.intent)).join('\n') + '\n' +
      `${fmtSummary(summary)}\n` +
      (analysis ? `AI 分析: ${analysis}\n` : '') +
      '数据源 SEC EDGAR/Finnhub（Form 4 有 T+2 申报延迟），不构成投资建议';

    const ok = await pushMessage(config.env, {
      title,
      body,
      urgent: false,
      url: siteUrl ? `${siteUrl}/ai-dips` : undefined,
    });
    if (ok) {
      delivered.add(symbol);
      for (const item of items) {
        await setKv(alertedKey(symbol, item.tx.filingDate, Boolean(item.intent)), today);
      }
      if (items.some((i) => i.reason === 'clusterSell')) {
        await setKv(`insider_cluster_notified:${symbol}`, today);
      }
    }
    log(scope, `${symbol} 触发 ${items.length} 笔（${reason}，推送${ok ? '成功' : '未送达'}）`);
    // 账本：买入看多、各类卖出看空；同一 symbol 同一申报日记一条
    await recordSignal({
      kind: `insider.${reason}`,
      symbol,
      dedupeKey: first.tx.filingDate,
      direction: reason === 'buy' ? 'up' : 'down',
      action,
      title,
      benchmark: AI_BENCHMARK,
      delivered: ok,
    });
  }
  return delivered;
}

/** 近 windowDays 全部 P/S（页面口径一致），供净动向汇总 */
async function recentSellsAndBuys(symbol: string, from: string): Promise<InsiderTx[]> {
  const docs = await InsiderTrade.find({ symbol, transactionDate: { $gte: from } }).lean();
  return docs.map((d) => ({
    symbol: d.symbol, name: d.name, change: d.change, transactionPrice: d.transactionPrice,
    transactionCode: d.transactionCode, transactionDate: d.transactionDate, filingDate: d.filingDate,
  }));
}
