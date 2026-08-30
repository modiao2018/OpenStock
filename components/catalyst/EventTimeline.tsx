'use client';

import React, { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { History } from 'lucide-react';
import { isRedUpLocale } from '@/lib/utils';
import type { CatalystEventData } from '@/lib/actions/catalyst.actions';
import AttributionButton from './AttributionButton';

const SOURCE_BADGES: Record<string, string> = {
    clinicaltrials: 'bg-blue-900/60 text-blue-300',
    edgar: 'bg-purple-900/60 text-purple-300',
    halts: 'bg-red-900/60 text-red-300',
    rss: 'bg-gray-800 text-gray-300',
    market: 'bg-amber-900/60 text-amber-300',
};

const SOURCES = ['market', 'halts', 'edgar', 'rss', 'clinicaltrials'];

// 与 catalyst-monitor/src/analyze.ts 的 ACTION_WORDS 保持一致
const ACTION_RE = /操作建议[：:]\s*(买入|加仓|持有|减仓|卖出|观望)/;
const BUY_ACTIONS = new Set(['买入', '加仓']);
const SELL_ACTIONS = new Set(['卖出', '减仓']);

function actionBadgeClass(action: string, redUp: boolean): string {
    if (BUY_ACTIONS.has(action)) return redUp ? 'bg-red-900/60 text-red-300' : 'bg-green-900/60 text-green-300';
    if (SELL_ACTIONS.has(action)) return redUp ? 'bg-green-900/60 text-green-300' : 'bg-red-900/60 text-red-300';
    return 'bg-gray-800 text-gray-300';
}

function beijingClock(iso: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return iso;
    const d = new Date(t + 8 * 3600_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function beijingDay(iso: string, locale: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return iso;
    const d = new Date(t + 8 * 3600_000);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toLocaleDateString(locale, {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
        timeZone: 'UTC',
    });
}

/** 事件流：按北京日期分组的信息瀑布，来源可筛选；建档快照默认折叠减噪 */
export default function EventTimeline({ events }: { events: CatalystEventData[] }) {
    const t = useTranslations('catalyst.timeline');
    const locale = useLocale();
    const redUp = isRedUpLocale(locale);

    const [sourceFilter, setSourceFilter] = useState<string | null>(null);
    const [showArchived, setShowArchived] = useState(false);

    const groups = useMemo(() => {
        const filtered = events.filter(
            (ev) => (sourceFilter === null || ev.source === sourceFilter) && (showArchived || !ev.firstSnapshot)
        );
        const byDay = new Map<string, CatalystEventData[]>();
        for (const ev of filtered) {
            const day = beijingDay(ev.fetchedAt, locale);
            if (!byDay.has(day)) byDay.set(day, []);
            byDay.get(day)!.push(ev);
        }
        return [...byDay.entries()];
    }, [events, sourceFilter, showArchived, locale]);

    const hiddenCount = events.filter((ev) => ev.firstSnapshot).length;

    return (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-1">
                <History className="w-5 h-5 text-teal-500" />
                {t('title')}
            </h2>
            <p className="text-xs text-gray-600 mb-3">{t('hint')}</p>

            {/* 筛选行 */}
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
                <button
                    type="button"
                    onClick={() => setSourceFilter(null)}
                    className={`text-xs px-2.5 py-1 rounded-full border ${
                        sourceFilter === null ? 'border-teal-600 bg-teal-950/60 text-teal-300' : 'border-gray-800 text-gray-500 hover:text-gray-300'
                    }`}
                >
                    {t('filterAll')}
                </button>
                {SOURCES.map((s) => (
                    <button
                        key={s}
                        type="button"
                        onClick={() => setSourceFilter(sourceFilter === s ? null : s)}
                        className={`text-xs px-2.5 py-1 rounded-full border ${
                            sourceFilter === s ? 'border-teal-600 bg-teal-950/60 text-teal-300' : 'border-gray-800 text-gray-500 hover:text-gray-300'
                        }`}
                    >
                        {t(`source.${s}`)}
                    </button>
                ))}
                {hiddenCount > 0 && (
                    <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-teal-500" />
                        {t('showArchived', { count: hiddenCount })}
                    </label>
                )}
            </div>

            {groups.length === 0 ? (
                <p className="text-gray-500 text-sm">{t('empty')}</p>
            ) : (
                <div className="space-y-5">
                    {groups.map(([day, dayEvents]) => (
                        <div key={day}>
                            <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2.5">{day}</h3>
                            <ul className="space-y-3">
                                {dayEvents.map((ev) => (
                                    <li key={ev.id} className="flex items-start gap-3">
                                        <span className="shrink-0 w-11 text-right text-xs text-gray-600 tabular-nums mt-0.5">
                                            {beijingClock(ev.fetchedAt)}
                                        </span>
                                        <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded text-xs ${SOURCE_BADGES[ev.source] ?? 'bg-gray-800 text-gray-300'}`}>
                                            {t(`source.${ev.source}`)}
                                        </span>
                                        {ev.source === 'clinicaltrials' && (
                                            <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded text-xs ${ev.firstSnapshot ? 'bg-gray-800/80 text-gray-500' : 'bg-amber-900/50 text-amber-300'}`}>
                                                {ev.firstSnapshot ? t('archived') : t('updated')}
                                            </span>
                                        )}
                                        {ev.source === 'edgar' && ev.firstSnapshot && (
                                            <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded text-xs bg-gray-800/80 text-gray-500">
                                                {t('archived')}
                                            </span>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                {ev.severity === 'urgent' && !ev.firstSnapshot && <span className="text-red-400 text-xs">●</span>}
                                                {ev.url ? (
                                                    <a href={ev.url} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-200 hover:text-teal-400 truncate">
                                                        {ev.title}
                                                    </a>
                                                ) : (
                                                    <span className="text-sm text-gray-200 truncate">{ev.title}</span>
                                                )}
                                            </div>
                                            {ev.analysis && (
                                                <p className="text-xs text-teal-300/80 mt-1 leading-relaxed">
                                                    {(() => {
                                                        const action = ev.analysis.match(ACTION_RE)?.[1];
                                                        return action ? (
                                                            <span className={`inline-block px-1.5 py-0.5 rounded mr-1.5 font-medium ${actionBadgeClass(action, redUp)}`}>
                                                                {action}
                                                            </span>
                                                        ) : null;
                                                    })()}
                                                    🤖 {t('analysis')}: {ev.analysis}
                                                </p>
                                            )}
                                            <div className="text-xs text-gray-600 mt-0.5 flex items-center gap-3">
                                                {ev.publishedAt && (
                                                    <span>
                                                        {t('publishedAt')}: {ev.publishedAt}
                                                    </span>
                                                )}
                                                {ev.symbol && <AttributionButton eventId={ev.id} />}
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
