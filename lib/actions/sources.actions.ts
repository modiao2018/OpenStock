'use server';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { connectToDatabase } from '@/database/mongoose';
import { SourceStats, type ISourceStats } from '@/database/models/source-stats.model';
import { CatalystKv } from '@/database/models/catalyst.model';
import { resolveLlmConfig } from '@/lib/llm-config';
import { recordSourceCall } from '@/lib/source-calls';
import { isSourceConfigured, probeSource as runProbe, type ProbeResult } from '@/lib/source-probes';
import { classifySource, summarizeWindow, type SourceLevel, type SourceWindow } from '@/lib/source-stats-math';
import { SOURCES, rssSourceId, sourceIdOf, type SourceFeature, type SourceGroup, type SourceId } from '@/lib/sources-registry';
import type { InsiderXcheckResult, QuoteXcheckResult } from '@/catalyst-monitor/src/collectors/xcheck';
import { XCHECK_INSIDER_KEY, XCHECK_QUOTES_KEY } from '@/catalyst-monitor/src/collectors/xcheck';

export interface SourceStatusRow {
    // Raw id (rss children carry rss:<slug>)
    id: string;
    sourceId: SourceId;
    name: string;
    host: string;
    group: SourceGroup;
    level: SourceLevel;
    configured: boolean;
    keyless: boolean;
    usedBy: SourceFeature[];
    probeable: boolean;
    window24h: SourceWindow;
    lastOkAt: number | null;
    lastFailAt: number | null;
    lastLatencyMs: number | null;
    consecutiveFails: number;
    lastError: string | null;
    lastProbe: { at: number; ok: boolean; latencyMs: number; error?: string } | null;
    children?: SourceStatusRow[];
}

type FeedConfig = { name: string; url: string };

function readFeeds(): FeedConfig[] {
    try {
        const raw = parseYaml(readFileSync(join(process.cwd(), 'catalyst-monitor', 'config.yaml'), 'utf8')) as any;
        return (raw?.feeds ?? []).map((f: any) => ({ name: String(f.name), url: String(f.url) }));
    } catch {
        return [];
    }
}

const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : null);

function toRow(
    id: string,
    sourceId: SourceId,
    spec: (typeof SOURCES)[number],
    doc: ISourceStats | null,
    configured: boolean,
    host: string,
    name: string,
    now: number,
): SourceStatusRow {
    const window24h = summarizeWindow(doc?.hours, now);
    const lastProbe = doc?.lastProbe
        ? { at: ms(doc.lastProbe.at) ?? 0, ok: doc.lastProbe.ok, latencyMs: doc.lastProbe.latencyMs, error: doc.lastProbe.error }
        : null;
    const level = classifySource(
        doc
            ? {
                consecutiveFails: doc.consecutiveFails ?? 0,
                lastOkAt: ms(doc.lastOkAt),
                lastFailAt: ms(doc.lastFailAt),
                lastProbe,
                window: window24h,
            }
            : null,
        configured,
    );
    return {
        id,
        sourceId,
        name,
        host,
        group: spec.group,
        level,
        configured,
        keyless: spec.keyEnv.length === 0,
        usedBy: spec.usedBy,
        probeable: spec.probe !== 'none' && configured,
        window24h,
        lastOkAt: ms(doc?.lastOkAt),
        lastFailAt: ms(doc?.lastFailAt),
        lastLatencyMs: doc?.lastLatencyMs ?? null,
        consecutiveFails: doc?.consecutiveFails ?? 0,
        lastError: doc?.lastError?.message ?? null,
        lastProbe,
    };
}

export async function getSourcesStatus(): Promise<SourceStatusRow[]> {
    const now = Date.now();
    let docs: ISourceStats[] = [];
    try {
        await connectToDatabase();
        docs = (await SourceStats.find().lean()) as unknown as ISourceStats[];
    } catch (e) {
        console.error('Source stats fetch failed', e);
    }
    const byId = new Map(docs.map((d) => [d.source, d]));
    const feeds = readFeeds();
    const llm = await resolveLlmConfig().catch(() => null);

    const rows: SourceStatusRow[] = [];
    for (const spec of SOURCES) {
        const configured = spec.id === 'llm' ? llm !== null : await isSourceConfigured(spec.id);
        const host = spec.id === 'llm' && llm ? `${llm.provider} · ${llm.model}` : spec.host;
        const row = toRow(spec.id, spec.id, spec, byId.get(spec.id) ?? null, configured, host, spec.name, now);

        if (spec.dynamicPrefix) {
            const children = feeds.map((f) => {
                const cid = rssSourceId(f.name);
                let h = f.url;
                try { h = new URL(f.url).hostname; } catch { /* keep raw */ }
                return toRow(cid, spec.id, spec, byId.get(cid) ?? null, configured, h, f.name, now);
            });
            row.children = children;
            // Roll the parent up to the worst child so the group line is honest
            const order: SourceLevel[] = ['down', 'warn', 'ok', 'idle', 'unconfigured'];
            const worst = children.map((c) => c.level).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
            if (worst) row.level = worst;
            row.probeable = false;
        }
        rows.push(row);
    }
    return rows;
}

export interface XcheckStatus {
    quotes: QuoteXcheckResult | null;
    insider: InsiderXcheckResult | null;
    twelveConfigured: boolean;
}

export async function getXcheckStatus(): Promise<XcheckStatus> {
    const out: XcheckStatus = { quotes: null, insider: null, twelveConfigured: Boolean(process.env.TWELVEDATA_API_KEY) };
    try {
        await connectToDatabase();
        const docs = await CatalystKv.find({ key: { $in: [XCHECK_QUOTES_KEY, XCHECK_INSIDER_KEY] } }).lean();
        for (const d of docs) {
            try {
                if (d.key === XCHECK_QUOTES_KEY) out.quotes = JSON.parse(d.value);
                else if (d.key === XCHECK_INSIDER_KEY) out.insider = JSON.parse(d.value);
            } catch {
                // 损坏的记录忽略
            }
        }
    } catch (e) {
        console.error('Xcheck status fetch failed', e);
    }
    return out;
}

// Manual probe from the /status page; awaited so the row reflects it on the
// next refresh
export async function probeSourceAction(id: string): Promise<ProbeResult> {
    if (!sourceIdOf(id)) return { ok: false, latencyMs: 0, error: 'unknown source' };
    const result = await runProbe(id, {
        edgarContact: process.env.EDGAR_CONTACT || 'catalyst-monitor@example.com',
        feeds: readFeeds(),
    });
    if (result.error !== 'passive') {
        await recordSourceCall(id, result.ok, result.latencyMs, result.error, { probe: true });
    }
    return result;
}
