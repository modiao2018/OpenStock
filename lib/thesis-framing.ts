// AI structuring for a thesis note. The user types one free-form paragraph —
// often a hunch: "AI power demand keeps rising, maybe VST benefits", a
// direction with no numbers — and the LLM turns it into the structured record
// the daemon can follow up: symbol, lean, optional levels the user *did*
// mention, plus a checkable framing (thesis / confirm / refute / keywords).
// Shared by the create action (web) and the thesis collector (daemon backfill
// when the web call timed out or the LLM was not configured yet). Plain
// server module: no 'use server', no react.

import { callAIProviderWithConfig } from '@/lib/ai-provider';
import { resolveLlmConfig } from '@/lib/llm-config';
import {
    DEFAULT_HORIZON_DAYS,
    DIRECTION_ZH,
    parseStructured,
    type ThesisDirection,
    type ThesisFraming,
    type ThesisStructured,
} from '@/lib/thesis-math';

export interface StructureInput {
    /** The user's raw text */
    text: string;
    /** Stock page: the symbol is already known, the LLM must not guess another */
    fixedSymbol?: string;
    fixedName?: string;
    /** YYYY-MM-DD, for resolving "下周财报前" into a date */
    today: string;
}

export function structurePrompt(i: StructureInput): string {
    const symbolRule = i.fixedSymbol
        ? `标的已确定为 ${i.fixedSymbol}${i.fixedName ? `（${i.fixedName}）` : ''}，symbol 字段必须原样填 "${i.fixedSymbol}"，不要改。`
        : '从原话里识别用户说的是哪只美股：填美股代码（大写，如 NVDA）；用户写的是公司中文名/英文名/绰号也要转成代码；' +
          '实在识别不出就填 null。若提到多只，取用户想操作的那只。';
    return (
        '你是用户的投资笔记助手，用户是中国投资者，不熟悉行业术语。用户随手记了一段对某只美股的想法——' +
        '可能只是一个方向、一句话或一个点子，没有明确的价格和指标，这很正常。' +
        '请把这段话整理成结构化记录，供后续自动跟进用。不要评判想法好坏，不要编造用户没说的信息，' +
        '用户没提的数字一律填 null，不要给价格预测。只输出 JSON，不要其他文字：\n' +
        '{"symbol": "美股代码或 null", "name": "公司名或 null",' +
        ' "direction": "long|short|watch（偏多/偏空/只是想看看，判断不出填 watch）",' +
        ' "entryPrice": 用户提到的买入/当前价格数字或 null, "targetPrice": 用户明确说的目标价/止盈价数字或 null,' +
        ' "stopPrice": 用户明确说的止损价/失效价数字或 null,' +
        ` "horizonDate": "用户提到的时间范围换算成 YYYY-MM-DD（今天是 ${i.today}；'下周财报前'取下周五，'这个月'取月底，'短期'取 ${DEFAULT_HORIZON_DAYS} 天后），没提填 null",` +
        ' "thesis": "用一句大白话复述用户的核心观点（不超过 60 字）",' +
        ' "confirm": ["看到什么事实/消息说明想法在兑现（2-3 条，具体可观察）"],' +
        ' "refute": ["看到什么事实/消息说明想法不成立（2-3 条）"],' +
        ' "keywords": ["跟进时在英文新闻里要盯的关键词：产品名/合作方/事件名/行业词 3-6 个，不要只写公司名"],' +
        ' "questions": ["想法还不成熟时，用户接下来可以自己去弄清楚的 1-3 个问题"]}\n' +
        `${symbolRule}\n\n用户原话:\n${i.text}`
    );
}

/**
 * Returns null when no LLM is configured, the call timed out, or the reply
 * is unusable. Callers decide the fallback (the create action asks the user
 * for the symbol; the daemon retries framing next round).
 */
export async function structureThesis(input: StructureInput, timeoutMs?: number): Promise<ThesisStructured | null> {
    const llm = await resolveLlmConfig();
    if (!llm) return null;
    const call = callAIProviderWithConfig(structurePrompt(input), { name: llm.provider, apiKey: llm.apiKey, baseUrl: llm.baseUrl, model: llm.model });
    const reply = timeoutMs
        ? await Promise.race([call, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))])
        : await call;
    if (!reply) return null;
    return parseStructured(reply, input.fixedSymbol);
}

/** Framing-only backfill for an existing record (symbol already known) */
export async function frameThesis(i: { symbol: string; name: string; direction: ThesisDirection; note: string }): Promise<ThesisFraming | null> {
    const today = new Date().toISOString().slice(0, 10);
    const s = await structureThesis({ text: `（倾向：${DIRECTION_ZH[i.direction]}）${i.note}`, fixedSymbol: i.symbol, fixedName: i.name, today });
    return s ? s.framing : null;
}
