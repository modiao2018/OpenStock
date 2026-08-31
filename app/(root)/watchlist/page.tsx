import React, { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/get-session';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { getUserAlerts } from '@/lib/actions/alert.actions';
import { getNews, getWatchlistDataCached } from '@/lib/actions/finnhub.actions';
import { localizeNews } from '@/lib/news-translation';
import WatchlistManager from '@/components/watchlist/WatchlistManager';
import AlertsPanel from '@/components/watchlist/AlertsPanel';
import NewsGrid from '@/components/watchlist/NewsGrid';
import SearchCommand from '@/components/SearchCommand';
import { Loader2 } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

// Rendered inside Suspense: news arrives after the table, never blocking it
async function WatchlistNews({ symbols }: { symbols: string[] }) {
    const [locale, news] = await Promise.all([
        getLocale(),
        getNews(symbols.length > 0 ? symbols : undefined),
    ]);
    const localized = locale === 'zh-CN' ? await localizeNews(news || []) : (news || []);
    return <NewsGrid news={localized} />;
}

export default async function WatchlistPage() {
    const t = await getTranslations('watchlist.page');
    const session = await getSession();

    if (!session) {
        redirect('/sign-in');
    }

    const userId = session.user.id;

    // Parallel data fetching
    const [watchlistItems, alerts] = await Promise.all([
        getUserWatchlist(userId),
        getUserAlerts(userId),
    ]);

    const watchlistSymbols = watchlistItems.map((item: any) => item.symbol);

    // Last-known-good snapshot serves instantly; the table's client refresh
    // fetches live quotes right after mount. News streams in via Suspense.
    const tableData = watchlistSymbols.length > 0 ? await getWatchlistDataCached(watchlistSymbols) : [];

    return (
        <div className="min-h-screen bg-black text-gray-100 p-6 md:p-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                        {t('title')}
                    </h1>
                    <p className="text-gray-500 mt-1">{t('subtitle')}</p>
                </div>
                <div className="flex items-center space-x-4">
                    <SearchCommand renderAs="button" label={t('addStock')} initialStocks={[]} />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Main Content - Watchlist Table */}
                <div className="lg:col-span-3 space-y-8">
                    <div className="space-y-6">
                        <WatchlistManager initialItems={watchlistItems} initialTableData={tableData} userId={userId} />
                    </div>

                    {/* News Section — streamed so slow news fetches never block the table */}
                    <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="animate-spin text-gray-500" /></div>}>
                        <WatchlistNews symbols={watchlistSymbols} />
                    </Suspense>
                </div>

                {/* Sidebar - Alerts */}
                <div className="lg:col-span-1">
                    <AlertsPanel alerts={alerts} />
                </div>
            </div>
        </div>
    );
}
