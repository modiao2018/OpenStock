'use server';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { connectToDatabase } from '@/database/mongoose';
import {
    CatalystCustomEvent,
    CatalystEvent,
    CatalystKv,
    CatalystTrial,
    CatalystWatchItem,
} from '@/database/models/catalyst.model';
import { sendBark } from '@/catalyst-monitor/src/notify';
import {
    callAIProviderWithConfig,
    getProviderConfig,
    type AIProviderName,
    type LlmConfigName,
} from '@/lib/ai-provider';
import { LLM_KV_KEY, resolveLlmConfig, type ResolvedLlmConfig } from '@/lib/llm-config';
import { revalidatePath } from 'next/cache';

export interface CatalystWatchItemData {
    symbol: string;
    company: string;
    nctIds: string[];
    keywords: string[];
    scenarioNotes?: string;
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
    analysis?: string;
    firstSnapshot: boolean;
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
            scenarioNotes: d.scenarioNotes ?? undefined,
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
                scenarioNotes: item.scenarioNotes?.trim() || undefined,
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
            analysis: d.analysis ?? undefined,
            firstSnapshot: d.firstSnapshot ?? false,
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
    channels: { bark: boolean; edgarContact: boolean };
    collectors: CollectorStatus[];
}

export async function getMonitorStatus(): Promise<MonitorStatusData> {
    // 轮询间隔以 config.yaml 为准（daemon 启动时读取同一文件）
    const defaults = { market: 2, halts: 2, edgar: 5, rss: 5, clinicaltrials: 15 };
    let intervals: Record<string, number> = { ...defaults };
    try {
        const raw = parseYaml(readFileSync(join(process.cwd(), 'catalyst-monitor', 'config.yaml'), 'utf8')) as any;
        intervals = {
            market: Number(raw?.poll?.market_minutes ?? defaults.market),
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
            edgarContact: Boolean(process.env.EDGAR_CONTACT),
        },
        collectors,
    };
}

export interface TestPushResult {
    bark: 'ok' | 'fail' | 'skipped';
}

/** 调试用：向 Bark 发一条测试消息（normal 级别，不响铃） */
export async function sendTestPush(): Promise<TestPushResult> {
    const barkUrl = process.env.BARK_URL;
    if (!barkUrl) return { bark: 'skipped' };
    try {
        await sendBark(barkUrl, {
            title: 'catalyst-monitor 测试推送',
            body: `来自网页调试面板 · ${new Date().toISOString()}`,
            urgent: false,
        });
        return { bark: 'ok' };
    } catch (error) {
        console.error('Test push to Bark failed:', error);
        return { bark: 'fail' };
    }
}

// ---- LLM 配置（供 agent 分析场景使用）----

const LLM_DEFAULTS: Record<LlmConfigName, { baseUrl: string; model: string }> = {
    gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models', model: 'gemini-2.5-flash-lite' },
    minimax: { baseUrl: 'https://api.minimax.io/v1', model: 'MiniMax-M3' },
    siray: { baseUrl: 'https://api.siray.ai/v1', model: 'siray-1.0-ultra' },
    custom: { baseUrl: '', model: '' },
};

export interface LlmConfigData {
    provider: LlmConfigName;
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
    /** 只显示尾部 4 位，明文 Key 不出服务端 */
    apiKeyMasked: string;
    /** true = 当前生效的是 .env 配置（尚未在网页保存过） */
    fromEnv: boolean;
}

export async function getLlmConfig(): Promise<LlmConfigData> {
    try {
        await connectToDatabase();
        const doc = await CatalystKv.findOne({ key: LLM_KV_KEY }).lean();
        if (doc) {
            const cfg = JSON.parse(doc.value) as ResolvedLlmConfig;
            return {
                provider: cfg.provider,
                baseUrl: cfg.baseUrl,
                model: cfg.model,
                hasApiKey: Boolean(cfg.apiKey),
                apiKeyMasked: cfg.apiKey ? `••••${cfg.apiKey.slice(-4)}` : '',
                fromEnv: false,
            };
        }
    } catch (error) {
        console.error('Error fetching LLM config:', error);
    }
    const env = getProviderConfig();
    return {
        provider: env.name as AIProviderName,
        baseUrl: env.baseUrl,
        model: env.model,
        hasApiKey: Boolean(env.apiKey),
        apiKeyMasked: env.apiKey ? `••••${env.apiKey.slice(-4)}` : '',
        fromEnv: true,
    };
}

export async function saveLlmConfig(input: {
    provider: LlmConfigName;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}) {
    try {
        await connectToDatabase();
        const existing = await resolveLlmConfig();
        const defaults = LLM_DEFAULTS[input.provider];
        const cfg: ResolvedLlmConfig = {
            provider: input.provider,
            // 留空 = 保留已保存的 Key（编辑模型时不用重填）
            apiKey: input.apiKey?.trim() || existing?.apiKey || '',
            baseUrl: input.baseUrl?.trim() || defaults.baseUrl,
            model: input.model?.trim() || defaults.model,
        };
        await CatalystKv.findOneAndUpdate(
            { key: LLM_KV_KEY },
            { $set: { value: JSON.stringify(cfg) } },
            { upsert: true }
        );
        revalidatePath('/catalyst');
        return { success: true };
    } catch (error) {
        console.error('Error saving LLM config:', error);
        throw new Error('Failed to save LLM config');
    }
}

export interface LlmTestResult {
    ok: boolean;
    provider?: string;
    model?: string;
    latencyMs?: number;
    reply?: string;
    error?: string;
}

/** 调试用：向当前生效的 LLM 发一条极短 prompt 验证连通性 */
export async function testLlm(): Promise<LlmTestResult> {
    try {
        const cfg = await resolveLlmConfig();
        if (!cfg || !cfg.apiKey) {
            return { ok: false, error: 'API Key 未配置' };
        }
        const start = Date.now();
        const reply = await callAIProviderWithConfig('请只回复两个字符：OK', {
            name: cfg.provider,
            apiKey: cfg.apiKey,
            baseUrl: cfg.baseUrl,
            model: cfg.model,
        });
        return {
            ok: true,
            provider: cfg.provider,
            model: cfg.model,
            latencyMs: Date.now() - start,
            reply: reply.slice(0, 100),
        };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// ---- 自定义催化剂（手动 + AI 自动抽取）----

export type CustomCatalystKind = 'data-readout' | 'pdufa' | 'adcom' | 'earnings' | 'conference' | 'other';

export interface CustomCatalystData {
    id: string;
    symbol: string;
    title: string;
    date: string;
    kind: CustomCatalystKind;
    note?: string;
    source: 'manual' | 'auto';
}

export async function getCustomCatalysts(): Promise<CustomCatalystData[]> {
    try {
        await connectToDatabase();
        const docs = await CatalystCustomEvent.find().sort({ date: 1 }).lean();
        return docs.map((d) => ({
            id: String(d._id),
            symbol: d.symbol,
            title: d.title,
            date: d.date,
            kind: d.kind,
            note: d.note ?? undefined,
            source: d.source,
        }));
    } catch (error) {
        console.error('Error fetching custom catalysts:', error);
        return [];
    }
}

export async function addCustomCatalyst(input: {
    symbol: string;
    title: string;
    date: string;
    kind: CustomCatalystKind;
}) {
    try {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('date must be YYYY-MM-DD');
        await connectToDatabase();
        await CatalystCustomEvent.findOneAndUpdate(
            { symbol: input.symbol.toUpperCase().trim(), title: input.title.trim(), date: input.date },
            { $setOnInsert: { kind: input.kind, source: 'manual' } },
            { upsert: true }
        );
        revalidatePath('/catalyst');
        return { success: true };
    } catch (error) {
        console.error('Error adding custom catalyst:', error);
        throw new Error('Failed to add custom catalyst');
    }
}

export async function deleteCustomCatalyst(id: string) {
    try {
        await connectToDatabase();
        await CatalystCustomEvent.findByIdAndDelete(id);
        revalidatePath('/catalyst');
        return { success: true };
    } catch (error) {
        console.error('Error deleting custom catalyst:', error);
        throw new Error('Failed to delete custom catalyst');
    }
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
