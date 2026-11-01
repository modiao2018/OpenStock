import { matchThemes, parseMeetingDate } from '@/lib/frontier-math';
import { log, logError } from '../../config';
import { fetchWithRetry } from '../../http';
import type { NewFrontierItem, SourceContext } from '../store';

/**
 * 监管一手数据：openFDA 新药批准（只要新分子实体）、FDA 拒绝信（CRL）、
 * Federal Register 上的专家委员会会议公告。都是结构化数据，事实本身不需要 LLM。
 */

const DAY = 24 * 3600_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

interface OpenFdaSubmission {
  submission_type?: string;
  submission_status?: string;
  submission_status_date?: string;
  submission_class_code?: string;
  review_priority?: string;
}

interface OpenFdaApp {
  application_number: string;
  sponsor_name?: string;
  submissions?: OpenFdaSubmission[];
  products?: Array<{ brand_name?: string; active_ingredients?: Array<{ name?: string }> }>;
  openfda?: { generic_name?: string[]; pharm_class_epc?: string[] };
}

const toIsoDate = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

async function collectApprovals(ctx: SourceContext): Promise<NewFrontierItem[]> {
  // 首次回看 45 天；之后每轮回看 14 天（openFDA 数据有几天到两周的延迟，靠唯一索引去重）
  const since = new Date(Date.now() - (ctx.lastRun ? 14 : 45) * DAY);
  const search =
    `submissions.submission_status_date:[${ymd(since)}+TO+${ymd(new Date(Date.now() + DAY))}]` +
    '+AND+submissions.submission_type:ORIG+AND+submissions.submission_status:AP' +
    '+AND+(application_number:NDA*+OR+application_number:BLA*)';
  const res = await fetchWithRetry(`https://api.fda.gov/drug/drugsfda.json?search=${search}&limit=100`, {}, { timeoutMs: 60_000 });
  if (res.status === 404) return []; // openFDA 无结果时返回 404
  if (!res.ok) throw new Error(`openFDA drugsfda HTTP ${res.status}`);
  const data = (await res.json()) as { results?: OpenFdaApp[] };
  const sinceStr = ymd(since);
  const items: NewFrontierItem[] = [];

  for (const app of data.results ?? []) {
    // 查询条件命中的是"任一 submission 在窗口内"，这里再确认原始申请本身是窗口内批准的新分子实体
    const orig = (app.submissions ?? []).find(
      (s) => s.submission_type === 'ORIG' && s.submission_status === 'AP' && (s.submission_status_date ?? '') >= sinceStr,
    );
    if (!orig || !(orig.submission_class_code ?? '').startsWith('TYPE 1')) continue;
    const brand = app.products?.[0]?.brand_name ?? '';
    const generic = app.openfda?.generic_name?.[0] ?? app.products?.[0]?.active_ingredients?.[0]?.name ?? '';
    const klass = app.openfda?.pharm_class_epc?.join('; ') ?? '';
    const sponsor = app.sponsor_name ?? '';
    const date = toIsoDate(orig.submission_status_date!);
    const title = `FDA approves ${brand}${generic && generic.toLowerCase() !== brand.toLowerCase() ? ` (${generic.toLowerCase()})` : ''} — ${sponsor}`;
    const appNo = app.application_number.replace(/\D/g, '');
    const snippet =
      `New molecular entity approval. Application ${app.application_number}, sponsor ${sponsor}, ` +
      `approved ${date}, review priority ${orig.review_priority ?? 'n/a'}.${klass ? ` Pharmacologic class: ${klass}.` : ''}`;
    const m = matchThemes(`${title} ${snippet}`, ctx.themes);
    items.push({
      source: 'approval',
      externalId: `${app.application_number}:${orig.submission_status_date}`,
      feed: 'openFDA',
      title,
      url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNo}`,
      snippet,
      publishedAt: new Date(`${date}T12:00:00Z`),
      ruleThemes: m.themes,
      ruleTickers: m.tickers,
      raw: { application: app.application_number, sponsor, brand, generic, date, priority: orig.review_priority, klass },
    });
  }
  return items;
}

interface CrlRow {
  letter_date?: string;
  company_name?: string;
  application_number?: string | string[];
  letter_type?: string;
  text?: string;
  file_name?: string;
}

async function collectCrls(ctx: SourceContext): Promise<NewFrontierItem[]> {
  const res = await fetchWithRetry('https://api.fda.gov/transparency/crl.json?limit=25&sort=letter_date:desc', {}, { timeoutMs: 60_000 });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`openFDA CRL HTTP ${res.status}`);
  const data = (await res.json()) as { results?: CrlRow[] };
  const cutoff = Date.now() - 90 * DAY;
  const items: NewFrontierItem[] = [];
  for (const r of data.results ?? []) {
    const [mm, dd, yyyy] = (r.letter_date ?? '').split('/');
    const t = Date.parse(`${yyyy}-${mm}-${dd}T12:00:00Z`);
    if (Number.isNaN(t) || t < cutoff || !r.file_name) continue;
    const appNo = Array.isArray(r.application_number) ? r.application_number.join(', ') : String(r.application_number ?? '').replace(/[[\]']/g, '');
    const company = r.company_name ?? '';
    const title = `FDA complete response letter (not approved): ${company} ${appNo}`.trim();
    const snippet = (r.text ?? '').replace(/\s+/g, ' ').slice(0, 1200);
    const m = matchThemes(`${title} ${snippet}`, ctx.themes);
    items.push({
      source: 'fda',
      externalId: `crl:${r.file_name}`,
      feed: 'openFDA CRL',
      title,
      url: 'https://open.fda.gov/crltable/',
      snippet,
      publishedAt: new Date(t),
      ruleThemes: m.themes,
      ruleTickers: m.tickers,
    });
  }
  return items;
}

interface FrDoc {
  title: string;
  publication_date: string;
  html_url: string;
  abstract?: string | null;
  document_number: string;
  dates?: string | null;
}

async function collectAdcoms(ctx: SourceContext): Promise<NewFrontierItem[]> {
  const since = new Date(Date.now() - (ctx.lastRun ? 14 : 60) * DAY).toISOString().slice(0, 10);
  const params = new URLSearchParams();
  params.append('conditions[agencies][]', 'food-and-drug-administration');
  params.append('conditions[type][]', 'NOTICE');
  params.append('conditions[term]', '"advisory committee; notice of meeting"');
  params.append('conditions[publication_date][gte]', since);
  params.append('order', 'newest');
  params.append('per_page', '50');
  for (const f of ['title', 'publication_date', 'html_url', 'abstract', 'document_number', 'dates']) params.append('fields[]', f);
  const res = await fetchWithRetry(`https://www.federalregister.gov/api/v1/documents.json?${params}`, {}, { timeoutMs: 40_000 });
  if (!res.ok) throw new Error(`Federal Register HTTP ${res.status}`);
  const data = (await res.json()) as { results?: FrDoc[] };
  const items: NewFrontierItem[] = [];
  for (const d of data.results ?? []) {
    // 器械、烟草类委员会与新药无关
    if (/device|tobacco/i.test(d.title)) continue;
    const meeting = parseMeetingDate(d.dates) ?? parseMeetingDate(d.abstract);
    const snippet = `${d.dates ?? ''} ${d.abstract ?? ''}`.trim();
    const m = matchThemes(`${d.title} ${snippet}`, ctx.themes);
    items.push({
      source: 'adcom',
      externalId: d.document_number,
      feed: 'Federal Register',
      title: d.title,
      url: d.html_url,
      snippet: meeting ? `Meeting date: ${meeting}. ${snippet}` : snippet,
      publishedAt: new Date(`${d.publication_date}T12:00:00Z`),
      ruleThemes: m.themes,
      ruleTickers: m.tickers,
      raw: { meetingDate: meeting },
    });
  }
  return items;
}

export async function collectFda(ctx: SourceContext): Promise<{ items: NewFrontierItem[]; seen: number }> {
  const parts = await Promise.allSettled([collectApprovals(ctx), collectCrls(ctx), collectAdcoms(ctx)]);
  const items: NewFrontierItem[] = [];
  const names = ['approvals', 'crl', 'adcom'];
  let failed = 0;
  parts.forEach((p, i) => {
    if (p.status === 'fulfilled') items.push(...p.value);
    else {
      failed++;
      logError(`frontier:fda:${names[i]}`, p.reason);
    }
  });
  if (failed === parts.length) throw new Error('FDA / Federal Register 全部拉取失败');
  log('frontier:fda', `批准/拒绝信/专家会 共 ${items.length} 条`);
  return { items, seen: items.length };
}
