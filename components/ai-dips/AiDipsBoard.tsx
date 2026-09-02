'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, TriangleAlert } from 'lucide-react';
import { getAiDipsData, type AiDipsPayload } from '@/lib/actions/ai-dips.actions';
import { getInsiderOverview, type InsiderRowData } from '@/lib/actions/insider.actions';
import { AI_SUB_SECTORS, type AiSubSector } from '@/lib/ai-dips-catalog';
import AiDipsTable from '@/components/ai-dips/AiDipsTable';

const STREAK_FILTERS = [0, 3, 5, 7, 10] as const;

interface AiDipsBoardProps {
    initialData: AiDipsPayload | null;
}

const AiDipsBoard = ({ initialData }: AiDipsBoardProps) => {
    const t = useTranslations('aiDips');
    const locale = useLocale();

    const [data, setData] = useState<AiDipsPayload | null>(initialData);
    const [insider, setInsider] = useState<Record<string, InsiderRowData>>({});
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
    // fetch on mount and refresh every 10 minutes, outside the 60s quote poll
    useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            if (document.hidden) return;
            const overview = await getInsiderOverview();
            if (!cancelled) setInsider(overview);
        };
        refresh();
        const id = setInterval(refresh, 600_000);
        return () => {
            cancelled = true;
            clearInterval(id);
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
                            time: new Date(data.updatedAt).toLocaleTimeString(locale, {
                                hour: '2-digit', minute: '2-digit',
                            }),
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
                <AiDipsTable rows={tableRows} showStreakColumns={data.configured} insiderBySymbol={insider} />
            )}

            <p className="text-xs text-gray-600">{t('dataNote')}</p>
        </div>
    );
};

export default AiDipsBoard;
