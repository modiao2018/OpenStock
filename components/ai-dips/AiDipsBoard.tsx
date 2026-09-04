'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, TriangleAlert } from 'lucide-react';
import { getAiDipsData, type AiDipsPayload } from '@/lib/actions/ai-dips.actions';
import {
    getAiDipsHealth,
    getInsiderOverview,
    type AiDipsHealth,
    type InsiderRowData,
} from '@/lib/actions/insider.actions';
import { AI_SUB_SECTORS, type AiSubSector } from '@/lib/ai-dips-catalog';
import AiDipsTable from '@/components/ai-dips/AiDipsTable';
import { formatTimeOfDay } from '@/lib/format-time';

const STREAK_FILTERS = [0, 3, 5, 7, 10] as const;

interface AiDipsBoardProps {
    initialData: AiDipsPayload | null;
}

const AiDipsBoard = ({ initialData }: AiDipsBoardProps) => {
    const t = useTranslations('aiDips');
    const locale = useLocale();

    const [data, setData] = useState<AiDipsPayload | null>(initialData);
    const [insider, setInsider] = useState<Record<string, InsiderRowData>>({});
    const [health, setHealth] = useState<AiDipsHealth | null>(null);
    const [minStreak, setMinStreak] = useState<number>(0);
    const [subSector, setSubSector] = useState<AiSubSector | null>(null);

    // Refetch on mount (the SSR snapshot can be stale), then poll every minute
    // while the tab is visible — same pattern as HeatmapSection
    useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            if (document.hidden) return;
            const payload = await getAiDipsData();
            if (!cancelled) setData(payload);
        };
        refresh();
        const id = setInterval(refresh, 60_000);
        const onVisible = () => { if (!document.hidden) refresh(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            cancelled = true;
            clearInterval(id);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    // Insider trades change on filing cadence (hours), not quote cadence —
    // fetch on mount and refresh every 10 minutes, outside the 60s quote poll.
    // Collector health rides the same slow cycle. A pool edit (AiDipsManager
    // dispatches 'aidips-pool-changed') refreshes immediately and again ~30s
    // later, when the background insider seeding for new symbols has landed.
    useEffect(() => {
        let cancelled = false;
        let seedTimer: ReturnType<typeof setTimeout> | undefined;
        const refresh = async () => {
            if (document.hidden) return;
            const [overview, h] = await Promise.all([getInsiderOverview(), getAiDipsHealth()]);
            if (!cancelled) {
                setInsider(overview);
                setHealth(h);
            }
        };
        const onPoolChanged = () => {
            refresh();
            clearTimeout(seedTimer);
            seedTimer = setTimeout(refresh, 30_000);
        };
        refresh();
        const id = setInterval(refresh, 600_000);
        window.addEventListener('aidips-pool-changed', onPoolChanged);
        return () => {
            cancelled = true;
            clearInterval(id);
            clearTimeout(seedTimer);
            window.removeEventListener('aidips-pool-changed', onPoolChanged);
        };
    }, []);

    const rows = useMemo(() => {
        const all = data?.rows ?? [];
        return subSector ? all.filter((r) => r.subSector === subSector) : all;
    }, [data, subSector]);

    const filteredRows = useMemo(
        () => (minStreak > 0 ? rows.filter((r) => r.streakDays >= minStreak) : rows),
        [rows, minStreak],
    );

    // Surface data-source trouble instead of silently showing stale "—" cells:
    // web-side fetch failures ride the payload, collector trouble rides the
    // daemon heartbeat (staleness thresholds = 2+ missed rounds)
    const healthIssues = useMemo(() => {
        const issues: string[] = [];
        if (data?.barsError) issues.push(t('health.barsError'));
        if (data?.quotesError) issues.push(t('health.quotesError'));
        if (health) {
            const now = Date.now();
            if (health.insiderErrorCount >= 3) {
                issues.push(t('health.insiderFailing', { error: health.insiderLastError ?? '' }));
            } else if (health.insiderLastRun === null) {
                issues.push(t('health.insiderNever'));
            } else if (now - health.insiderLastRun > 4 * 3600_000) {
                issues.push(t('health.insiderStale', { hours: Math.round((now - health.insiderLastRun) / 3600_000) }));
            }
            if (health.aidipsErrorCount >= 3) {
                issues.push(t('health.aidipsFailing'));
            } else if (health.aidipsLastRun !== null && now - health.aidipsLastRun > 3 * 3600_000) {
                issues.push(t('health.aidipsStale', { hours: Math.round((now - health.aidipsLastRun) / 3600_000) }));
            }
        }
        return issues;
    }, [data, health, t]);

    // Pool entries no collection has visited yet — render "待采集" instead of
    // a misleading "—". A symbol stops being pending once it has data, once
    // the immediate web-side seeding marked it (even with zero trades), or
    // once a daemon round completed after it entered the pool.
    const pendingInsider = useMemo(() => {
        const pending = new Set<string>();
        if (!health) return pending;
        const seeded = new Set(health.seededSymbols);
        for (const [sym, added] of Object.entries(health.poolAddedAt)) {
            if (insider[sym] || seeded.has(sym)) continue;
            if (health.insiderLastRun === null || added > health.insiderLastRun) {
                pending.add(sym);
            }
        }
        return pending;
    }, [health, insider]);

    const chipClass = (active: boolean) =>
        `rounded-full border px-3 py-1 text-xs transition-colors cursor-pointer ${
            active
                ? 'border-teal-500 bg-teal-500/10 text-teal-400'
                : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
        }`;

    if (!data) {
        return (
            <div className="flex items-center justify-center rounded-xl border border-gray-800 bg-gray-950/40" style={{ height: 480 }}>
                <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
            </div>
        );
    }

    // Filter yielded nothing: say so, then still list the full pool so the
    // page never goes blank and "what's closest to a streak" stays answered
    const emptyFiltered = minStreak > 0 && filteredRows.length === 0;
    const tableRows = emptyFiltered ? rows : filteredRows;

    return (
        <div className="space-y-4">
            {!data.configured && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-700/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    {t('notConfigured')}
                </div>
            )}

            {healthIssues.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-700/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="space-y-0.5">
                        {healthIssues.map((msg) => <p key={msg}>{msg}</p>)}
                    </div>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                {STREAK_FILTERS.map((n) => (
                    <button
                        key={n}
                        type="button"
                        className={chipClass(minStreak === n)}
                        onClick={() => setMinStreak(n)}
                    >
                        {n === 0 ? t('filters.all') : t('filters.minDays', { n })}
                    </button>
                ))}
                <span className="mx-1 h-4 w-px bg-gray-800" />
                <button
                    type="button"
                    className={chipClass(subSector === null)}
                    onClick={() => setSubSector(null)}
                >
                    {t('filters.all')}
                </button>
                {AI_SUB_SECTORS.map((key) => (
                    <button
                        key={key}
                        type="button"
                        className={chipClass(subSector === key)}
                        onClick={() => setSubSector(subSector === key ? null : key)}
                    >
                        {t(`subSectors.${key}`)}
                    </button>
                ))}
                {data.updatedAt > 0 && (
                    <span className="ml-auto text-xs text-gray-600">
                        {t('updatedAt', {
                            time: formatTimeOfDay(data.updatedAt, locale),
                        })}
                    </span>
                )}
            </div>

            {emptyFiltered && (
                <p className="rounded-lg border border-gray-800 bg-gray-950/40 px-4 py-3 text-sm text-gray-400">
                    {t('emptyFiltered', { n: minStreak })}
                </p>
            )}

            {tableRows.length === 0 ? (
                <div className="flex items-center justify-center rounded-xl border border-gray-800 bg-gray-950/40 text-gray-500" style={{ height: 320 }}>
                    {t('noData')}
                </div>
            ) : (
                <AiDipsTable
                    rows={tableRows}
                    showStreakColumns={data.configured}
                    insiderBySymbol={insider}
                    pendingInsider={pendingInsider}
                />
            )}

            <p className="text-xs text-gray-600">{t('dataNote')}</p>
        </div>
    );
};

export default AiDipsBoard;
