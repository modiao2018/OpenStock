import { XMLParser } from 'fast-xml-parser';

/**
 * SEC Form 4 / Form 144 XML 的防御式解析（纯函数，__tests__/form-parse.test.ts）。
 * Form 4 = 已成交的内部人交易申报；Form 144 = 关联方拟卖出预告（下单当天提交）。
 */

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });

const toArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// Form 4 的叶子字段多为 { value: 'X' } 包装，偶尔直接是标量
const unwrap = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return unwrap((v as { value?: unknown }).value);
  return String(v);
};

const toNum = (v: unknown): number => {
  const n = parseFloat(unwrap(v));
  return Number.isFinite(n) ? n : 0;
};

export interface ParsedForm4Tx {
  /** 申报的内部人姓名 */
  name: string;
  transactionCode: string;
  /** 股数变动：买入为正，卖出为负 */
  change: number;
  /** 每股价格；申报未填时为 0 */
  price: number;
  /** YYYY-MM-DD */
  transactionDate: string;
}

type XmlNode = Record<string, unknown>;

/** 只取非衍生表里的公开市场买卖（P/S），期权行权/授予等噪音在上层过滤 */
export function parseForm4Xml(xml: string): ParsedForm4Tx[] {
  const doc = parser.parse(xml) as { ownershipDocument?: XmlNode };
  const root = doc.ownershipDocument;
  if (!root) return [];

  const owners = toArray(root.reportingOwner) as XmlNode[];
  const name = owners
    .map((o) => unwrap((o.reportingOwnerId as XmlNode | undefined)?.rptOwnerName))
    .filter(Boolean)
    .join(' / ');

  const table = root.nonDerivativeTable as XmlNode | undefined;
  const out: ParsedForm4Tx[] = [];
  for (const raw of toArray(table?.nonDerivativeTransaction) as XmlNode[]) {
    const code = unwrap((raw.transactionCoding as XmlNode | undefined)?.transactionCode);
    const amounts = raw.transactionAmounts as XmlNode | undefined;
    const shares = toNum(amounts?.transactionShares);
    const disposed = unwrap(amounts?.transactionAcquiredDisposedCode) === 'D';
    const date = unwrap(raw.transactionDate).slice(0, 10);
    if (!code || shares <= 0 || !date) continue;
    out.push({
      name,
      transactionCode: code,
      change: disposed ? -shares : shares,
      price: toNum(amounts?.transactionPricePerShare),
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
