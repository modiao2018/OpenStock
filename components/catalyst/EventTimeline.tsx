import React from 'react';
import { getTranslations } from 'next-intl/server';
import { History } from 'lucide-react';
import type { CatalystEventData } from '@/lib/actions/catalyst.actions';

const SOURCE_BADGES: Record<string, string> = {
    clinicaltrials: 'bg-blue-900/60 text-blue-300',
    edgar: 'bg-purple-900/60 text-purple-300',
    halts: 'bg-red-900/60 text-red-300',
    rss: 'bg-gray-800 text-gray-300',
};

function formatTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function EventTimeline({ events }: { events: CatalystEventData[] }) {
    const t = await getTranslations('catalyst.timeline');

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
                    {events.map((ev, i) => (
                        <li key={i} className="flex items-start gap-3 border-b border-gray-800 pb-3 last:border-0 last:pb-0">
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
                                        🤖 {t('analysis')}: {ev.analysis}
                                    </p>
                                )}
                                <div className="text-xs text-gray-600 mt-0.5">
                                    {ev.publishedAt && (
                                        <span className="mr-3">
                                            {t('publishedAt')}: {ev.publishedAt}
                                        </span>
                                    )}
                                    <span>
                                        {t('fetchedAt')}: {formatTime(ev.fetchedAt)}
                                    </span>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
