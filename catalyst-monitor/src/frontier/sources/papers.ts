import { log, logError } from '../../config';
import { fetchWithRetry } from '../../http';
import type { NewFrontierItem, SourceContext } from '../store';

/**
 * 技术前沿：PubMed 与 bioRxiv 上"AI × 药物/蛋白"的新论文。
 * 只做候选池（status=paper），不逐篇调 LLM——周报时一次调用挑出最值得看的几篇。
 */

const AI_TERMS = /\b(machine learning|deep learning|artificial intelligence|generative|foundation model|language model|diffusion model|neural network|transformer|AlphaFold|graph neural)\b/i;
const BIO_TERMS = /\b(drug|molecul|protein design|antibod|binder|therapeut|target identification|clinical|ligand|small molecule|enzyme design)/i;

const PUBMED_TERM =
  '("artificial intelligence"[tiab] OR "machine learning"[tiab] OR "deep learning"[tiab] OR "generative"[tiab] ' +
  'OR "foundation model"[tiab] OR "language model"[tiab]) AND ("drug discovery"[tiab] OR "drug design"[tiab] ' +
  'OR "protein design"[tiab] OR "antibody design"[tiab] OR "de novo design"[tiab] OR "target identification"[tiab])';

const BIORXIV_CATEGORIES = ['bioinformatics', 'synthetic biology', 'bioengineering', 'pharmacology and toxicology'];

async function collectPubmed(days: number): Promise<NewFrontierItem[]> {
  const search = new URLSearchParams({
    db: 'pubmed', term: PUBMED_TERM, reldate: String(days), datetype: 'edat', retmax: '100', retmode: 'json', sort: 'pub_date',
  });
  const res = await fetchWithRetry(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${search}`);
  if (!res.ok) throw new Error(`PubMed esearch HTTP ${res.status}`);
  const ids = ((await res.json()) as { esearchresult?: { idlist?: string[] } }).esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];
  const sum = await fetchWithRetry(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`,
  );
  if (!sum.ok) throw new Error(`PubMed esummary HTTP ${sum.status}`);
  const result = ((await sum.json()) as { result?: Record<string, { title?: string; source?: string; pubdate?: string }> }).result ?? {};
  return ids
    .map((id): NewFrontierItem | null => {
      const r = result[id];
      if (!r?.title) return null;
      return {
        source: 'paper',
        externalId: `pmid:${id}`,
        feed: `PubMed · ${r.source ?? ''}`,
        title: r.title.replace(/<[^>]+>/g, ''),
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        snippet: `${r.source ?? ''} ${r.pubdate ?? ''}`.trim(),
        publishedAt: new Date(),
        ruleThemes: ['ai-drug'],
        ruleTickers: [],
        status: 'paper',
      };
    })
    .filter((x): x is NewFrontierItem => x !== null);
}

interface BiorxivPaper {
  title: string;
  doi: string;
  date: string;
  category: string;
  abstract?: string;
  author_corresponding_institution?: string;
}

async function collectBiorxiv(days: number): Promise<NewFrontierItem[]> {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - days * 24 * 3600_000).toISOString().slice(0, 10);
  const out: NewFrontierItem[] = [];
  for (const cat of BIORXIV_CATEGORIES) {
    for (let cursor = 0; cursor < 300; cursor += 100) {
      const res = await fetchWithRetry(
        `https://api.biorxiv.org/details/biorxiv/${start}/${end}/${cursor}?category=${encodeURIComponent(cat)}`,
        {},
        { timeoutMs: 40_000 },
      );
      if (!res.ok) throw new Error(`bioRxiv HTTP ${res.status}`);
      const data = (await res.json()) as { collection?: BiorxivPaper[]; messages?: Array<{ total?: string | number }> };
      const papers = data.collection ?? [];
      for (const p of papers) {
        const text = `${p.title} ${p.abstract ?? ''}`;
        if (!AI_TERMS.test(text) || !BIO_TERMS.test(text)) continue;
        out.push({
          source: 'paper',
          externalId: `doi:${p.doi}`,
          feed: `bioRxiv · ${p.category}`,
          title: p.title,
          url: `https://www.biorxiv.org/content/${p.doi}`,
          snippet: `${p.author_corresponding_institution ?? ''}. ${(p.abstract ?? '').slice(0, 600)}`,
          publishedAt: new Date(`${p.date}T12:00:00Z`),
          ruleThemes: ['ai-drug'],
          ruleTickers: [],
          status: 'paper',
        });
      }
      const total = Number(data.messages?.[0]?.total ?? 0);
      if (papers.length < 100 || cursor + 100 >= total) break;
    }
  }
  return out;
}

export async function collectPapers(ctx: SourceContext): Promise<{ items: NewFrontierItem[]; seen: number }> {
  const days = ctx.lastRun ? 2 : 7;
  const parts = await Promise.allSettled([collectPubmed(days), collectBiorxiv(days)]);
  const items: NewFrontierItem[] = [];
  let failed = 0;
  for (const p of parts) {
    if (p.status === 'fulfilled') items.push(...p.value);
    else {
      failed++;
      logError('frontier:papers', p.reason);
    }
  }
  if (failed === parts.length) throw new Error('PubMed 与 bioRxiv 均拉取失败');
  log('frontier:papers', `论文候选 ${items.length} 篇`);
  return { items, seen: items.length };
}
