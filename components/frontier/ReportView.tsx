'use client';

import React, { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';
import type { ReportData } from '@/lib/actions/frontier.actions';
import { formatClock } from '@/lib/format-time';
import { Card } from './shared';

/** 周报：最近几期，默认显示最新一期 */
export default function ReportView({ reports }: { reports: ReportData[] }) {
    const t = useTranslations('frontier.report');
    const locale = useLocale();
    const [idx, setIdx] = useState(0);
    const r = reports[idx];

    return (
        <Card
            title={t('title')}
            icon={<FileText className="w-5 h-5 text-teal-500" />}
            hint={t('hint')}
            actions={
                reports.length > 1 ? (
                    <select value={idx} onChange={(e) => setIdx(Number(e.target.value))} className="h-8 rounded-md bg-gray-950 border border-gray-700 px-2 text-xs text-gray-300">
                        {reports.map((x, i) => (
                            <option key={x.week} value={i}>{x.week}</option>
                        ))}
                    </select>
                ) : null
            }
        >
            {!r ? (
                <p className="text-sm text-gray-500">{t('empty')}</p>
            ) : (
                <>
                    <p className="text-xs text-gray-500 mb-3">{r.subject} · {formatClock(r.createdAt, locale)}</p>
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-300 leading-relaxed">{r.text}</pre>
                </>
            )}
        </Card>
    );
}
