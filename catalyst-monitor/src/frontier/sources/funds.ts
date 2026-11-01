import { XMLParser } from 'fast-xml-parser';
import { connectToDatabase } from '@/database/mongoose';
import { FrontierFund } from '@/database/models/frontier.model';
import { SEC_MIN_REQUEST_GAP_MS, edgarHeaders, submissionsUrl } from '@/lib/edgar';
import { diffHoldings, type Holding13F } from '@/lib/frontier-math';
import { FRONTIER_FUNDS } from '@/lib/frontier-seed';
import { log, logError } from '../../config';
import { fetchWithRetry } from '../../http';
import { getKv, setKv } from '../../store';
import type { NewFrontierItem, SourceContext } from '../store';

/**
 * 13F 机构动向：生物医药专业基金每季度末后 45 天内公开持仓。
 * 每天看一次有没有新季报；有就拉最新两期对比出建仓/加仓/减仓/清仓，
 * CUSIP 通过 OpenFIGI 换成 ticker（结果长期缓存）。
 */

const TOP_CHANGES = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Submissions {
  filings?: { recent?: { form: string[]; accessionNumber: string[]; reportDate: string[]; filingDate: string[] } };
}

async function infotableUrl(cik: string, accession: string, contact: string): Promise<string | null> {
  const dir = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, '')}`;
  const res = await fetchWithRetry(`${dir}/index.json`, { headers: edgarHeaders(contact) });
  if (!res.ok) throw new Error(`13F index HTTP ${res.status}`);
  const idx = (await res.json()) as { directory?: { item?: Array<{ name: string }> } };
  const xml = (idx.directory?.item ?? []).find((i) => /\.xml$/i.test(i.name) && !/primary_doc/i.test(i.name));
  return xml ? `${dir}/${xml.name}` : null;
}

async function fetchHoldings(url: string, contact: string): Promise<Holding13F[]> {
  const res = await fetchWithRetry(url, { headers: edgarHeaders(contact) }, { timeoutMs: 60_000 });
  if (!res.ok) throw new Error(`13F infotable HTTP ${res.status}`);
  const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false });
  const doc = parser.parse(await res.text());
  type Row = { nameOfIssuer?: string; cusip?: string; value?: string; shrsOrPrnAmt?: { sshPrnamt?: string }; putCall?: string };
  const rows = doc?.informationTable?.infoTable as Row | Row[] | undefined;
  const list: Row[] = Array.isArray(rows) ? rows : rows ? [rows] : [];
  return list.map((r) => ({
    issuer: String(r.nameOfIssuer ?? ''),
    cusip: String(r.cusip ?? '').toUpperCase(),
    value: Number(r.value ?? 0),
    shares: Number(r.shrsOrPrnAmt?.sshPrnamt ?? 0),
    putCall: r.putCall ? String(r.putCall) : null,
  }));
}

/** CUSIP → ticker（OpenFIGI 免 key 档：每次最多 10 个，每分钟 25 次）；查不到记 "-" 防重复查 */
export async function mapCusips(cusips: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const todo: string[] = [];
  for (const c of new Set(cusips)) {
    const cached = await getKv(`figi:${c}`);
    if (cached !== null) out.set(c, cached === '-' ? null : cached);
    else todo.push(c);
  }
  for (let i = 0; i < todo.length; i += 10) {
    const batch = todo.slice(i, i + 10);
    try {
      const res = await fetchWithRetry('https://api.openfigi.com/v3/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.map((c) => ({ idType: 'ID_CUSIP', idValue: c, exchCode: 'US' }))),
      });
      if (!res.ok) throw new Error(`OpenFIGI HTTP ${res.status}`);
      const data = (await res.json()) as Array<{ data?: Array<{ ticker?: string }> }>;
      for (let j = 0; j < batch.length; j++) {
        const ticker = data[j]?.data?.[0]?.ticker ?? null;
        out.set(batch[j], ticker);
        await setKv(`figi:${batch[j]}`, ticker ?? '-');
      }
    } catch (err) {
      logError('frontier:openfigi', err);
      break; // 限流时这批不缓存，下次再查
    }
    await sleep(2600);
  }
  return out;
}

async function processFund(fund: { cik: string; name: string }, contact: string): Promise<boolean> {
  const res = await fetchWithRetry(submissionsUrl(fund.cik), { headers: edgarHeaders(contact) });
  if (!res.ok) throw new Error(`submissions HTTP ${res.status}`);
  const recent = ((await res.json()) as Submissions).filings?.recent;
  if (!recent) return false;
  const idx = recent.form.map((f, i) => (f === '13F-HR' ? i : -1)).filter((i) => i >= 0).slice(0, 2);
  if (idx.length === 0) return false;
  const latest = recent.accessionNumber[idx[0]];

  await connectToDatabase();
  const existing = await FrontierFund.findOne({ cik: fund.cik }).lean();
  if (existing?.accession === latest) return false;

  const curUrl = await infotableUrl(fund.cik, latest, contact);
  await sleep(SEC_MIN_REQUEST_GAP_MS);
  if (!curUrl) throw new Error(`${fund.name} 最新 13F 找不到持仓表`);
  const cur = await fetchHoldings(curUrl, contact);
  let prev: Holding13F[] = [];
  if (idx[1] !== undefined) {
    await sleep(SEC_MIN_REQUEST_GAP_MS);
    const prevUrl = await infotableUrl(fund.cik, recent.accessionNumber[idx[1]], contact);
    if (prevUrl) {
      await sleep(SEC_MIN_REQUEST_GAP_MS);
      prev = await fetchHoldings(prevUrl, contact);
    }
  }

  const changes = idx[1] !== undefined ? diffHoldings(prev, cur).slice(0, TOP_CHANGES) : [];
  const tickers = await mapCusips(changes.map((c) => c.cusip));
  const longs = cur.filter((h) => !h.putCall);
  await FrontierFund.updateOne(
    { cik: fund.cik },
    {
      $set: {
        name: fund.name,
        period: recent.reportDate[idx[0]],
        prevPeriod: idx[1] !== undefined ? recent.reportDate[idx[1]] : null,
        accession: latest,
        filedAt: recent.filingDate[idx[0]],
        totalValue: longs.reduce((s, h) => s + h.value, 0),
        holdingsCount: new Set(longs.map((h) => h.cusip)).size,
        changes: changes.map((c) => ({ ...c, symbol: tickers.get(c.cusip) ?? null })),
        checkedAt: new Date(),
      },
    },
    { upsert: true },
  );
  log('frontier:funds', `${fund.name} ${recent.reportDate[idx[0]]} 季报已更新（${changes.length} 项变动）`);
  return true;
}

export async function collectFunds(ctx: SourceContext): Promise<{ items: NewFrontierItem[]; seen: number }> {
  const contact = ctx.config.env.edgarContact;
  let updated = 0;
  let failed = 0;
  for (const fund of FRONTIER_FUNDS) {
    try {
      if (await processFund(fund, contact)) updated++;
    } catch (err) {
      failed++;
      logError(`frontier:funds:${fund.name}`, err);
    }
    await sleep(SEC_MIN_REQUEST_GAP_MS);
  }
  if (failed === FRONTIER_FUNDS.length) throw new Error('全部基金 13F 拉取失败');
  log('frontier:funds', `${FRONTIER_FUNDS.length} 家基金检查完毕，${updated} 家有新季报`);
  return { items: [], seen: updated };
}
