import { matchThemes } from '@/lib/frontier-math';
import { log } from '../../config';
import { fetchWithRetry } from '../../http';
import type { NewFrontierItem, SourceContext } from '../store';

/**
 * 交易追踪的一手来源：SEC EDGAR 全文检索里，医药生物行业公司提交的、
 * 含"重大协议 / 完成收购"条目的 8-K。新闻稿要等媒体转述，8-K 是公司自己的法定披露。
 */

// 2834 制药 / 2835 体外诊断 / 2836 生物制品 / 8731 商业生物研究
const BIO_SICS = new Set(['2834', '2835', '2836', '8731']);
// 1.01 签订重大协议 / 2.01 完成收购或处置资产
const DEAL_ITEMS = new Set(['1.01', '2.01']);
const QUERY = '"license agreement" OR "collaboration agreement" OR "merger agreement" OR "asset purchase agreement"';
const MAX_PAGES = 3;

interface EftsSource {
  ciks: string[];
  display_names: string[];
  file_date: string;
  sics?: string[];
  form: string;
  adsh: string;
  file_type?: string;
  file_description?: string | null;
  items?: string[];
}

interface EftsHit {
  _id: string;
  _source: EftsSource;
}

/** "Zymeworks Inc.  (ZYME)  (CIK 0001937653)" → { name, ticker } */
export function parseDisplayName(s: string): { name: string; ticker: string | null } {
  const name = s.replace(/\s*\(CIK \d+\)\s*$/, '').replace(/\s*\([A-Z0-9., -]+\)\s*$/, '').trim();
  const m = s.match(/\(([A-Z]{1,5})(?:[,\s][^)]*)?\)\s*\(CIK/);
  return { name, ticker: m ? m[1] : null };
}

const ITEM_LABEL: Record<string, string> = { '1.01': 'material agreement', '2.01': 'completed acquisition/disposition' };

export async function collectDeals(ctx: SourceContext): Promise<{ items: NewFrontierItem[]; seen: number }> {
  const contact = ctx.config.env.edgarContact;
  const headers = { 'User-Agent': `HappyStock research (${contact})` };
  const end = new Date();
  const start = new Date(end.getTime() - (ctx.lastRun ? 3 : 10) * 24 * 3600_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  // 同一份申报的多个文件（正文、EX-10、EX-99.1）都会命中，按申报号聚合
  const filings = new Map<string, { src: EftsSource; files: Array<{ name: string; type: string; desc: string }> }>();
  let seen = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(QUERY)}&forms=8-K` +
      `&dateRange=custom&startdt=${fmt(start)}&enddt=${fmt(end)}${page ? `&from=${page * 100}` : ''}`;
    const res = await fetchWithRetry(url, { headers }, { timeoutMs: 30_000 });
    if (!res.ok) throw new Error(`EDGAR full-text search HTTP ${res.status}`);
    const data = (await res.json()) as { hits?: { total?: { value: number }; hits?: EftsHit[] } };
    const hits = data.hits?.hits ?? [];
    seen += hits.length;
    for (const h of hits) {
      const s = h._source;
      if (!(s.sics ?? []).some((c) => BIO_SICS.has(c))) continue;
      if (!(s.items ?? []).some((i) => DEAL_ITEMS.has(i))) continue;
      const fileName = h._id.split(':')[1] ?? '';
      const entry = filings.get(s.adsh) ?? { src: s, files: [] };
      entry.files.push({ name: fileName, type: s.file_type ?? '', desc: s.file_description ?? '' });
      filings.set(s.adsh, entry);
    }
    if (hits.length < 100 || (page + 1) * 100 >= (data.hits?.total?.value ?? 0)) break;
  }

  const items: NewFrontierItem[] = [];
  for (const [adsh, { src, files }] of filings) {
    const { name, ticker } = parseDisplayName(src.display_names[0] ?? '');
    const cik = String(Number(src.ciks[0] ?? '0'));
    // 优先新闻稿附件（EX-99.x），它用人话写了交易条款；没有就用 8-K 正文
    const pr = files.find((f) => /^EX-99/i.test(f.type)) ?? files.find((f) => f.type === '8-K') ?? files[0];
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, '')}/${pr.name}`;
    const dealItems = (src.items ?? []).filter((i) => DEAL_ITEMS.has(i)).map((i) => `Item ${i} ${ITEM_LABEL[i]}`);
    const descs = [...new Set(files.map((f) => f.desc).filter((d) => d && d !== '8-K' && !/^EX-/i.test(d)))].slice(0, 4);
    const title = `${name}${ticker ? ` (${ticker})` : ''} 8-K: ${dealItems.join(', ')}`;
    const snippet = `Filed ${src.file_date}. Items: ${(src.items ?? []).join(', ')}.${descs.length ? ` Exhibits: ${descs.join(' | ')}` : ''}`;
    const m = matchThemes(`${name} ${descs.join(' ')}`, ctx.themes);
    items.push({
      source: 'deal',
      externalId: adsh,
      feed: 'SEC EDGAR',
      title,
      url,
      snippet,
      publishedAt: new Date(`${src.file_date}T21:00:00Z`),
      ruleThemes: m.themes,
      ruleTickers: [...new Set([...(ticker ? [ticker] : []), ...m.tickers])],
      raw: { adsh, cik, company: name, ticker, items: src.items, fileDate: src.file_date, files },
    });
  }
  log('frontier:deals', `检索命中 ${seen} 个文件，医药生物交易类 8-K ${items.length} 份`);
  return { items, seen };
}
