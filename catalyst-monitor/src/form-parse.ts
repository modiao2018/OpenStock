import { XMLParser } from 'fast-xml-parser';
import { parseForm4Xml as parseForm4Shared } from '../../lib/edgar';

/**
 * SEC Form 4 / Form 144 XML 的防御式解析（纯函数，__tests__/form-parse.test.ts）。
 * Form 4 = 已成交的内部人交易申报；Form 144 = 关联方拟卖出预告（下单当天提交）。
 */

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });

export interface ParsedForm4Tx {
  /** 申报的内部人姓名（联合申报以 " / " 连接） */
  name: string;
  transactionCode: string;
  /** 股数变动：买入为正，卖出为负 */
  change: number;
  /** 每股价格；申报未填时为 0 */
  price: number;
  /** YYYY-MM-DD */
  transactionDate: string;
}

/**
 * 只取非衍生表里的交易行（含 P/S/M/F 等，期权行权/授予等噪音在上层过滤）。
 * 解析逻辑与网页端共用 lib/edgar.ts 的 parseForm4Xml，避免两套解析器对同一份申报给出不同答案。
 */
export function parseForm4Xml(xml: string): ParsedForm4Tx[] {
  if (!/<ownershipDocument[\s>]/.test(xml)) return [];
  const rows = parseForm4Shared(xml, { symbol: '', filingDate: '', accessionNumber: '', filingUrl: '' });
  const out: ParsedForm4Tx[] = [];
  for (const row of rows) {
    if (row.isDerivative) continue;
    const shares = row.shares ?? 0;
    const date = row.transactionDate.slice(0, 10);
    if (!row.transactionCode || shares <= 0 || !date) continue;
    out.push({
      name: row.ownerName === 'Unknown insider' ? '' : row.ownerName,
      transactionCode: row.transactionCode,
      change: row.acquiredDisposed === 'D' ? -shares : shares,
      price: row.pricePerShare ?? 0,
      transactionDate: date,
    });
  }
  return out;
}

export interface ParsedForm144 {
  /** 拟卖出人（申报里的账户持有人） */
  person: string | null;
  shares: number | null;
  /** 申报的拟售总市值（美元） */
  valueUsd: number | null;
  /** YYYY-MM-DD */
  approxSaleDate: string | null;
}

// Form 144 的 schema 变体较多（brokers 代报格式不一），按字段名深度搜索最稳
function findFirst(node: unknown, keys: string[]): unknown {
  if (node === null || typeof node !== 'object') return undefined;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (keys.includes(k) && v !== undefined && v !== null && typeof v !== 'object') return v;
    const nested = findFirst(v, keys);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

// EDGAR 电子版 Form 144 日期常见 MM/DD/YYYY，统一成 YYYY-MM-DD
function normalizeDate(raw: string): string | null {
  const mdy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

export function parseForm144Xml(xml: string): ParsedForm144 {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const person = findFirst(doc, [
    'nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold',
    'personForWhoseAccountSold',
  ]);
  const shares = findFirst(doc, ['noOfUnitsSold', 'amountOfSecuritiesToBeSold', 'numberOfShares']);
  const value = findFirst(doc, ['aggregateMarketValue', 'marketValue']);
  const saleDate = findFirst(doc, ['approxSaleDate', 'approximateDateOfSale']);

  const sharesNum = shares !== undefined ? parseFloat(String(shares)) : NaN;
  const valueNum = value !== undefined ? parseFloat(String(value).replace(/[$,]/g, '')) : NaN;
  return {
    person: person !== undefined ? String(person) : null,
    shares: Number.isFinite(sharesNum) && sharesNum > 0 ? sharesNum : null,
    valueUsd: Number.isFinite(valueNum) && valueNum > 0 ? valueNum : null,
    approxSaleDate: saleDate !== undefined ? normalizeDate(String(saleDate)) : null,
  };
}
