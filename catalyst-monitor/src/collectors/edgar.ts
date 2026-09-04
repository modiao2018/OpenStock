import { log, logError } from '../config';
import { fetchWithRetry } from '../http';
import { getKv, setKv, sha256 } from '../store';
import type { MonitorConfig, NewEvent } from '../types';
import {
  CIK_MAP_URL,
  SEC_MIN_REQUEST_GAP_MS,
  edgarHeaders as sharedEdgarHeaders,
  filingDocUrl,
  padCik,
  parseCikMap,
  secTimestampToIso,
  submissionsUrl,
  type CompanyTickersPayload,
} from '../../../lib/edgar';

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

/** Same User-Agent as the web app (lib/edgar.ts); SEC 要求带可联系方式 */
export function edgarHeaders(contact: string): Record<string, string> {
  return sharedEdgarHeaders(contact);
}

export async function getCikMap(config: MonitorConfig): Promise<Record<string, string>> {
  const cached = await getKv('edgar_cik_map', CIK_MAP_TTL_MS);
  if (cached) return JSON.parse(cached);

  const res = await fetchWithRetry(CIK_MAP_URL, { headers: edgarHeaders(config.env.edgarContact) }, { timeoutMs: 30_000 });
  if (!res.ok) throw new Error(`company_tickers.json HTTP ${res.status}`);
  const map = parseCikMap((await res.json()) as CompanyTickersPayload);
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
      const cik10 = padCik(cik);
      const res = await fetchWithRetry(
        submissionsUrl(cik),
        { headers: edgarHeaders(config.env.edgarContact) },
        { timeoutMs: 30_000 }
      );
      if (!res.ok) throw new Error(`${item.symbol} submissions HTTP ${res.status}`);
      const data = (await res.json()) as any;

      const recent = data.filings?.recent ?? {};
      const forms: string[] = recent.form ?? [];
      for (let i = 0; i < forms.length; i++) {
        if (!config.edgar.forms.includes(forms[i])) continue;
        if (Date.parse(recent.filingDate[i]) < cutoff) continue;

        // 3 天以上的旧申报按"建档"处理：入库+分析，不推送——避免新增标的时被历史公告刷屏
        const isArchival = Date.now() - Date.parse(recent.filingDate[i]) > 3 * 24 * 3600_000;
        const accession: string = recent.accessionNumber[i];
        const primaryDoc: string = recent.primaryDocument?.[i] ?? '';
        const items: string = recent.items?.[i] ?? '';

        events.push({
          source: 'edgar',
          externalId: accession,
          symbol: item.symbol,
          title: `${item.symbol} 提交 ${forms[i]}${items ? `：${itemsZh(items)}` : ''}`,
          url: primaryDoc
            ? filingDocUrl(cik, accession, primaryDoc)
            : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik10}&type=${forms[i]}`,
          // acceptanceDateTime 是美东墙钟时间（带假 Z 后缀），转成真 UTC 再存
          publishedAt: secTimestampToIso(recent.acceptanceDateTime?.[i]) ?? recent.filingDate[i],
          // 申报是不可变的，哈希固定 → 每份 accession 只产生一次事件
          contentHash: sha256(accession),
          raw: { form: forms[i], accession, filingDate: recent.filingDate[i], items },
          severity: 'urgent',
          archival: isArchival,
        });
      }
      await sleep(SEC_MIN_REQUEST_GAP_MS); // SEC 限速 10 req/s，保守一点
    } catch (err) {
      logError('edgar', err);
    }
  }

  log('edgar', `found ${events.length} recent filings across watchlist`);
  return events;
}
