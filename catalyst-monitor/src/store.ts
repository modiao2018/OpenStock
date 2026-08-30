import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_ROOT, log } from './config.js';
import type { NewEvent, StoredEvent } from './types.js';

export function sha256(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export interface TrialSnapshot {
  nctId: string;
  symbol: string;
  title: string;
  overallStatus: string;
  phase: string;
  primaryCompletionDate?: string;
  completionDate?: string;
  lastUpdatePostDate?: string;
  hasResults: boolean;
}

export class Store {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const dir = join(MODULE_ROOT, 'data');
    mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath ?? join(dir, 'monitor.db'));
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        source        TEXT NOT NULL,
        external_id   TEXT NOT NULL,
        symbol        TEXT,
        title         TEXT NOT NULL,
        url           TEXT,
        published_at  TEXT,
        fetched_at    TEXT NOT NULL,
        content_hash  TEXT NOT NULL,
        severity      TEXT NOT NULL,
        raw           TEXT NOT NULL,
        notified      INTEGER NOT NULL DEFAULT 0,
        UNIQUE(source, external_id, content_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_events_entity ON events(source, external_id);
      CREATE INDEX IF NOT EXISTS idx_events_symbol ON events(symbol, fetched_at);

      CREATE TABLE IF NOT EXISTS trials (
        nct_id                  TEXT PRIMARY KEY,
        symbol                  TEXT NOT NULL,
        title                   TEXT NOT NULL,
        overall_status          TEXT NOT NULL,
        phase                   TEXT NOT NULL,
        primary_completion_date TEXT,
        completion_date         TEXT,
        last_update_post_date   TEXT,
        has_results             INTEGER NOT NULL DEFAULT 0,
        updated_at              TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kv (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  /**
   * 幂等入库：同 (source, externalId, contentHash) 已存在则返回 null。
   * 返回的 isFirstSnapshot 表示这是该实体第一次入库（建档，不该推送）。
   */
  insertEvent(ev: NewEvent): StoredEvent | null {
    const seenBefore = this.db
      .prepare('SELECT 1 FROM events WHERE source = ? AND external_id = ? LIMIT 1')
      .get(ev.source, ev.externalId);

    const fetchedAt = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO events
           (source, external_id, symbol, title, url, published_at, fetched_at, content_hash, severity, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ev.source,
        ev.externalId,
        ev.symbol ?? null,
        ev.title,
        ev.url ?? null,
        ev.publishedAt ?? null,
        fetchedAt,
        ev.contentHash,
        ev.severity,
        JSON.stringify(ev.raw)
      );

    if (result.changes === 0) return null; // 已见过，无变化

    return {
      ...ev,
      id: Number(result.lastInsertRowid),
      fetchedAt,
      isFirstSnapshot: !seenBefore,
    };
  }

  markNotified(id: number): void {
    this.db.prepare('UPDATE events SET notified = 1 WHERE id = ?').run(id);
  }

  upsertTrial(t: TrialSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO trials
           (nct_id, symbol, title, overall_status, phase, primary_completion_date,
            completion_date, last_update_post_date, has_results, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(nct_id) DO UPDATE SET
           symbol = excluded.symbol,
           title = excluded.title,
           overall_status = excluded.overall_status,
           phase = excluded.phase,
           primary_completion_date = excluded.primary_completion_date,
           completion_date = excluded.completion_date,
           last_update_post_date = excluded.last_update_post_date,
           has_results = excluded.has_results,
           updated_at = excluded.updated_at`
      )
      .run(
        t.nctId,
        t.symbol,
        t.title,
        t.overallStatus,
        t.phase,
        t.primaryCompletionDate ?? null,
        t.completionDate ?? null,
        t.lastUpdatePostDate ?? null,
        t.hasResults ? 1 : 0,
        new Date().toISOString()
      );
  }

  listTrials(): TrialSnapshot[] {
    const rows = this.db.prepare('SELECT * FROM trials ORDER BY primary_completion_date').all() as any[];
    return rows.map((r) => ({
      nctId: r.nct_id,
      symbol: r.symbol,
      title: r.title,
      overallStatus: r.overall_status,
      phase: r.phase,
      primaryCompletionDate: r.primary_completion_date ?? undefined,
      completionDate: r.completion_date ?? undefined,
      lastUpdatePostDate: r.last_update_post_date ?? undefined,
      hasResults: r.has_results === 1,
    }));
  }

  getKv(key: string, maxAgeMs?: number): string | null {
    const row = this.db.prepare('SELECT value, updated_at FROM kv WHERE key = ?').get(key) as
      | { value: string; updated_at: string }
      | undefined;
    if (!row) return null;
    if (maxAgeMs !== undefined && Date.now() - Date.parse(row.updated_at) > maxAgeMs) return null;
    return row.value;
  }

  setKv(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, new Date().toISOString());
  }

  close(): void {
    this.db.close();
    log('store', 'database closed');
  }
}
