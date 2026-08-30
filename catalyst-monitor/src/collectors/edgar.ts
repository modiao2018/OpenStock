import { log, logError } from '../config';
import { getKv, setKv, sha256 } from '../store';
import type { MonitorConfig, NewEvent } from '../types';

const CIK_MAP_URL = 'https://www.sec.gov/files/company_tickers.json';
const CIK_MAP_TTL_MS = 24 * 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 8-K 常见 item 代码的中文含义（完整清单见 SEC 8-K 表格说明）
const ITEM_ZH: Record<string, string> = {
  '1.01': '签订重大协议',
  '1.02': '终止重大协议',
  '1.03': '破产或接管',
  '2.01': '完成收购或资产处置',
  '2.02': '业绩发布',
  '2.05': '重组/裁员计划',
  '3.01': '退市或不符合上市规则通知',
  '4.01': '更换会计师',
  '4.02': '财报不可依赖（重述）',
  '5.02': '董事或高管变动',
  '5.03': '章程修订',
  '5.07': '股东投票结果',
  '7.01': 'Reg FD 披露',
  '8.01': '其他重大事件',
  '9.01': '财务报表及附件',
};

function itemsZh(items: string): string {
  if (!items) return '';
  return items
    .split(',')
    .map((code) => {
      const c = code.trim();
      return ITEM_ZH[c] ? `${ITEM_ZH[c]}(${c})` : c;
    })
    .join('、');
}

function edgarHeaders(contact: string): Record<string, string> {
  // SEC 要求 User-Agent 里带可联系方式，否则可能被封
  return { 'User-Agent': `catalyst-monitor/0.1 (${contact})`, Accept: 'application/json' };
}

async function getCikMap(config: MonitorConfig): Promise<Record<string, string>> {
  const cached = await getKv('edgar_cik_map', CIK_MAP_TTL_MS);
  if (cached) return JSON.parse(cached);

  const res = await fetch(CIK_MAP_URL, {
    headers: edgarHeaders(config.env.edgarContact),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`company_tickers.json HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, { cik_str: number; ticker: string }>;

  const map: Record<string, string> = {};
  for (const entry of Object.values(data)) {
    map[entry.ticker.toUpperCase()] = String(entry.cik_str);
  }
  await setKv('edgar_cik_map', JSON.stringify(map));
  return map;
}

/**
 * 轮询 watchlist 公司在 EDGAR 的最新申报，筛出 8-K/6-K 等重大事件类型。
 * acceptanceDateTime 是 SEC 收到申报的时间——这是"最早公开时点"的权威锚点。
 */
export async function collectEdgar(config: MonitorConfig): Promise<NewEvent[]> {
  const events: NewEvent[] = [];
  const cikMap = await getCikMap(config);
  const cutoff = Date.now() - config.edgar.lookbackDays * 24 * 60 * 60 * 1000;

  for (const item of config.watchlist) {
    const cik = cikMap[item.symbol];
    if (!cik) {
      log('edgar', `${item.symbol} 在 EDGAR ticker 表中未找到，跳过`);
      continue;
    }
    try {
      const cik10 = cik.padStart(10, '0');
      const res = await fetch(`https://data.sec.gov/submissions/CIK${cik10}.json`, {
        headers: edgarHeaders(config.env.edgarContact),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`${item.symbol} submissions HTTP ${res.status}`);
      const data = (await res.json()) as any;

      const recent = data.filings?.recent ?? {};
      const forms: string[] = recent.form ?? [];
      for (let i = 0; i < forms.length; i++) {
        if (!config.edgar.forms.includes(forms[i])) continue;
        if (Date.parse(recent.filingDate[i]) < cutoff) continue;

        const accession: string = recent.accessionNumber[i];
        const accessionPlain = accession.replace(/-/g, '');
        const primaryDoc: string = recent.primaryDocument?.[i] ?? '';
        const items: string = recent.items?.[i] ?? '';

        events.push({
          source: 'edgar',
          externalId: accession,
          symbol: item.symbol,
          title: `${item.symbol} 提交 ${forms[i]}${items ? `：${itemsZh(items)}` : ''}`,
          url: primaryDoc
            ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionPlain}/${primaryDoc}`
            : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik10}&type=${forms[i]}`,
          publishedAt: recent.acceptanceDateTime?.[i] ?? recent.filingDate[i],
          // 申报是不可变的，哈希固定 → 每份 accession 只产生一次事件
          contentHash: sha256(accession),
          raw: { form: forms[i], accession, filingDate: recent.filingDate[i], items },
          severity: 'urgent',
        });
      }
      await sleep(150); // SEC 限速 10 req/s，保守一点
    } catch (err) {
      logError('edgar', err);
    }
  }

  log('edgar', `found ${events.length} recent filings across watchlist`);
  return events;
}
