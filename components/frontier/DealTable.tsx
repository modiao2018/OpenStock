'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Handshake } from 'lucide-react';
import type { DealData } from '@/lib/actions/frontier.actions';
import { formatUsd } from '@/lib/frontier-math';
import { Card } from './shared';

function Party({ name, symbol }: { name: string; symbol: string | null }) {
    if (!name) return <span className="text-gray-600">—</span>;
    return (
        <span>
            {name}
            {symbol && (
                <Link href={`/stocks/${symbol}`} className="ml-1 text-xs text-teal-400 hover:text-teal-300">
                    {symbol}
                </Link>
            )}
        </span>
    );
}

function Amount({ a, unverified }: { a: DealData['upfront']; unverified: string }) {
    if (!a) return <span className="text-gray-600">—</span>;
    return (
        <span title={a.text} className="tabular-nums">
            {a.usd ? formatUsd(a.usd) : a.text}
            {!a.verified && <span className="ml-1 text-[10px] text-amber-400">{unverified}</span>}
        </span>
    );
}

/** 交易追踪：授权 / 合作 / 并购，金额只认原文里出现过的写法 */
export default function DealTable({ deals, themeNames }: { deals: DealData[]; themeNames: Record<string, string> }) {
    const t = useTranslations('frontier.deals');
    const locale = useLocale();
    const [theme, setTheme] = useState<string | null>(null);

    const shown = useMemo(() => deals.filter((d) => theme === null || d.themes.includes(theme)), [deals, theme]);
    const totals = useMemo(() => {
        const sum = (f: (d: DealData) => number | null | undefined) => shown.reduce((s, d) => s + (f(d) ?? 0), 0);
        return {
            n: shown.length,
            upfront: sum((d) => (d.upfront?.verified ? d.upfront.usd : 0)),
            total: sum((d) => (d.total?.verified ? d.total.usd : 0)),
        };
    }, [shown]);
    const themesPresent = [...new Set(deals.flatMap((d) => d.themes))];

    return (
        <Card title={t('title')} icon={<Handshake className="w-5 h-5 text-teal-500" />} hint={t('hint')}>
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
                <button type="button" onClick={() => setTheme(null)} className={`text-xs px-2.5 py-1 rounded-full border ${theme === null ? 'border-teal-600 text-teal-300' : 'border-gray-800 text-gray-500'}`}>
                    {t('allThemes')}
                </button>
                {themesPresent.map((k) => (
                    <button key={k} type="button" onClick={() => setTheme(theme === k ? null : k)} className={`text-xs px-2.5 py-1 rounded-full border ${theme === k ? 'border-teal-600 text-teal-300' : 'border-gray-800 text-gray-500'}`}>
                        {themeNames[k] ?? k}
                    </button>
                ))}
                <span className="ml-auto text-xs text-gray-500">{t('totals', { n: totals.n, upfront: totals.upfront ? formatUsd(totals.upfront) : '—', total: totals.total ? formatUsd(totals.total) : '—' })}</span>
            </div>
            {shown.length === 0 ? (
                <p className="text-sm text-gray-500">{t('empty')}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                                <th className="pb-2 pr-3 font-normal">{t('col.date')}</th>
                                <th className="pb-2 pr-3 font-normal">{t('col.type')}</th>
                                <th className="pb-2 pr-3 font-normal">{t('col.buyer')}</th>
                                <th className="pb-2 pr-3 font-normal">{t('col.seller')}</th>
                                <th className="pb-2 pr-3 font-normal">{t('col.asset')}</th>
                                <th className="pb-2 pr-3 font-normal text-right">{t('col.upfront')}</th>
                                <th className="pb-2 font-normal text-right">{t('col.total')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shown.map((d) => (
                                <tr key={d.id} className="border-b border-gray-800/60 align-top">
                                    <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
                                        {d.url ? (
                                            <a href={d.url} target="_blank" rel="noopener noreferrer" className="hover:text-teal-400">
                                                {new Date(d.date).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
                                            </a>
                                        ) : (
                                            new Date(d.date).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
                                        )}
                                    </td>
                                    <td className="py-2 pr-3 text-xs text-gray-400 whitespace-nowrap">{t(`type.${d.dealType}`)}</td>
                                    <td className="py-2 pr-3 text-gray-200"><Party name={d.buyer} symbol={d.buyerSymbol} /></td>
                                    <td className="py-2 pr-3 text-gray-200"><Party name={d.seller} symbol={d.sellerSymbol} /></td>
                                    <td className="py-2 pr-3 text-xs text-gray-400 max-w-64" title={d.summary}>{d.asset}</td>
                                    <td className="py-2 pr-3 text-right"><Amount a={d.upfront} unverified={t('unverified')} /></td>
                                    <td className="py-2 text-right"><Amount a={d.total} unverified={t('unverified')} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
}
