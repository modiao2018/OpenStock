import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getSession } from '@/lib/get-session';
import { isAdminEmail } from '@/lib/admin';
import { getResearchThemes } from '@/lib/actions/research.actions';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { getWatchlistDataCached } from '@/lib/actions/finnhub.actions';
import { themeSymbols } from '@/lib/research-math';
import ResearchThemeView from '@/components/research/ResearchThemeView';

export default async function ResearchPage() {
    const t = await getTranslations('research.page');
    const session = await getSession();
    if (!session) redirect('/sign-in');

    const [themes, watchlist] = await Promise.all([getResearchThemes(), getUserWatchlist(session.user.id)]);
    const inWatchlist: string[] = (watchlist as { symbol: string }[]).map((w) => w.symbol);

    // One quote snapshot per theme: the last-known rows paint at once, the
    // client refreshes live prices after mount (same recipe as the watchlist)
    const quotes = await Promise.all(themes.map((theme) => getWatchlistDataCached(themeSymbols(theme))));

    return (
        <div className="min-h-screen bg-black text-gray-100 p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                        {t('title')}
                    </h1>
                    <p className="text-gray-500 mt-1">{t('subtitle')}</p>
                </div>
            </div>

            {themes.length === 0 ? (
                <p className="text-sm text-gray-500">{t('empty')}</p>
            ) : (
                <div className="space-y-12">
                    {themes.map((theme, i) => (
                        <ResearchThemeView
                            key={theme.slug}
                            theme={theme}
                            initialQuotes={quotes[i]}
                            inWatchlist={inWatchlist}
                            userId={session.user.id}
                            isAdmin={isAdminEmail(session.user.email)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
