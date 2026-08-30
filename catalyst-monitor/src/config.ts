import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { MonitorConfig, WatchItem } from './types';

export const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 环境变量与主应用共用仓库根目录的 .env，由 env.ts 在入口处加载
export function loadConfig(): MonitorConfig {
  const rawText = readFileSync(join(MODULE_ROOT, 'config.yaml'), 'utf8');
  const raw = parse(rawText) as Record<string, any>;

  // watchlist 可为空：清单以数据库为准，yaml 里的条目只作首次迁移的种子
  const watchlist: WatchItem[] = (Array.isArray(raw.watchlist) ? raw.watchlist : []).map((item: any) => {
    if (!item.symbol || !item.company) {
      throw new Error(`watchlist 条目缺少 symbol/company: ${JSON.stringify(item)}`);
    }
    return {
      symbol: String(item.symbol).toUpperCase(),
      company: String(item.company),
      nctIds: (item.nct_ids ?? []).map((n: string) => String(n).toUpperCase()),
      keywords: (item.keywords ?? []).map(String),
    };
  });

  return {
    watchlist,
    edgar: {
      forms: (raw.edgar?.forms ?? ['8-K', '6-K']).map(String),
      lookbackDays: Number(raw.edgar?.lookback_days ?? 7),
    },
    feeds: (raw.feeds ?? []).map((f: any) => ({ name: String(f.name), url: String(f.url) })),
    poll: {
      clinicaltrialsMinutes: Number(raw.poll?.clinicaltrials_minutes ?? 15),
      edgarMinutes: Number(raw.poll?.edgar_minutes ?? 5),
      haltsMinutes: Number(raw.poll?.halts_minutes ?? 2),
      rssMinutes: Number(raw.poll?.rss_minutes ?? 5),
      marketMinutes: Number(raw.poll?.market_minutes ?? 2),
    },
    market: {
      benchmark: String(raw.market?.benchmark ?? 'XBI').toUpperCase(),
      sigmaThreshold: Number(raw.market?.sigma_threshold ?? 2.5),
      rvolThreshold: Number(raw.market?.rvol_threshold ?? 3),
    },
    env: {
      barkUrl: process.env.BARK_URL || undefined,
      edgarContact: process.env.EDGAR_CONTACT || 'catalyst-monitor@example.com',
      alpacaKey: process.env.ALPACA_API_KEY || undefined,
      alpacaSecret: process.env.ALPACA_API_SECRET || undefined,
    },
  };
}

export function log(scope: string, message: string): void {
  console.log(`[${new Date().toISOString()}] [${scope}] ${message}`);
}

export function logError(scope: string, err: unknown): void {
  const msg = err instanceof Error ? `${err.message}` : String(err);
  console.error(`[${new Date().toISOString()}] [${scope}] ERROR: ${msg}`);
}
