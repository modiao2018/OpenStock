import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import dotenv from 'dotenv';
import type { MonitorConfig, WatchItem } from './types.js';

export const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(): MonitorConfig {
  dotenv.config({ path: join(MODULE_ROOT, '.env') });

  const rawText = readFileSync(join(MODULE_ROOT, 'config.yaml'), 'utf8');
  const raw = parse(rawText) as Record<string, any>;

  if (!Array.isArray(raw.watchlist) || raw.watchlist.length === 0) {
    throw new Error('config.yaml 缺少 watchlist，至少配置一只股票');
  }

  const watchlist: WatchItem[] = raw.watchlist.map((item: any) => {
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
    },
    env: {
      barkUrl: process.env.BARK_URL || undefined,
      feishuWebhookUrl: process.env.FEISHU_WEBHOOK_URL || undefined,
      edgarContact: process.env.EDGAR_CONTACT || 'catalyst-monitor@example.com',
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
