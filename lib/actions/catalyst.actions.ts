'use server';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { connectToDatabase } from '@/database/mongoose';
import {
    CatalystEvent,
    CatalystKv,
    CatalystTrial,
    CatalystWatchItem,
} from '@/database/models/catalyst.model';
import { sendBark, sendFeishu } from '@/catalyst-monitor/src/notify';
import { revalidatePath } from 'next/cache';

export interface CatalystWatchItemData {
    symbol: string;
    company: string;
    nctIds: string[];
    keywords: string[];
}

export interface TrialSearchResult {
    nctId: string;
    title: string;
    overallStatus: string;
    phase: string;
    primaryCompletionDate?: string;
}

export interface CatalystEventData {
    source: string;
    symbol?: string;
    title: string;
    url?: string;
    publishedAt?: string;
    fetchedAt: string;
    severity: string;
    notified: boolean;
}

export interface CatalystTrialData {
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

export async function getCatalystWatchItems(): Promise<CatalystWatchItemData[]> {
    try {
        await connectToDatabase();
        const docs = await CatalystWatchItem.find().sort({ symbol: 1 }).lean();
        return docs.map((d) => ({
            symbol: d.symbol,
            company: d.company,
            nctIds: d.nctIds ?? [],
            keywords: d.keywords ?? [],
        }));
    } catch (error) {
        console.error('Error fetching catalyst watch items:', error);
        return [];
    }
}

export async function saveCatalystWatchItem(item: CatalystWatchItemData) {
    try {
        await connectToDatabase();
        const symbol = item.symbol.toUpperCase().trim();
        const nctIds = item.nctIds.map((n) => n.toUpperCase().trim()).filter(Boolean);
        await CatalystWatchItem.findOneAndUpdate(
            { symbol },
            {
                symbol,
                company: item.company.trim(),
                nctIds,
                keywords: item.keywords.map((k) => k.trim()).filter(Boolean),
            },
            { upsert: true }
        );
        // 清理不再监控的试验快照，避免日历残留
        await CatalystTrial.deleteMany({ symbol, nctId: { $nin: nctIds } });
        revalidatePath('/catalyst');
        return { success: true };
    } catch (error) {
        console.error('Error saving catalyst watch item:', error);
        throw new Error('Failed to save catalyst watch item');
    }
}

export async function deleteCatalystWatchItem(symbol: string) {
    try {
        await connectToDatabase();
        const sym = symbol.toUpperCase();
        await CatalystWatchItem.findOneAndDelete({ symbol: sym });
        // 试验快照跟随清单删除；events 保留作历史时间线
        await CatalystTrial.deleteMany({ symbol: sym });
        revalidatePath('/catalyst');
        return { success: true };
    } catch (error) {
        console.error('Error deleting catalyst watch item:', error);
        throw new Error('Failed to delete catalyst watch item');
    }
}

/** 按公司名/药物代号全文搜索 ClinicalTrials.gov，供网页端勾选 NCT 试验 */
export async function searchClinicalTrials(query: string): Promise<TrialSearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    try {
        const fields = [
            'protocolSection.identificationModule.nctId',
            'protocolSection.identificationModule.briefTitle',
            'protocolSection.statusModule.overallStatus',
            'protocolSection.statusModule.primaryCompletionDateStruct',
            'protocolSection.designModule.phases',
        ].join(',');
        const res = await fetch(
            `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(q)}&pageSize=25&fields=${fields}`,
            { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }
        );
        if (!res.ok) throw new Error(`ClinicalTrials.gov HTTP ${res.status}`);
        const data = (await res.json()) as { studies?: any[] };
        const results: TrialSearchResult[] = (data.studies ?? []).map((s) => {
            const proto = s.protocolSection ?? {};
            return {
                nctId: proto.identificationModule?.nctId ?? '',
                title: proto.identificationModule?.briefTitle ?? '',
                overallStatus: proto.statusModule?.overallStatus ?? 'UNKNOWN',
                phase: (proto.designModule?.phases ?? []).join('/') || 'N/A',
                primaryCompletionDate: proto.statusModule?.primaryCompletionDateStruct?.date,
            };
        }).filter((r) => r.nctId);
        // 在研的排前面，已完成/终止的沉底
        const doneStatuses = new Set(['COMPLETED', 'TERMINATED', 'WITHDRAWN']);
        return results.sort((a, b) => Number(doneStatuses.has(a.overallStatus)) - Number(doneStatuses.has(b.overallStatus)));
    } catch (error) {
        console.error('Error searching clinical trials:', error);
        return [];
    }
}

export async function getCatalystEvents(limit = 50): Promise<CatalystEventData[]> {
    try {
        await connectToDatabase();
        const docs = await CatalystEvent.find().sort({ fetchedAt: -1 }).limit(limit).lean();
        return docs.map((d) => ({
            source: d.source,
            symbol: d.symbol ?? undefined,
            title: d.title,
            url: d.url ?? undefined,
            publishedAt: d.publishedAt ?? undefined,
            fetchedAt: new Date(d.fetchedAt).toISOString(),
            severity: d.severity,
            notified: d.notified,
        }));
    } catch (error) {
        console.error('Error fetching catalyst events:', error);
        return [];
    }
}

// ---- 运行状态与调试 ----

export interface CollectorStatus {
    name: string;
    intervalMinutes: number;
    lastRun?: string;
    /** 上次运行时间在 3 倍轮询间隔内视为活跃 */
    active: boolean;
}

export interface MonitorStatusData {
    daemonOnline: boolean;
    channels: { bark: boolean; feishu: boolean; edgarContact: boolean };
    collectors: CollectorStatus[];
}

export async function getMonitorStatus(): Promise<MonitorStatusData> {
    // 轮询间隔以 config.yaml 为准（daemon 启动时读取同一文件）
    const defaults = { halts: 2, edgar: 5, rss: 5, clinicaltrials: 15 };
    let intervals: Record<string, number> = { ...defaults };
    try {
        const raw = parseYaml(readFileSync(join(process.cwd(), 'catalyst-monitor', 'config.yaml'), 'utf8')) as any;
        intervals = {
            halts: Number(raw?.poll?.halts_minutes ?? defaults.halts),
            edgar: Number(raw?.poll?.edgar_minutes ?? defaults.edgar),
            rss: Number(raw?.poll?.rss_minutes ?? defaults.rss),
            clinicaltrials: Number(raw?.poll?.clinicaltrials_minutes ?? defaults.clinicaltrials),
        };
    } catch (error) {
        console.error('Error reading catalyst-monitor/config.yaml:', error);
    }

    let lastRuns: Record<string, string> = {};
    try {
        await connectToDatabase();
        const docs = await CatalystKv.find({ key: /^collector_last_run:/ }).lean();
        lastRuns = Object.fromEntries(docs.map((d) => [d.key.replace('collector_last_run:', ''), d.value]));
    } catch (error) {
        console.error('Error fetching collector heartbeats:', error);
    }

    const now = Date.now();
    const collectors: CollectorStatus[] = Object.entries(intervals).map(([name, intervalMinutes]) => {
        const lastRun = lastRuns[name];
        const active = !!lastRun && now - Date.parse(lastRun) < intervalMinutes * 3 * 60_000;
        return { name, intervalMinutes, lastRun, active };
    });

    return {
        daemonOnline: collectors.some((c) => c.active),
        channels: {
            bark: Boolean(process.env.BARK_URL),
            feishu: Boolean(process.env.FEISHU_WEBHOOK_URL),
            edgarContact: Boolean(process.env.EDGAR_CONTACT),
        },
        collectors,
    };
}

export interface TestPushResult {
    bark: 'ok' | 'fail' | 'skipped';
    feishu: 'ok' | 'fail' | 'skipped';
}

/** 调试用：向已配置的渠道各发一条测试消息（normal 级别，不响铃） */
export async function sendTestPush(): Promise<TestPushResult> {
    const msg = {
        title: 'catalyst-monitor 测试推送',
        body: `来自网页调试面板 · ${new Date().toISOString()}`,
        urgent: false,
    };
    const result: TestPushResult = { bark: 'skipped', feishu: 'skipped' };

    const barkUrl = process.env.BARK_URL;
    if (barkUrl) {
        try {
            await sendBark(barkUrl, msg);
            result.bark = 'ok';
        } catch (error) {
            console.error('Test push to Bark failed:', error);
            result.bark = 'fail';
        }
    }
    const feishuUrl = process.env.FEISHU_WEBHOOK_URL;
    if (feishuUrl) {
        try {
            await sendFeishu(feishuUrl, msg);
            result.feishu = 'ok';
        } catch (error) {
            console.error('Test push to Feishu failed:', error);
            result.feishu = 'fail';
        }
    }
    return result;
}

export async function getCatalystTrials(): Promise<CatalystTrialData[]> {
    try {
        await connectToDatabase();
        const docs = await CatalystTrial.find().sort({ primaryCompletionDate: 1 }).lean();
        return docs.map((d) => ({
            nctId: d.nctId,
            symbol: d.symbol,
            title: d.title,
            overallStatus: d.overallStatus,
            phase: d.phase,
            primaryCompletionDate: d.primaryCompletionDate ?? undefined,
            completionDate: d.completionDate ?? undefined,
            lastUpdatePostDate: d.lastUpdatePostDate ?? undefined,
            hasResults: d.hasResults,
        }));
    } catch (error) {
        console.error('Error fetching catalyst trials:', error);
        return [];
    }
}
