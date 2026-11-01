'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BookOpenText } from 'lucide-react';
import type { PapersData } from '@/lib/actions/frontier.actions';
import { formatClock } from '@/lib/format-time';
import { Card } from './shared';

/** 论文：每周 AI 精选（大白话一句话）+ 最近的候选原始列表 */
export default function PaperList({ data }: { data: PapersData }) {
    const t = useTranslations('frontier.papers');
    const locale = useLocale();
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
                <Card title={t('picksTitle')} icon={<BookOpenText className="w-5 h-5 text-teal-500" />} hint={data.week ? t('picksHint', { week: data.week }) : t('picksPending')}>
                    {data.picks.length === 0 ? (
                        <p className="text-sm text-gray-500">{t('noPicks')}</p>
                    ) : (
                        <ol className="space-y-3 list-decimal list-inside">
                            {data.picks.map((p, i) => (
                                <li key={i} className="text-sm">
                                    <span className="text-gray-100">{p.zh}</span>
                                    <p className="text-xs text-gray-500 mt-0.5 ml-5">
                                        {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="hover:text-teal-400">{p.title}</a> : p.title}
                                        <span className="text-gray-600"> · {p.feed}</span>
                                    </p>
                                </li>
                            ))}
                        </ol>
                    )}
                </Card>
            </div>
            <Card title={t('recentTitle')} hint={t('recentHint')}>
                <ul className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                    {data.recent.map((p) => (
                        <li key={p.id} className="text-xs">
                            {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-teal-400">{p.title}</a> : <span className="text-gray-300">{p.title}</span>}
                            <p className="text-gray-600">{p.feed} · {formatClock(p.fetchedAt, locale)}</p>
                        </li>
                    ))}
                    {data.recent.length === 0 && <li className="text-sm text-gray-500">{t('noRecent')}</li>}
                </ul>
            </Card>
        </div>
    );
}
