import React from 'react';
import { auth } from '@/lib/better-auth/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
    getCatalystEvents,
    getCatalystTrials,
    getCatalystWatchItems,
    getLlmConfig,
    getMonitorStatus,
} from '@/lib/actions/catalyst.actions';
import CatalystManager from '@/components/catalyst/CatalystManager';
import CatalystCalendar from '@/components/catalyst/CatalystCalendar';
import EventTimeline from '@/components/catalyst/EventTimeline';
import MonitorDebugPanel from '@/components/catalyst/MonitorDebugPanel';
import LlmConfigPanel from '@/components/catalyst/LlmConfigPanel';

export default async function CatalystPage() {
    const t = await getTranslations('catalyst.page');
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
        redirect('/sign-in');
    }

    const [watchItems, trials, events, monitorStatus, llmConfig] = await Promise.all([
        getCatalystWatchItems(),
        getCatalystTrials(),
        getCatalystEvents(50),
        getMonitorStatus(),
        getLlmConfig(),
    ]);

    return (
        <div className="min-h-screen bg-black text-gray-100 p-6 md:p-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                    {t('title')}
                </h1>
                <p className="text-gray-500 mt-1">{t('subtitle')}</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                    <CatalystManager initialItems={watchItems} />
                    <EventTimeline events={events} />
                </div>
                <div className="lg:col-span-1 space-y-8">
                    <MonitorDebugPanel status={monitorStatus} />
                    <LlmConfigPanel initial={llmConfig} />
                    <CatalystCalendar trials={trials} />
                </div>
            </div>
        </div>
    );
}
