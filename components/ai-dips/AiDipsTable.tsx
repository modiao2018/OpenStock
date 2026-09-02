'use client';

import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { getChangeColorClass, isRedUpLocale } from '@/lib/utils';
import { formatUsdCompact } from '@/lib/insider-math';
import type { AiDipStock } from '@/lib/actions/ai-dips.actions';
import type { InsiderRowData } from '@/lib/actions/insider.actions';

// Same poles as the heatmap ramps
const RED = '#f23645';
const GREEN = '#089981';

type SortKey = 'price' | 'todayChangePct' | 'streakDays' | 'streakDeclinePct' | 'drawdownFromHighPct';

interface AiDipsTableProps {
    rows: AiDipStock[];
    // False when Alpaca isn't configured — streak columns show placeholders
    showStreakColumns: boolean;
    // 90-day insider activity keyed by symbol; empty until the monitor's
    // insider collector has populated the database
    insiderBySymbol: Record<string, InsiderRowData>;
    // Symbols the insider collector hasn't visited yet (freshly added to the
    // pool) — shown as "awaiting collection" instead of a bare dash
    pendingInsider: Set<string>;
}

const COLUMN_COUNT = 8;

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

const AiDipsTable = ({ rows, showStreakColumns, insiderBySymbol, pendingInsider }: AiDipsTableProps) => {
    const t = useTranslations('aiDips');
    const locale = useLocale();
    const router = useRouter();
    const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);

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

    // Net-direction badge; a button when there's something to expand
    const insiderBadge = (symbol: string) => {
        const info = insiderBySymbol[symbol];
        const total = info ? info.summary.buyCount + info.summary.sellCount : 0;
        if (!info || (total === 0 && !info.insight)) {
            if (pendingInsider.has(symbol)) {
                return (
                    <span
                        className="inline-flex items-center gap-1 rounded-full bg-gray-800/60 px-2.5 py-0.5 text-xs text-gray-400"
                        title={t('insider.pendingHint')}
                    >
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                        {t('insider.pending')}
                    </span>
                );
            }
            return <span className="text-gray-600">—</span>;
        }
        const { summary } = info;
        const isOpen = expanded === symbol;
        const netBuy = summary.netUsd >= 0;
        // All prices unknown — a dollar figure would read as $0, show counts
        const amountsKnown = summary.buyUsd > 0 || summary.sellUsd > 0;
        const label = total === 0
            ? t('insider.none')
            : amountsKnown
                ? t(netBuy ? 'insider.netBuy' : 'insider.netSell', {
                    amount: formatUsdCompact(Math.abs(summary.netUsd)), n: total,
                })
                : t('insider.countOnly', { buy: summary.buyCount, sell: summary.sellCount });
        const tone = total === 0
            ? 'bg-gray-800/60 text-gray-400'
            : netBuy
                ? 'bg-teal-500/10 text-teal-400'
                : 'bg-rose-500/10 text-rose-400';
        return (
            <button
                type="button"
                className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors hover:brightness-125 ${tone}`}
                onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(isOpen ? null : symbol);
                }}
            >
                {label}
                {info.insight && <Sparkles className="h-3 w-3 text-amber-400" />}
                {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
        );
    };

    const insiderDetail = (symbol: string) => {
        const info = insiderBySymbol[symbol];
        if (!info) return null;
        return (
            <tr className="border-b border-gray-800/60 bg-gray-900/40">
                <td colSpan={COLUMN_COUNT} className="px-4 py-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                        <div className="min-w-0 flex-1 overflow-x-auto">
                            {info.trades.length === 0 ? (
                                <p className="text-sm text-gray-500">{t('insider.none')}</p>
                            ) : (
                                <table className="w-full min-w-[480px] text-xs">
                                    <thead>
                                        <tr className="text-left text-gray-500">
                                            <th className="py-1.5 pr-3 font-medium">{t('insider.detail.name')}</th>
                                            <th className="py-1.5 pr-3 font-medium">{t('insider.detail.date')}</th>
                                            <th className="py-1.5 pr-3 font-medium">{t('insider.detail.side')}</th>
                                            <th className="py-1.5 pr-3 text-right font-medium">{t('insider.detail.shares')}</th>
                                            <th className="py-1.5 pr-3 text-right font-medium">{t('insider.detail.price')}</th>
                                            <th className="py-1.5 text-right font-medium">{t('insider.detail.amount')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {info.trades.map((trade, i) => (
                                            <tr key={i} className="border-t border-gray-800/60 text-gray-300">
                                                <td className="max-w-[180px] truncate py-1.5 pr-3" title={trade.name}>{trade.name}</td>
                                                <td className="py-1.5 pr-3 text-gray-500">{trade.transactionDate}</td>
                                                <td className={`py-1.5 pr-3 font-medium ${trade.transactionCode === 'P' ? 'text-teal-400' : 'text-rose-400'}`}>
                                                    {t(trade.transactionCode === 'P' ? 'insider.buy' : 'insider.sell')}
                                                </td>
                                                <td className="py-1.5 pr-3 text-right">{Math.abs(trade.change).toLocaleString(locale)}</td>
                                                <td className="py-1.5 pr-3 text-right">
                                                    {trade.transactionPrice > 0 ? `$${trade.transactionPrice.toFixed(2)}` : '—'}
                                                </td>
                                                <td className="py-1.5 text-right">
                                                    {trade.amountUsd !== null ? formatUsdCompact(trade.amountUsd) : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                            <p className="mt-2 text-[11px] text-gray-600">{t('insider.note')}</p>
                        </div>
                        <div className="w-full shrink-0 rounded-lg border border-gray-800 bg-gray-950/60 p-3 lg:w-80">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
                                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                                {t('insider.aiInsight')}
                                {info.insight?.action && (
                                    <span className="rounded-full bg-teal-500/10 px-2 py-0.5 text-teal-400">
                                        {info.insight.action}
                                    </span>
                                )}
                            </div>
                            {info.insight ? (
                                <>
                                    <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-gray-300">
                                        {info.insight.analysis}
                                    </p>
                                    <p className="mt-2 text-[11px] text-gray-600">
                                        {t('insider.insightAt', {
                                            time: new Date(info.insight.updatedAt).toLocaleString(locale, {
                                                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                                            }),
                                        })}
                                    </p>
                                </>
                            ) : (
                                <p className="mt-2 text-xs text-gray-600">{t('insider.noInsight')}</p>
                            )}
                        </div>
                    </div>
                </td>
            </tr>
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
                        <th className="px-4 py-3 text-right font-medium">{t('columns.insider')}</th>
                    </tr>
                </thead>
                <tbody>
                    {sorted.map((row) => (
                        <Fragment key={row.symbol}>
                            <tr
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
                                <td className="whitespace-nowrap px-4 py-3 text-right">
                                    {insiderBadge(row.symbol)}
                                </td>
                            </tr>
                            {expanded === row.symbol && insiderDetail(row.symbol)}
                        </Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default AiDipsTable;
