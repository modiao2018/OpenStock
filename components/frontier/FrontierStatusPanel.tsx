'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setFrontierLlmBudget, type FrontierOverview } from '@/lib/actions/frontier.actions';
import { formatClock } from '@/lib/format-time';
import { Card } from './shared';

/** 运行状态：各数据源上次运行、LLM 今日用量与每日额度（可改） */
export default function FrontierStatusPanel({ overview }: { overview: FrontierOverview }) {
    const t = useTranslations('frontier.status');
    const locale = useLocale();
    const router = useRouter();
    const [budget, setBudget] = useState(String(overview.llm.budget));
    const [saving, setSaving] = useState(false);
    const { llm } = overview;
    const pct = Math.min(100, Math.round((llm.used / Math.max(1, llm.budget)) * 100));

    const saveBudget = async () => {
        setSaving(true);
        try {
            await setFrontierLlmBudget(Number(budget));
            toast.success(t('budgetSaved'));
            router.refresh();
        } catch {
            toast.error(t('budgetInvalid'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card title={t('title')} icon={<Activity className="w-5 h-5 text-teal-500" />}>
            <div className="mb-4">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-300">{t('llmToday')}</span>
                    <span className="tabular-nums text-gray-400">
                        {llm.configured ? `${llm.used} / ${llm.budget}` : t('llmOff')}
                    </span>
                </div>
                {llm.configured && (
                    <>
                        <div className="mt-1.5 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                            <div className={`h-full ${pct >= 100 ? 'bg-amber-500' : 'bg-teal-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-xs text-gray-600 mt-1">{t('llmBreakdown', { triage: llm.triage, deep: llm.deep, weekly: llm.weekly })}</p>
                    </>
                )}
                <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-gray-500 shrink-0">{t('budget')}</span>
                    <Input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="numeric" className="h-7 w-20 bg-gray-950 border-gray-700 text-xs" />
                    <Button size="sm" variant="outline" onClick={saveBudget} disabled={saving || budget === String(llm.budget)} className="h-7 border-gray-700 text-xs text-gray-200">
                        {t('save')}
                    </Button>
                </div>
                <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{t('budgetHint')}</p>
            </div>

            <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">{t('sources')}</h3>
            <ul className="space-y-1.5">
                {overview.sources.map((s) => (
                    <li key={s.id} className="text-sm" title={s.error ?? undefined}>
                        <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${s.ok === null ? 'bg-gray-600' : s.ok ? 'bg-teal-400' : 'bg-red-400'}`} />
                                <span className="text-gray-300">{t(`source.${s.id}`)}</span>
                            </span>
                            <span className="text-xs text-gray-500 tabular-nums">
                                {s.at ? formatClock(s.at, locale) : t('never')}
                                {s.ok && s.added > 0 && <span className="text-teal-500 ml-1.5">+{s.added}</span>}
                            </span>
                        </div>
                        {s.ok === false && s.error && <p className="text-xs text-red-400/80 ml-3.5 truncate">{s.error}</p>}
                    </li>
                ))}
            </ul>
            {overview.collectors.every((c) => !c.lastRun) && <p className="text-xs text-amber-500/80 mt-3">{t('daemonHint')}</p>}
        </Card>
    );
}
