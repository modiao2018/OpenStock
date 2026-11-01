import { callAIProviderWithConfig } from '@/lib/ai-provider';
import { resolveLlmConfig } from '@/lib/llm-config';
import { beijingDateOf, canSpend, type LlmPurpose } from '@/lib/frontier-math';
import { log, logError } from '../config';
import { getKv, setKv } from '../store';
import type { MonitorConfig } from '../types';

/**
 * 生物科技前沿的 LLM 调用入口：所有调用都过这里记账，按北京日期统计，
 * 超出每日额度后分拣降级为规则兜底、深度分析顺延。额度存 KV（页面可改）。
 */

export const BUDGET_KEY = 'frontier_llm_budget';
export const usageKey = (date: string) => `frontier_llm_usage:${date}`;

export interface LlmUsage {
  total: number;
  triage: number;
  deep: number;
  weekly: number;
}

const EMPTY: LlmUsage = { total: 0, triage: 0, deep: 0, weekly: 0 };

export async function readUsage(date = beijingDateOf(new Date())): Promise<LlmUsage> {
  const raw = await getKv(usageKey(date));
  if (!raw) return { ...EMPTY };
  try {
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<LlmUsage>) };
  } catch {
    return { ...EMPTY };
  }
}

export async function readBudget(config: MonitorConfig): Promise<number> {
  const raw = Number(await getKv(BUDGET_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : config.frontier.dailyLlmBudget;
}

/** 本次用途还有没有额度（不扣减；真正调用时才记账） */
export async function hasBudget(config: MonitorConfig, purpose: LlmPurpose): Promise<boolean> {
  const [usage, budget] = await Promise.all([readUsage(), readBudget(config)]);
  return canSpend(purpose, usage.total, budget);
}

/**
 * 调一次 LLM：未配置或额度不足返回 null（调用方走兜底），失败也返回 null。
 * 调用前先记账——即便失败也算一次，防止故障时疯狂重试刷爆额度。
 */
export async function frontierLlm(config: MonitorConfig, purpose: LlmPurpose, prompt: string): Promise<string | null> {
  const llm = await resolveLlmConfig();
  if (!llm) return null;
  const date = beijingDateOf(new Date());
  const [usage, budget] = await Promise.all([readUsage(date), readBudget(config)]);
  if (!canSpend(purpose, usage.total, budget)) {
    log('frontier:llm', `今日额度已用 ${usage.total}/${budget}，跳过 ${purpose}`);
    return null;
  }
  usage.total++;
  usage[purpose]++;
  await setKv(usageKey(date), JSON.stringify(usage));
  try {
    const start = Date.now();
    const reply = await callAIProviderWithConfig(prompt, {
      name: llm.provider,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      model: llm.model,
    });
    log('frontier:llm', `${purpose} 完成（${Date.now() - start}ms，今日第 ${usage.total}/${budget} 次）`);
    return reply;
  } catch (err) {
    logError(`frontier:llm:${purpose}`, err);
    return null;
  }
}

export async function llmConfigured(): Promise<boolean> {
  return (await resolveLlmConfig()) !== null;
}
