'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { getChangeColorClass, isRedUpLocale } from '@/lib/utils';
import type { AiDipStock } from '@/lib/actions/ai-dips.actions';

// Same poles as the heatmap ramps
const RED = '#f23645';
const GREEN = '#089981';

type SortKey = 'price' | 'todayChangePct' | 'streakDays' | 'streakDeclinePct' | 'drawdownFromHighPct';

interface AiDipsTableProps {
    rows: AiDipStock[];
    // False when Alpaca isn't configured — streak columns show placeholders
    showStreakColumns: boolean;
}

const formatPct = (value: number | null) =>
    value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

function Sparkline({ closes, locale }: { closes: number[]; locale: string }) {
    if (closes.length < 2) return <span className="text-gray-700">—</span>;
    const w = 90, h = 28, pad = 2;
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;
    const points = closes
        .map((c, i) => {
            const x = pad + (i / (closes.length - 1)) * (w - pad * 2);
            const y = pad + (1 - (c - min) / span) * (h - pad * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
    const falling = closes[closes.length - 1] < closes[0];
    const stroke = falling === isRedUpLocale(locale) ? GREEN : RED;
    return (
        <svg width={w} height={h} aria-hidden="true">
            <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} />
        </svg>
    );
}

const AiDipsTable = ({ rows, showStreakColumns }: AiDipsTableProps) => {
    const t = useTranslations('aiDips');
    const locale = useLocale();
    const router = useRouter();
    const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

    const sorted = useMemo(() => {
        if (!sort) return rows;
        const { key, dir } = sort;
        return [...rows].sort((a, b) => {
            const av = a[key];
            const bv = b[key];
            // Rows without data always sink to the bottom
            if (av === null && bv === null) return 0;
            if (av === null) return 1;
            if (bv === null) return -1;
            return (av - bv) * dir;
        });
    }, [rows, sort]);

    const toggleSort = (key: SortKey) => {
        setSort((current) =>
            current?.key === key
                ? current.dir === 1 ? { key, dir: -1 } : null
                : { key, dir: 1 },
        );
    };

    const sortableHeader = (key: SortKey, label: string, extraClass = '') => (
        <th className={`px-4 py-3 text-right font-medium ${extraClass}`}>
            <button
                type="button"
                className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-200 transition-colors cursor-pointer"
                onClick={() => toggleSort(key)}
            >
                {label}
                {sort?.key === key && (sort.dir === 1
                    ? <ArrowUp className="h-3 w-3" />
                    : <ArrowDown className="h-3 w-3" />)}
            </button>
        </th>
    );

    const streakPill = (row: AiDipStock) => {
        if (!row.barsOk) return <span className="text-gray-600">—</span>;
        if (row.streakDays === 0) return <span className="text-gray-600">{t('noStreak')}</span>;
        const label = row.streakCapped
            ? t('streakDaysCapped', { n: row.streakDays })
            : t('streakDaysValue', { n: row.streakDays });
        return (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/10 px-2.5 py-0.5 text-xs font-medium text-teal-400">
                {label}
                {row.provisionalToday && (
                    <span className="flex items-center gap-1" title={t('provisionalToday')}>
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        <span className="text-amber-400">{t('provisionalToday')}</span>
                    </span>
                )}
            </span>
        );
    };

    return (
        <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-950/40">
            <table className="w-full min-w-[640px] text-sm">
                <thead>
                    <tr className="border-b border-gray-800 text-xs text-gray-500">
                        <th className="px-4 py-3 text-left font-medium">{t('columns.symbol')}</th>
                        <th className="hidden px-4 py-3 text-left font-medium md:table-cell">{t('columns.trend')}</th>
                        {sortableHeader('price', t('columns.price'))}
                        {sortableHeader('todayChangePct', t('columns.todayChange'))}
                        {sortableHeader('streakDays', t('columns.streak'))}
                        {sortableHeader('streakDeclinePct', t('columns.streakDecline'))}
                        {sortableHeader('drawdownFromHighPct', t('columns.drawdown'), 'hidden md:table-cell')}
                    </tr>
                </thead>
                <tbody>
                    {sorted.map((row) => (
                        <tr
                            key={row.symbol}
                            className={`cursor-pointer border-b border-gray-800/60 transition-colors last:border-0 hover:bg-gray-900/60 ${
                                row.streakDays >= 3 ? 'border-l-2 border-l-teal-500/70' : 'border-l-2 border-l-transparent'
                            }`}
                            onClick={() => router.push(`/stocks/${row.symbol}`)}
                        >
                            <td className="px-4 py-3">
                                <div className="flex flex-col">
                                    <span className="font-semibold text-gray-100">{row.symbol}</span>
                                    <span className="flex items-center gap-1.5 text-xs text-gray-500">
                                        <span className="truncate">{row.name}</span>
                                        <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
                                            {t(`subSectors.${row.subSector}`)}
                                        </span>
                                    </span>
                                </div>
                            </td>
                            <td className="hidden px-4 py-2 md:table-cell">
                                <Sparkline closes={row.closes} locale={locale} />
                            </td>
                            <td className="px-4 py-3 text-right text-gray-200">
                                {row.price > 0 ? `$${row.price.toFixed(2)}` : '—'}
                            </td>
                            <td className={`px-4 py-3 text-right ${getChangeColorClass(row.todayChangePct, locale)}`}>
                                {row.price > 0 ? formatPct(row.todayChangePct) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right">
                                {showStreakColumns ? streakPill(row) : <span className="text-gray-600">—</span>}
                            </td>
                            <td className={`px-4 py-3 text-right ${getChangeColorClass(row.streakDeclinePct ?? 0, locale)}`}>
                                {showStreakColumns && row.barsOk ? formatPct(row.streakDeclinePct) : '—'}
                            </td>
                            <td className={`hidden px-4 py-3 text-right md:table-cell ${getChangeColorClass(row.drawdownFromHighPct ?? 0, locale)}`}>
                                {showStreakColumns && row.barsOk ? formatPct(row.drawdownFromHighPct) : '—'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default AiDipsTable;
