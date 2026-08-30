'use server';

import { connectToDatabase } from '@/database/mongoose';
import {
    CatalystEvent,
    CatalystTrial,
    CatalystWatchItem,
} from '@/database/models/catalyst.model';
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
