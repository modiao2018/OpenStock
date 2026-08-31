import React from 'react';
import { getSession } from '@/lib/get-session';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
    getCatalystEvents,
    getCatalystTrials,
    getCatalystWatchItems,
    getCustomCatalysts,
    getDashboardOverview,
    getLlmConfig,
    getMonitorStatus,
    getMarketSnapshot,
} from '@/lib/actions/catalyst.actions';
import CatalystManager from '@/components/catalyst/CatalystManager';
import CatalystAgenda from '@/components/catalyst/CatalystAgenda';
import EventTimeline from '@/components/catalyst/EventTimeline';
import MonitorDebugPanel from '@/components/catalyst/MonitorDebugPanel';
import LlmConfigDialog from '@/components/catalyst/LlmConfigDialog';
import AutoRefresh from '@/components/catalyst/AutoRefresh';
import MarketPanel from '@/components/catalyst/MarketPanel';
import GuideCard from '@/components/catalyst/GuideCard';
import DashboardHero from '@/components/catalyst/DashboardHero';
import SymbolTiles from '@/components/catalyst/SymbolTiles';

export default async function CatalystPage() {
    const t = await getTranslations('catalyst.page');
    const tDebug = await getTranslations('catalyst.debug');
    const session = await getSession();
    if (!session) {
        redirect('/sign-in');
    }

    const [watchItems, trials, events, monitorStatus, llmConfig, customEvents, marketSnapshot, overview] =
        await Promise.all([
            getCatalystWatchItems(),
            getCatalystTrials(),
            getCatalystEvents(80),
            getMonitorStatus(),
            getLlmConfig(),
            getCustomCatalysts(),
            getMarketSnapshot(),
            getDashboardOverview(),
        ]);

    const statusChip = !monitorStatus.daemonOnline
        ? { label: tDebug('offline'), cls: 'bg-red-900/50 text-red-300' }
        : monitorStatus.hasErrors
          ? { label: tDebug('onlineWithErrors'), cls: 'bg-amber-900/50 text-amber-300' }
          : { label: tDebug('online'), cls: 'bg-teal-900/60 text-teal-300' };

    return (
        <div className="min-h-screen bg-black text-gray-100 p-6 md:p-8">
            <AutoRefresh />

            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                        {t('title')}
                    </h1>
                    <p className="text-gray-500 mt-1">{t('subtitle')}</p>
                </div>
                <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${statusChip.cls}`}>● {statusChip.label}</span>
                    <CatalystManager initialItems={watchItems} />
                    <LlmConfigDialog initial={llmConfig} />
                </div>
            </div>

            <GuideCard />

            <DashboardHero overview={overview} />
            <SymbolTiles tiles={overview.tiles} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <EventTimeline events={events} />
                </div>
                <div className="lg:col-span-1 space-y-6">
                    <CatalystAgenda customEvents={customEvents} trials={trials} />
                    <MarketPanel snapshot={marketSnapshot} />
                    <MonitorDebugPanel status={monitorStatus} />
                </div>
            </div>
        </div>
    );
}
