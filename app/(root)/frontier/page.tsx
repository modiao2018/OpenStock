import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getSession } from '@/lib/get-session';
import {
    getFrontierConferences,
    getFrontierDeals,
    getFrontierEvents,
    getFrontierFunds,
    getFrontierMilestones,
    getFrontierOverview,
    getFrontierPapers,
    getFrontierReports,
} from '@/lib/actions/frontier.actions';
import AutoRefresh from '@/components/catalyst/AutoRefresh';
import GuideCard from '@/components/catalyst/GuideCard';
import ThemeStrip from '@/components/frontier/ThemeStrip';
import EventFeed from '@/components/frontier/EventFeed';
import ConferencePanel from '@/components/frontier/ConferencePanel';
import FrontierStatusPanel from '@/components/frontier/FrontierStatusPanel';
import MilestoneBoard from '@/components/frontier/MilestoneBoard';
import DealTable from '@/components/frontier/DealTable';
import ThemeBaskets from '@/components/frontier/ThemeBaskets';
import ThemeManager from '@/components/frontier/ThemeManager';
import FundChanges from '@/components/frontier/FundChanges';
import PaperList from '@/components/frontier/PaperList';
import ReportView from '@/components/frontier/ReportView';
import UpcomingReadouts from '@/components/frontier/UpcomingReadouts';

const TABS = ['feed', 'milestones', 'deals', 'themes', 'funds', 'papers', 'report'] as const;
type Tab = (typeof TABS)[number];

export default async function FrontierPage({
    searchParams,
}: {
    searchParams: Promise<{ tab?: string; theme?: string; event?: string }>;
}) {
    const session = await getSession();
    if (!session) redirect('/sign-in');
    const t = await getTranslations('frontier');
    const params = await searchParams;
    const tab: Tab = (TABS as readonly string[]).includes(params.tab ?? '') ? (params.tab as Tab) : 'feed';
    const theme = params.theme || undefined;

    const overview = await getFrontierOverview();
    const themeNames = Object.fromEntries(overview.themes.map((x) => [x.key, x.name]));
    const tabHref = (key: Tab) => `/frontier?tab=${key}${theme && key === 'feed' ? `&theme=${theme}` : ''}`;
    const badge: Partial<Record<Tab, number>> = { milestones: overview.pendingProposals + overview.proposedDrugs };

    let content: React.ReactNode = null;
    if (tab === 'feed') {
        const [events, conferences, milestones] = await Promise.all([
            getFrontierEvents({ theme, days: 14 }),
            getFrontierConferences(),
            getFrontierMilestones(),
        ]);
        content = (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <EventFeed events={events} themeNames={themeNames} activeTheme={theme ?? null} highlightId={params.event ?? null} />
                </div>
                <div className="lg:col-span-1 space-y-6">
                    <UpcomingReadouts milestones={milestones} />
                    <ConferencePanel conferences={conferences} themeNames={themeNames} />
                    <FrontierStatusPanel overview={overview} />
                </div>
            </div>
        );
    } else if (tab === 'milestones') {
        content = <MilestoneBoard milestones={await getFrontierMilestones()} />;
    } else if (tab === 'deals') {
        content = <DealTable deals={await getFrontierDeals()} themeNames={themeNames} />;
    } else if (tab === 'themes') {
        content = <ThemeBaskets overview={overview} />;
    } else if (tab === 'funds') {
        content = <FundChanges funds={await getFrontierFunds()} universe={overview.themes.flatMap((x) => x.tickers.map((k) => k.symbol))} />;
    } else if (tab === 'papers') {
        content = <PaperList data={await getFrontierPapers()} />;
    } else {
        content = <ReportView reports={await getFrontierReports()} />;
    }

    return (
        <div className="min-h-screen bg-black text-gray-100 p-6 md:p-8">
            <AutoRefresh intervalMs={120_000} />

            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">{t('page.title')}</h1>
                    <p className="text-gray-500 mt-1">{t('page.subtitle')}</p>
                </div>
                <div className="flex items-center gap-3">
                    <span
                        className={`text-xs px-2 py-1 rounded-full ${
                            !overview.llm.configured
                                ? 'bg-gray-800 text-gray-400'
                                : overview.llm.used >= overview.llm.budget
                                  ? 'bg-amber-900/50 text-amber-300'
                                  : 'bg-teal-900/60 text-teal-300'
                        }`}
                    >
                        {overview.llm.configured ? t('page.llmChip', { used: overview.llm.used, budget: overview.llm.budget }) : t('page.llmOff')}
                    </span>
                    <ThemeManager themes={overview.themes} />
                </div>
            </div>

            <GuideCard
                namespace="frontier.guide"
                sections={['why', 'flow', 'glossary', 'stars', 'verify', 'next']}
                storageKey="frontier-guide-collapsed"
            />

            <ThemeStrip themes={overview.themes} benchmark={overview.benchmark} activeTheme={theme ?? null} />

            <nav className="flex flex-wrap gap-1 border-b border-gray-800 mb-6">
                {TABS.map((key) => (
                    <Link
                        key={key}
                        href={tabHref(key)}
                        className={`px-3.5 py-2 text-sm -mb-px border-b-2 transition-colors ${
                            tab === key ? 'border-teal-500 text-gray-100' : 'border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                    >
                        {t(`tabs.${key}`)}
                        {badge[key] ? <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-900/60 text-amber-300">{badge[key]}</span> : null}
                    </Link>
                ))}
            </nav>

            {content}
        </div>
    );
}
