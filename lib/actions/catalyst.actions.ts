'use server';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { connectToDatabase } from '@/database/mongoose';
import {
    CatalystBar,
    CatalystCustomEvent,
    CatalystEvent,
    CatalystKv,
    CatalystTrial,
    CatalystWatchItem,
} from '@/database/models/catalyst.model';
import { abnormalSeries, rollingWindows, stddev } from '@/catalyst-monitor/src/market-math';
import { extractAction } from '@/catalyst-monitor/src/analyze';
import { notify, pushMessage, sendBark, type PushEnv } from '@/catalyst-monitor/src/notify';
import { sendWeeklyReport } from '@/catalyst-monitor/src/collectors/weekly';
import type { StoredEvent } from '@/catalyst-monitor/src/types';
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
    autoDiscover: boolean;
}

export interface TrialSearchResult {
    nctId: string;
    title: string;
    overallStatus: string;
    phase: string;
    primaryCompletionDate?: string;
}

export interface CatalystEventData {
    id: string;
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
            autoDiscover: d.autoDiscover ?? true,
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
                autoDiscover: item.autoDiscover,
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
            id: String(d._id),
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
    /** 连续失败次数（成功后清零） */
    consecutiveErrors: number;
    lastError?: { time: string; message: string };
}

export interface MonitorStatusData {
    daemonOnline: boolean;
    /** 有采集器处于连续失败状态 */
    hasErrors: boolean;
    channels: { bark: boolean; edgarContact: boolean };
    collectors: CollectorStatus[];
}

export async function getMonitorStatus(): Promise<MonitorStatusData> {
    // 轮询间隔以 config.yaml 为准（daemon 启动时读取同一文件）
    const defaults = { market: 2, halts: 2, edgar: 5, rss: 5, clinicaltrials: 15, discovery: 720 };
    let intervals: Record<string, number> = { ...defaults };
    try {
        const raw = parseYaml(readFileSync(join(process.cwd(), 'catalyst-monitor', 'config.yaml'), 'utf8')) as any;
        intervals = {
            market: Number(raw?.poll?.market_minutes ?? defaults.market),
            halts: Number(raw?.poll?.halts_minutes ?? defaults.halts),
            edgar: Number(raw?.poll?.edgar_minutes ?? defaults.edgar),
            rss: Number(raw?.poll?.rss_minutes ?? defaults.rss),
            clinicaltrials: Number(raw?.poll?.clinicaltrials_minutes ?? defaults.clinicaltrials),
            discovery: defaults.discovery,
        };
    } catch (error) {
        console.error('Error reading catalyst-monitor/config.yaml:', error);
    }

    let lastRuns: Record<string, string> = {};
    let errorCounts: Record<string, number> = {};
    let lastErrors: Record<string, { time: string; message: string }> = {};
    try {
        await connectToDatabase();
        const docs = await CatalystKv.find({ key: /^collector_(last_run|error_count|last_error):/ }).lean();
        for (const d of docs) {
            if (d.key.startsWith('collector_last_run:')) {
                lastRuns[d.key.slice('collector_last_run:'.length)] = d.value;
            } else if (d.key.startsWith('collector_error_count:')) {
                errorCounts[d.key.slice('collector_error_count:'.length)] = Number(d.value) || 0;
            } else if (d.key.startsWith('collector_last_error:') && d.value) {
                try {
                    lastErrors[d.key.slice('collector_last_error:'.length)] = JSON.parse(d.value);
                } catch {
                    // 忽略损坏的错误记录
                }
            }
        }
    } catch (error) {
        console.error('Error fetching collector heartbeats:', error);
    }

    const now = Date.now();
    const collectors: CollectorStatus[] = Object.entries(intervals).map(([name, intervalMinutes]) => {
        const lastRun = lastRuns[name];
        const active = !!lastRun && now - Date.parse(lastRun) < intervalMinutes * 3 * 60_000;
        const consecutiveErrors = errorCounts[name] ?? 0;
        return {
            name,
            intervalMinutes,
            lastRun,
            active,
            consecutiveErrors,
            lastError: consecutiveErrors > 0 ? lastErrors[name] : undefined,
        };
    });

    return {
        daemonOnline: collectors.some((c) => c.active),
        hasErrors: collectors.some((c) => c.active && c.consecutiveErrors > 0),
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

// ---- 模拟推送测试：每种监控场景各发一条带【模拟】标记的样例通知 ----

export type SimulatedKind = 'clinicaltrials' | 'edgar' | 'halts' | 'rss' | 'market' | 'reminder' | 'weekly';

export async function sendSimulatedAlert(kind: SimulatedKind): Promise<{ delivered: boolean }> {
    const env: PushEnv = { barkUrl: process.env.BARK_URL || undefined };
    await connectToDatabase();
    const sym = (await CatalystWatchItem.findOne().lean())?.symbol ?? 'DEMO';
    const nowIso = new Date().toISOString();

    const mkEvent = (partial: Partial<StoredEvent>): StoredEvent => ({
        id: 'sim',
        source: 'rss',
        externalId: 'sim',
        symbol: sym,
        title: '',
        contentHash: 'sim',
        raw: {},
        severity: 'normal',
        fetchedAt: nowIso,
        isFirstSnapshot: false,
        ...partial,
    });

    // urgent 事件按真实流程发两条：告警 + AI 分析跟进（标题带操作评级）
    const sendUrgentPair = async (ev: StoredEvent, cannedAnalysis: string) => {
        const delivered = await notify(env, ev);
        const action = extractAction(cannedAnalysis);
        await pushMessage(env, {
            title: `AI 分析${action ? `【${action}】` : ''}｜${ev.title}`,
            body: cannedAnalysis,
            urgent: false,
            url: ev.url,
        });
        return { delivered };
    };

    switch (kind) {
        case 'clinicaltrials':
            return sendUrgentPair(
                mkEvent({
                    source: 'clinicaltrials',
                    severity: 'urgent',
                    title: `${sym} NCT01234567 已完成（已发布结果）【模拟】`,
                    publishedAt: nowIso,
                    url: 'https://clinicaltrials.gov',
                }),
                '【模拟分析】试验结果已发布：主终点达成 p=0.008，效应量中等偏上，未见 3 级以上安全事件。' +
                    '倾向判断：利好。理由：统计显著且安全性干净，落在预设"成功"档。' +
                    '操作建议：加仓——按"成功"档预案分批执行，勿追开盘跳空，设好止损。'
            );
        case 'edgar':
            return sendUrgentPair(
                mkEvent({
                    source: 'edgar',
                    severity: 'urgent',
                    title: `${sym} 提交 8-K：业绩发布(2.02)、财务报表及附件(9.01)【模拟】`,
                    publishedAt: nowIso,
                    url: 'https://www.sec.gov',
                }),
                '【模拟分析】公司发布季度业绩 8-K：营收 1.2 亿美元超预期 15%，现金储备 8.5 亿美元可支撑至 2028 年。' +
                    '倾向判断：中性偏利好。理由：财务稳健但未披露管线新进展。' +
                    '操作建议：持有——维持现有仓位，等待电话会上的临床进度指引。'
            );
        case 'market':
            return sendUrgentPair(
                mkEvent({
                    source: 'market',
                    severity: 'urgent',
                    title: `${sym} 疑似事件资金流：5分钟异常拉升 4.20%（3.8σ），量比 6.2，同期 XBI 0.15%【模拟】`,
                    publishedAt: nowIso,
                }),
                '【模拟简报】5 分钟急拉 4.2%（3.8σ）且量比 6.2，显著强于 XBI，属事件驱动型放量异动。' +
                    '近 48 小时无公告对应、未来 30 天无已知催化剂——警惕未公开消息。' +
                    '建议：查停牌与新闻 wire，复核仓位，勿盲目追价。'
            );
        case 'halts':
            return {
                delivered: await notify(
                    env,
                    mkEvent({
                        source: 'halts',
                        severity: 'urgent',
                        title: `${sym} 停牌：消息待发布(T1) 09:31:00(美东)【模拟】`,
                        publishedAt: nowIso,
                        url: 'https://www.nasdaqtrader.com/trader.aspx?id=TradeHalts',
                    })
                ),
            };
        case 'rss':
            return {
                delivered: await notify(
                    env,
                    mkEvent({
                        source: 'rss',
                        severity: 'normal',
                        title: `${sym} 相关新闻: Company Announces Positive Phase 2 Interim Data【模拟】`,
                        publishedAt: nowIso,
                        analysis:
                            '【模拟分析】公司公布二期中期数据：达到安全性终点，药代动力学支持每月给药。' +
                            '倾向判断：利好。理由：推进路径清晰，为后续关键数据铺垫。' +
                            '操作建议：观望——把顶线数据日期加入催化剂日历并预设三档情景后再定。',
                    })
                ),
            };
        case 'reminder':
            return {
                delivered: await pushMessage(env, {
                    title: `催化剂提醒｜${sym} 7 天后【模拟】`,
                    body: `数据读出：${sym} 二期顶线数据（模拟）\n日期: ${new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)}\n事件前请核对情景预案与仓位（二元事件注意 gap 风险）`,
                    urgent: false,
                }),
            };
        case 'weekly': {
            const watchlist = (await CatalystWatchItem.find().lean()).map((d) => ({ symbol: d.symbol }));
            return { delivered: await sendWeeklyReport({ watchlist, env }) };
        }
    }
}

// ---- 盘面监控快照（页面展示用，与 market collector 同一套数学） ----

export interface MarketSymbolSnapshot {
    symbol: string;
    /** 最新 5 分钟 abnormal return（%，已扣基准） */
    arPct: number;
    /** 相对该股历史波动的倍数 */
    z: number;
    /** 相对成交量 */
    rvol: number;
    lastBarAt: string;
    baselineSamples: number;
    /** 最新数据是否在 10 分钟内（盘中实时性判断） */
    fresh: boolean;
}

export interface MarketSnapshotData {
    configured: boolean;
    marketOpen?: boolean;
    benchmark: string;
    sigmaThreshold: number;
    rvolThreshold: number;
    symbols: MarketSymbolSnapshot[];
}

export async function getMarketSnapshot(): Promise<MarketSnapshotData> {
    const { benchmark, sigmaThreshold, rvolThreshold } = await getMarketConfig();
    const base: MarketSnapshotData = {
        configured: Boolean(process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET),
        benchmark,
        sigmaThreshold,
        rvolThreshold,
        symbols: [],
    };
    if (!base.configured) return base;

    try {
        const res = await fetch('https://paper-api.alpaca.markets/v2/clock', {
            headers: {
                'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
                'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET!,
            },
            signal: AbortSignal.timeout(5_000),
            cache: 'no-store',
        });
        if (res.ok) base.marketOpen = ((await res.json()) as { is_open: boolean }).is_open;
    } catch {
        // clock 拉不到不影响快照展示
    }

    try {
        await connectToDatabase();
        const watchItems = await CatalystWatchItem.find().lean();
        const since = new Date(Date.now() - 12 * 24 * 3600_000);
        const toBar = (d: any) => ({ symbol: d.symbol, t: new Date(d.t), o: d.o, h: d.h, l: d.l, c: d.c, v: d.v });

        const benchDocs = await CatalystBar.find({ symbol: benchmark, t: { $gte: since } }).sort({ t: 1 }).lean();
        const benchWindows = rollingWindows(benchDocs.map(toBar));

        for (const item of watchItems) {
            const docs = await CatalystBar.find({ symbol: item.symbol, t: { $gte: since } }).sort({ t: 1 }).lean();
            if (docs.length === 0) continue;
            const ars = abnormalSeries(rollingWindows(docs.map(toBar)), benchWindows);
            if (ars.length < 10) continue;

            const current = ars[ars.length - 1];
            const baseline = ars.slice(0, -6);
            const sigma = baseline.length >= 100 ? stddev(baseline.map((w) => w.ret)) : 0;
            const volAvg = baseline.length ? baseline.reduce((a, w) => a + w.vol, 0) / baseline.length : 0;

            base.symbols.push({
                symbol: item.symbol,
                arPct: Number((current.ret * 100).toFixed(2)),
                z: sigma > 0 ? Number((current.ret / sigma).toFixed(1)) : 0,
                rvol: volAvg > 0 ? Number((current.vol / volAvg).toFixed(1)) : 0,
                lastBarAt: new Date(current.t).toISOString(),
                baselineSamples: baseline.length,
                fresh: Date.now() - current.t < 10 * 60_000,
            });
        }
    } catch (error) {
        console.error('Error building market snapshot:', error);
    }
    return base;
}

async function getMarketConfig(): Promise<{ benchmark: string; sigmaThreshold: number; rvolThreshold: number }> {
    try {
        const raw = parseYaml(readFileSync(join(process.cwd(), 'catalyst-monitor', 'config.yaml'), 'utf8')) as any;
        return {
            benchmark: String(raw?.market?.benchmark ?? 'XBI').toUpperCase(),
            sigmaThreshold: Number(raw?.market?.sigma_threshold ?? 2.5),
            rvolThreshold: Number(raw?.market?.rvol_threshold ?? 3),
        };
    } catch {
        return { benchmark: 'XBI', sigmaThreshold: 2.5, rvolThreshold: 3 };
    }
}

// ---- 异动归因回放 ----

export interface AttributionData {
    available: boolean;
    /** 不可用时的原因说明 */
    reason?: string;
    symbol?: string;
    publishedAt?: string;
    fetchedAt?: string;
    /** 事件前 6 小时内首个 |z|≥2 异动窗口 */
    firstAbnormalAt?: string;
    /** 正数 = 价格比公告提前 N 分钟异动；负数 = 公告后才动 */
    leadMinutes?: number;
    maxZ?: number;
    baselineSamples?: number;
    spikes?: Array<{ t: string; z: number; retPct: number; rvol: number }>;
}

/**
 * 事后归因：对一条事件，回放事件前 6 小时的 5 分钟 abnormal return，
 * 找出第一次异动的时间，与信息源发布时间对比——回答"是谁先动的"。
 */
export async function getAttribution(eventId: string): Promise<AttributionData> {
    try {
        await connectToDatabase();
        const ev = await CatalystEvent.findById(eventId).lean();
        if (!ev?.symbol) return { available: false, reason: 'no_symbol' };

        // 锚点取"信息进入市场"的时刻：源发布时间需带具体时分（EDGAR/停牌/新闻）；
        // 纯日期（如临床试验注册库的更新日）无法定位盘中时点，改用首次抓取时间
        const pub = ev.publishedAt ?? '';
        const pubMs = Date.parse(pub);
        const hasClock = /\d{2}:\d{2}/.test(pub) && !Number.isNaN(pubMs);
        const t0 = hasClock ? pubMs : new Date(ev.fetchedAt).getTime();
        const benchmark = await getBenchmarkSymbol();

        const baselineStart = new Date(t0 - 8 * 24 * 3600_000);
        const replayEnd = new Date(t0 + 60 * 60_000);
        const [symDocs, benchDocs] = await Promise.all([
            CatalystBar.find({ symbol: ev.symbol, t: { $gte: baselineStart, $lte: replayEnd } }).sort({ t: 1 }).lean(),
            CatalystBar.find({ symbol: benchmark, t: { $gte: baselineStart, $lte: replayEnd } }).sort({ t: 1 }).lean(),
        ]);
        if (symDocs.length === 0) return { available: false, reason: 'no_bars', symbol: ev.symbol };

        const toBar = (d: any) => ({ symbol: d.symbol, t: new Date(d.t), o: d.o, h: d.h, l: d.l, c: d.c, v: d.v });
        const ars = abnormalSeries(rollingWindows(symDocs.map(toBar)), rollingWindows(benchDocs.map(toBar)));

        const replayStart = t0 - 6 * 3600_000;
        const baseline = ars.filter((w) => w.t < replayStart);
        if (baseline.length < 100) {
            return { available: false, reason: 'insufficient_baseline', symbol: ev.symbol, baselineSamples: baseline.length };
        }
        const sigma = stddev(baseline.map((w) => w.ret));
        const volAvg = baseline.reduce((a, w) => a + w.vol, 0) / baseline.length;
        if (sigma === 0) return { available: false, reason: 'insufficient_baseline', symbol: ev.symbol };

        const replay = ars.filter((w) => w.t >= replayStart && w.t <= t0 + 60 * 60_000);
        const spikes = replay
            .map((w) => ({ t: new Date(w.t).toISOString(), z: w.ret / sigma, retPct: w.ret * 100, rvol: volAvg > 0 ? w.vol / volAvg : 0, ms: w.t }))
            .filter((s) => Math.abs(s.z) >= 2);

        const firstPre = spikes.find((s) => s.ms <= t0);
        const maxZ = replay.length ? Math.max(...replay.map((w) => Math.abs(w.ret / sigma))) : 0;

        return {
            available: true,
            symbol: ev.symbol,
            publishedAt: ev.publishedAt ?? undefined,
            fetchedAt: new Date(ev.fetchedAt).toISOString(),
            firstAbnormalAt: firstPre ? firstPre.t : undefined,
            leadMinutes: firstPre ? Math.round((t0 - firstPre.ms) / 60_000) : undefined,
            maxZ: Number(maxZ.toFixed(1)),
            baselineSamples: baseline.length,
            spikes: spikes.slice(0, 12).map(({ t, z, retPct, rvol }) => ({
                t,
                z: Number(z.toFixed(1)),
                retPct: Number(retPct.toFixed(2)),
                rvol: Number(rvol.toFixed(1)),
            })),
        };
    } catch (error) {
        console.error('Error computing attribution:', error);
        return { available: false, reason: 'error' };
    }
}

async function getBenchmarkSymbol(): Promise<string> {
    try {
        const raw = parseYaml(readFileSync(join(process.cwd(), 'catalyst-monitor', 'config.yaml'), 'utf8')) as any;
        return String(raw?.market?.benchmark ?? 'XBI').toUpperCase();
    } catch {
        return 'XBI';
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
