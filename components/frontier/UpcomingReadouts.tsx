'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FlaskConical } from 'lucide-react';
import type { MilestoneData } from '@/lib/actions/frontier.actions';
import { daysBetween, phaseLabel } from '@/lib/frontier-math';
import { Card } from './shared';

/** 侧栏：AI 药物记分板里最近可能读出数据的几个（按登记库主要完成日） */
export default function UpcomingReadouts({ milestones }: { milestones: MilestoneData[] }) {
    const t = useTranslations('frontier.readouts');
    const today = new Date().toISOString().slice(0, 10);
    const rows = milestones
        .filter((m) => m.status === 'active' && m.registry?.nextReadout)
        .sort((a, b) => a.registry!.nextReadout!.localeCompare(b.registry!.nextReadout!))
        .slice(0, 6);

    return (
        <Card title={t('title')} icon={<FlaskConical className="w-5 h-5 text-teal-500" />} hint={t('hint')}>
            {rows.length === 0 ? (
                <p className="text-sm text-gray-500">{t('empty')}</p>
            ) : (
                <ul className="space-y-2">
                    {rows.map((m) => {
                        const date = m.registry!.nextReadout!;
                        const days = daysBetween(today, date.length === 7 ? `${date}-01` : date);
                        return (
                            <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                                <span className="min-w-0">
                                    <span className="text-gray-200">{m.drug}</span>
                                    <span className="text-xs text-gray-500 ml-1.5">
                                        {phaseLabel(m.registry!.maxPhase)} · {m.symbol ? <Link href={`/stocks/${m.symbol}`} className="hover:text-teal-400">{m.symbol}</Link> : m.company}
                                    </span>
                                </span>
                                <span className="shrink-0 text-xs tabular-nums text-gray-400">
                                    {date}
                                    <span className="text-gray-600 ml-1">{days > 0 ? t('inDays', { n: days }) : t('thisMonth')}</span>
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
            <Link href="/frontier?tab=milestones" className="block mt-3 text-xs text-teal-500 hover:text-teal-400">{t('more')}</Link>
        </Card>
    );
}
