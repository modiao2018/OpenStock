'use client';

import React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Layers } from 'lucide-react';
import type { FrontierOverview } from '@/lib/actions/frontier.actions';
import { BASKET_WINDOWS } from '@/lib/frontier-math';
import { formatClock } from '@/lib/format-time';
import { Card, directionClass, fmtPct } from './shared';

const TIER_ORDER = ['pure', 'pharma', 'tools'] as const;

/** 主题与篮子：每个主题的解释、标的分层、等权篮子相对 XBI 的表现 */
export default function ThemeBaskets({ overview }: { overview: FrontierOverview }) {
    const t = useTranslations('frontier.baskets');
    const locale = useLocale();
    const themes = overview.themes.filter((x) => x.enabled);

    return (
        <Card
            title={t('title')}
            icon={<Layers className="w-5 h-5 text-teal-500" />}
            hint={
                <>
                    {t('hint', { benchmark: overview.benchmark })}
                    {overview.basketsAt && <span className="ml-1">{t('computedAt', { time: formatClock(overview.basketsAt, locale) })}</span>}
                </>
            }
        >
            <div className="space-y-5">
                {themes.map((theme) => {
                    const b = theme.basket;
                    const ret20 = new Map((b?.members ?? []).map((m) => [m.symbol, m.ret20]));
                    return (
                        <div key={theme.key} className="border-t border-gray-800 pt-4 first:border-0 first:pt-0">
                            <div className="flex flex-wrap items-baseline justify-between gap-3">
                                <h3 className="text-base font-medium text-gray-100">
                                    <Link href={`/frontier?theme=${theme.key}`} className="hover:text-teal-400">{theme.name}</Link>
                                    <span className="text-xs text-gray-500 ml-2">{theme.nameEn}</span>
                                </h3>
                                <div className="flex gap-4 text-xs">
                                    {BASKET_WINDOWS.map((w) => (
                                        <span key={w} className="text-gray-500">
                                            {t('window', { n: w })}{' '}
                                            <span className={`tabular-nums ${directionClass(b?.ret[w], locale)}`}>{fmtPct(b?.ret[w])}</span>
                                            <span className="text-gray-600"> / </span>
                                            <span className={`tabular-nums ${directionClass(b?.excess[w], locale)}`} title={t('excessHint', { benchmark: overview.benchmark })}>
                                                {fmtPct(b?.excess[w])}
                                            </span>
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{theme.description}</p>
                            <div className="mt-2.5 grid grid-cols-1 md:grid-cols-3 gap-2">
                                {TIER_ORDER.map((tier) => {
                                    const list = theme.tickers.filter((k) => k.tier === tier);
                                    if (list.length === 0) return null;
                                    return (
                                        <div key={tier} className="rounded-lg bg-gray-950/50 border border-gray-800/60 p-2">
                                            <div className="text-[11px] text-gray-500 mb-1">{t(`tier.${tier}`)}</div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {list.map((k) => (
                                                    <Link key={k.symbol} href={`/stocks/${k.symbol}`} title={k.company} className="text-xs px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700">
                                                        <span className="text-gray-200">{k.symbol}</span>
                                                        <span className={`ml-1 tabular-nums ${directionClass(ret20.get(k.symbol), locale)}`}>{fmtPct(ret20.get(k.symbol))}</span>
                                                    </Link>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
            <p className="text-xs text-gray-600 mt-4">{t('footnote')}</p>
        </Card>
    );
}
