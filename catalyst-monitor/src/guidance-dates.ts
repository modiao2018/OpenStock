/**
 * 催化剂时间指引的"精度"处理：公司公告里的时间表述往往是"下半年 / Q4 / 年内"这类
 * 区间而不是具体日期。把它硬编成某一天（旧版把 H2 记成 10-15）会让倒计时、提醒
 * 和日历都在撒谎。这里把区间显式建模：`date` 只作排序/过滤锚点（取区间末尾，
 * 免得窗口没过条目就掉出日历），`precision` 决定展示与提醒方式。
 *
 * 纯函数模块：daemon、Server Action 和客户端组件共用，不能引入 node/mongoose。
 */

export type DatePrecision = 'day' | 'month' | 'quarter' | 'half' | 'year';
export const DATE_PRECISIONS: readonly DatePrecision[] = ['day', 'month', 'quarter', 'half', 'year'];

export function isDatePrecision(v: unknown): v is DatePrecision {
  return typeof v === 'string' && (DATE_PRECISIONS as readonly string[]).includes(v);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m 为 1..12，Date.UTC 的第 0 天回退到上月末
}

/** 指引所指的时间区间（闭区间，YYYY-MM-DD）；`date` 可以是区间内任意一天 */
export function windowOf(date: string, precision: DatePrecision): { start: string; end: string } {
  if (!ISO_DAY.test(date) || precision === 'day') return { start: date, end: date };
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const span = (m1: number, m2: number) => ({
    start: `${y}-${pad(m1)}-01`,
    end: `${y}-${pad(m2)}-${pad(lastDayOfMonth(y, m2))}`,
  });
  switch (precision) {
    case 'month':
      return span(m, m);
    case 'quarter': {
      const q = Math.floor((m - 1) / 3);
      return span(q * 3 + 1, q * 3 + 3);
    }
    case 'half':
      return m <= 6 ? span(1, 6) : span(7, 12);
    case 'year':
      return span(1, 12);
  }
}

/** 入库锚点：区间末尾。排序靠后于同期的精确日期，且窗口结束前不会从"未来催化剂"里掉队 */
export function anchorDate(date: string, precision: DatePrecision): string {
  return windowOf(date, precision).end;
}

type Locale = 'zh' | 'en';

export function toLocaleTag(locale: string): Locale {
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 面向用户的区间描述："2026 下半年" / "H2 2026"；精确日期原样返回 */
export function describeWindow(date: string, precision: DatePrecision, locale: string): string {
  if (precision === 'day' || !ISO_DAY.test(date)) return date;
  const zh = toLocaleTag(locale) === 'zh';
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  switch (precision) {
    case 'month':
      return zh ? `${y}年${m}月` : `${MONTH_EN[m - 1]} ${y}`;
    case 'quarter':
      return `${y} Q${Math.floor((m - 1) / 3) + 1}`;
    case 'half':
      return zh ? `${y} ${m <= 6 ? '上半年' : '下半年'}` : `${m <= 6 ? 'H1' : 'H2'} ${y}`;
    case 'year':
      return zh ? `${y} 年内` : `${y}`;
  }
}

const MONTH_WORD = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\b/;

/**
 * 从原文时间表述推断精度——LLM 漏填 precision 或迁移旧数据时的兜底。
 * 规则宁粗勿细：拿不准就当具体日期（与旧行为一致），不会把精确日期误降级。
 */
export function inferPrecision(dateText: string | null | undefined): DatePrecision {
  const s = (dateText ?? '').trim().toLowerCase();
  if (!s || ISO_DAY.test(s)) return 'day';
  if (/\b[12]h['’]?\d{0,4}\b|\bh[12]\b|\bh[12]['’]?\d{2}\b|first half|second half|latter half|上半年|下半年|前半年|后半年/.test(s)) return 'half';
  if (/\bq[1-4]\b|\bq[1-4]['’]?\d{2}\b|\b[1-4]q['’]?\d{0,4}\b|quarter|季度|第[一二三四1-4]季/.test(s)) return 'quarter';
  if (
    /later this year|this year|year[- ]?end|end[- ]?(of )?(the )?(year|20\d{2})|(early|mid|late)[- ]?20\d{2}\b|年内|年底|今年|本年|^(in |by |during )?20\d{2}$/.test(s)
  )
    return 'year';
  if (/^\d{4}-\d{2}$/.test(s)) return 'month';
  const hasMonth = MONTH_WORD.test(s) || /\d{1,2}\s*月/.test(s);
  const noYear = s.replace(/20\d{2}/g, ' ');
  const hasDay = /\b\d{1,2}(st|nd|rd|th)?\b(?!\s*月)/.test(noYear) || /\d{1,2}\s*日/.test(s);
  if (hasMonth && !hasDay) return 'month';
  return 'day';
}

/** 旧版 note 形如 "AI 从公告中抽取（原文: second half of 2026）"；取出原文时间表述 */
export function parseLegacyNote(note: string | null | undefined): string | null {
  const m = (note ?? '').match(/原文:\s*(.+?)\s*）\s*$/);
  return m ? m[1] : null;
}

export type GuidanceKind = 'data-readout' | 'pdufa' | 'adcom' | 'earnings' | 'conference' | 'other';
const GUIDANCE_KINDS = new Set<string>(['data-readout', 'pdufa', 'adcom', 'earnings', 'conference', 'other']);

export interface GuidanceCatalyst {
  title: string;
  /** 归一化后的锚点日期（区间末尾），YYYY-MM-DD */
  date: string;
  precision: DatePrecision;
  kind: GuidanceKind;
  dateText: string;
}

export interface GuidanceReply {
  catalysts: GuidanceCatalyst[];
  /** LLM 判定"已经发生 / 本公告给了新时间"的既有条目 id */
  supersedes: string[];
}

/** 从 LLM 回复里挖出首个 JSON 值（容忍 ```json 围栏和前后废话） */
function extractJson(reply: string): unknown {
  const cleaned = reply.replace(/```(?:json)?/gi, '').trim();
  const starts = [cleaned.indexOf('{'), cleaned.indexOf('[')].filter((i) => i >= 0);
  if (starts.length === 0) return null;
  const s = Math.min(...starts);
  const e = cleaned.lastIndexOf(cleaned[s] === '{' ? '}' : ']');
  if (e <= s) return null;
  try {
    return JSON.parse(cleaned.slice(s, e + 1));
  } catch {
    return null;
  }
}

/**
 * 解析抽取回复。接受 {"catalysts": [...], "supersedes": [...]}，也兼容旧格式的裸数组。
 * 每条的 isoDate 按 precision 归一化为区间末尾；末尾早于 today 的（已经过去）丢弃。
 */
export function parseGuidanceReply(reply: string, today: string, maxItems = 3): GuidanceReply {
  const json = extractJson(reply);
  const none: GuidanceReply = { catalysts: [], supersedes: [] };
  if (!json) return none;

  let rawList: unknown[] = [];
  let rawSupersedes: unknown[] = [];
  if (Array.isArray(json)) rawList = json;
  else if (typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    rawList = Array.isArray(obj.catalysts) ? obj.catalysts : [];
    rawSupersedes = Array.isArray(obj.supersedes) ? obj.supersedes : [];
  }

  const catalysts: GuidanceCatalyst[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const g = item as Record<string, unknown>;
    const isoDate = typeof g.isoDate === 'string' ? g.isoDate : '';
    if (!ISO_DAY.test(isoDate)) continue;
    const dateText = String(g.dateText ?? '').slice(0, 200);
    const precision = isDatePrecision(g.precision) ? g.precision : inferPrecision(dateText);
    const date = anchorDate(isoDate, precision);
    if (date < today) continue;
    catalysts.push({
      title: String(g.title ?? '').slice(0, 120) || '数据读出指引',
      date,
      precision,
      kind: (typeof g.kind === 'string' && GUIDANCE_KINDS.has(g.kind) ? g.kind : 'other') as GuidanceKind,
      dateText,
    });
    if (catalysts.length >= maxItems) break;
  }

  const supersedes = rawSupersedes
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => /^[0-9a-f]{24}$/i.test(v));

  return { catalysts, supersedes: [...new Set(supersedes)] };
}
