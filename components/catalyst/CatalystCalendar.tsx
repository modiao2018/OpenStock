import React from 'react';
import { getTranslations } from 'next-intl/server';
import { CalendarClock } from 'lucide-react';
import type { CatalystTrialData } from '@/lib/actions/catalyst.actions';

const STATUS_COLORS: Record<string, string> = {
    RECRUITING: 'text-teal-400',
    ACTIVE_NOT_RECRUITING: 'text-blue-400',
    COMPLETED: 'text-gray-400',
    TERMINATED: 'text-red-400',
    SUSPENDED: 'text-red-400',
    WITHDRAWN: 'text-red-400',
};

export default async function CatalystCalendar({ trials }: { trials: CatalystTrialData[] }) {
    const t = await getTranslations('catalyst.calendar');
    const now = Date.now();

    return (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
                <CalendarClock className="w-5 h-5 text-teal-500" />
                {t('title')}
            </h2>

            {trials.length === 0 ? (
                <p className="text-gray-500 text-sm">{t('empty')}</p>
            ) : (
                <ul className="space-y-4">
                    {trials.map((trial) => {
                        const pcd = trial.primaryCompletionDate;
                        const days = pcd ? Math.ceil((Date.parse(pcd) - now) / 86_400_000) : null;
                        return (
                            <li key={trial.nctId} className="border-b border-gray-800 pb-3 last:border-0 last:pb-0">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-gray-100">
                                        {trial.symbol}
                                        <span className="ml-2 text-xs text-gray-500">{trial.phase}</span>
                                    </span>
                                    {days !== null && (
                                        <span className={`text-sm font-semibold ${days >= 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                                            {days >= 0 ? t('daysLeft', { days }) : t('daysPast', { days: -days })}
                                        </span>
                                    )}
                                </div>
                                <a
                                    href={`https://clinicaltrials.gov/study/${trial.nctId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-gray-400 hover:text-teal-400 line-clamp-2 mt-1 block"
                                >
                                    {trial.title}
                                </a>
                                <div className="flex items-center gap-3 mt-1 text-xs">
                                    <span className="text-gray-500">{trial.nctId}</span>
                                    <span className={STATUS_COLORS[trial.overallStatus] ?? 'text-gray-400'}>
                                        {trial.overallStatus}
                                    </span>
                                    {trial.hasResults && <span className="text-teal-400">{t('hasResults')}</span>}
                                </div>
                                <div className="text-xs text-gray-600 mt-1">
                                    {t('primaryCompletion')}: {pcd ?? '—'} · {t('lastUpdate')}: {trial.lastUpdatePostDate ?? '—'}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
