'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Landmark } from 'lucide-react';
import type { FundData } from '@/lib/actions/frontier.actions';
import { formatUsd } from '@/lib/frontier-math';
import { isRedUpLocale } from '@/lib/utils';
import { Card } from './shared';

/** 13F 机构动向：每家专业基金最新一季相对上一季的建仓/加仓/减仓/清仓 */
export default function FundChanges({ funds, universe }: { funds: FundData[]; universe: string[] }) {
    const t = useTranslations('frontier.funds');
    const locale = useLocale();
    const redUp = isRedUpLocale(locale);
    const inUniverse = new Set(universe);
    const [onlyThemes, setOnlyThemes] = useState(false);

    const changeClass = (c: string) => {
        const buy = c === 'new' || c === 'add';
        if (buy) return redUp ? 'text-red-300 bg-red-950/40' : 'text-green-300 bg-green-950/40';
        return redUp ? 'text-green-300 bg-green-950/40' : 'text-red-300 bg-red-950/40';
    };

    // 跨基金汇总：同一标的被几家同时买入/卖出，比单家动作更有信号意义
    const consensus = new Map<string, { buy: string[]; sell: string[]; issuer: string }>();
    for (const f of funds) {
        for (const c of f.changes) {
            const key = c.symbol ?? c.issuer;
            const entry = consensus.get(key) ?? { buy: [], sell: [], issuer: c.issuer };
            (c.change === 'new' || c.change === 'add' ? entry.buy : entry.sell).push(f.name);
            consensus.set(key, entry);
        }
    }
    const crowd = [...consensus.entries()]
        .filter(([, v]) => v.buy.length >= 2 || v.sell.length >= 2)
        .sort((a, b) => Math.max(b[1].buy.length, b[1].sell.length) - Math.max(a[1].buy.length, a[1].sell.length))
        .slice(0, 12);

    return (
        <div className="space-y-6">
            <Card title={t('consensusTitle')} icon={<Landmark className="w-5 h-5 text-teal-500" />} hint={t('consensusHint')}>
                {crowd.length === 0 ? (
                    <p className="text-sm text-gray-500">{funds.length === 0 ? t('empty') : t('noConsensus')}</p>
                ) : (
                    <ul className="grid md:grid-cols-2 gap-2">
                        {crowd.map(([key, v]) => (
                            <li key={key} className="text-sm rounded-lg border border-gray-800 p-2">
                                <span className="text-gray-100">{/^[A-Z.]{1,6}$/.test(key) ? <Link href={`/stocks/${key}`} className="hover:text-teal-400">{key}</Link> : key}</span>
                                <span className="text-xs text-gray-500 ml-1.5">{v.issuer}</span>
                                {v.buy.length >= 2 && <p className={`text-xs mt-1 px-1.5 py-0.5 rounded inline-block mr-1 ${changeClass('add')}`}>{t('buyers', { n: v.buy.length, names: v.buy.join('、') })}</p>}
                                {v.sell.length >= 2 && <p className={`text-xs mt-1 px-1.5 py-0.5 rounded inline-block ${changeClass('trim')}`}>{t('sellers', { n: v.sell.length, names: v.sell.join('、') })}</p>}
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            <Card
                title={t('title')}
                icon={<Landmark className="w-5 h-5 text-teal-500" />}
                hint={t('hint')}
                actions={
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                        <input type="checkbox" className="accent-teal-500" checked={onlyThemes} onChange={(e) => setOnlyThemes(e.target.checked)} />
                        {t('onlyThemes')}
                    </label>
                }
            >
                <div className="grid md:grid-cols-2 gap-4">
                    {funds.map((f) => {
                        const changes = f.changes.filter((c) => !onlyThemes || (c.symbol && inUniverse.has(c.symbol)));
                        return (
                            <div key={f.cik} className="rounded-lg border border-gray-800 p-3">
                                <div className="flex items-baseline justify-between gap-2">
                                    <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${f.cik}&type=13F-HR`} target="_blank" rel="noopener noreferrer" className="text-gray-100 hover:text-teal-400">
                                        {f.name}
                                    </a>
                                    <span className="text-xs text-gray-500">{t('period', { period: f.period, filed: f.filedAt })}</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">{t('size', { value: formatUsd(f.totalValue), n: f.holdingsCount })}</p>
                                <ul className="mt-2 space-y-1">
                                    {changes.slice(0, 10).map((c) => (
                                        <li key={c.cusip} className="flex items-center justify-between gap-2 text-xs">
                                            <span className="min-w-0 truncate">
                                                <span className={`px-1.5 py-0.5 rounded mr-1.5 ${changeClass(c.change)}`}>{t(`change.${c.change}`)}</span>
                                                {c.symbol ? <Link href={`/stocks/${c.symbol}`} className="text-gray-200 hover:text-teal-400">{c.symbol}</Link> : null}
                                                <span className="text-gray-500 ml-1">{c.issuer}</span>
                                            </span>
                                            <span className="shrink-0 tabular-nums text-gray-400">
                                                {formatUsd(c.prevValue)} → {formatUsd(c.value)}
                                            </span>
                                        </li>
                                    ))}
                                    {changes.length === 0 && <li className="text-xs text-gray-600">{t('noChanges')}</li>}
                                </ul>
                            </div>
                        );
                    })}
                </div>
                <p className="text-xs text-gray-600 mt-3 leading-relaxed">{t('footnote')}</p>
            </Card>
        </div>
    );
}
