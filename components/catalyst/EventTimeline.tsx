import React from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { History } from 'lucide-react';
import { isRedUpLocale } from '@/lib/utils';
import type { CatalystEventData } from '@/lib/actions/catalyst.actions';
import AttributionButton from './AttributionButton';

// 与 catalyst-monitor/src/analyze.ts 的 ACTION_WORDS 保持一致
const ACTION_RE = /操作建议[：:]\s*(买入|加仓|持有|减仓|卖出|观望)/;
const BUY_ACTIONS = new Set(['买入', '加仓']);
const SELL_ACTIONS = new Set(['卖出', '减仓']);

function actionBadgeClass(action: string, redUp: boolean): string {
    if (BUY_ACTIONS.has(action)) return redUp ? 'bg-red-900/60 text-red-300' : 'bg-green-900/60 text-green-300';
    if (SELL_ACTIONS.has(action)) return redUp ? 'bg-green-900/60 text-green-300' : 'bg-red-900/60 text-red-300';
    return 'bg-gray-800 text-gray-300';
}

const SOURCE_BADGES: Record<string, string> = {
    clinicaltrials: 'bg-blue-900/60 text-blue-300',
    edgar: 'bg-purple-900/60 text-purple-300',
    halts: 'bg-red-900/60 text-red-300',
    rss: 'bg-gray-800 text-gray-300',
    market: 'bg-amber-900/60 text-amber-300',
};

function formatTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function EventTimeline({ events }: { events: CatalystEventData[] }) {
    const t = await getTranslations('catalyst.timeline');
    const redUp = isRedUpLocale(await getLocale());

    return (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-1">
                <History className="w-5 h-5 text-teal-500" />
                {t('title')}
            </h2>
            <p className="text-xs text-gray-600 mb-4">{t('hint')}</p>

            {events.length === 0 ? (
                <p className="text-gray-500 text-sm">{t('empty')}</p>
            ) : (
                <ul className="space-y-3">
                    {events.map((ev) => (
                        <li key={ev.id} className="flex items-start gap-3 border-b border-gray-800 pb-3 last:border-0 last:pb-0">
                            <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded text-xs ${SOURCE_BADGES[ev.source] ?? 'bg-gray-800 text-gray-300'}`}>
                                {t(`source.${ev.source}`)}
                            </span>
                            {ev.source === 'clinicaltrials' && (
                                <span
                                    className={`shrink-0 mt-0.5 px-2 py-0.5 rounded text-xs ${
                                        ev.firstSnapshot ? 'bg-gray-800/80 text-gray-500' : 'bg-amber-900/50 text-amber-300'
                                    }`}
                                >
                                    {ev.firstSnapshot ? t('archived') : t('updated')}
                                </span>
                            )}
                            {ev.source === 'edgar' && ev.firstSnapshot && (
                                <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded text-xs bg-gray-800/80 text-gray-500">
                                    {t('archived')}
                                </span>
                            )}
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    {ev.severity === 'urgent' && <span className="text-red-400 text-xs">●</span>}
                                    {ev.url ? (
                                        <a
                                            href={ev.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm text-gray-200 hover:text-teal-400 truncate"
                                        >
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
                                    <span>
                                        {t('fetchedAt')}: {formatTime(ev.fetchedAt)}
                                    </span>
                                    {ev.symbol && <AttributionButton eventId={ev.id} />}
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
