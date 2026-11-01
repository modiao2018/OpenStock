'use client';

import React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { FrontierThemeData } from '@/lib/actions/frontier.actions';
import { directionClass, fmtPct } from './shared';

/** 主题卡片条：一句话解释 + 本周事件数 + 篮子 20 日相对 XBI；点击按主题筛选事件流 */
export default function ThemeStrip({
    themes,
    benchmark,
    activeTheme,
}: {
    themes: FrontierThemeData[];
    benchmark: string;
    activeTheme: string | null;
}) {
    const t = useTranslations('frontier.themes');
    const locale = useLocale();
    const shown = themes.filter((x) => x.enabled);

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
            {shown.map((theme) => {
                const active = activeTheme === theme.key;
                const excess = theme.basket?.excess[20] ?? null;
                return (
                    <Link
                        key={theme.key}
                        href={active ? '/frontier' : `/frontier?theme=${theme.key}`}
                        title={theme.description}
                        className={`rounded-xl border p-3 transition-colors ${
                            active ? 'border-teal-600 bg-teal-950/40' : 'border-gray-800 bg-gray-900/40 hover:border-gray-700'
                        }`}
                    >
                        <div className="text-sm font-medium text-gray-100 truncate">{locale === 'zh-CN' ? theme.name : theme.nameEn || theme.name}</div>
                        <div className="mt-2 flex items-baseline justify-between gap-2">
                            <span className="text-xs text-gray-500">
                                {t('weekCount', { n: theme.weekCount })}
                                {theme.hotCount > 0 && <span className="text-amber-400"> · {t('hotCount', { n: theme.hotCount })}</span>}
                            </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                            {t('vsBenchmark20', { benchmark })}{' '}
                            <span className={`tabular-nums font-medium ${directionClass(excess, locale)}`}>{fmtPct(excess)}</span>
                        </div>
                    </Link>
                );
            })}
        </div>
    );
}
