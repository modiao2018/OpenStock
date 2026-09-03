import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getSession } from '@/lib/get-session';
import { getScorecard } from '@/lib/actions/signals.actions';
import AutoRefresh from '@/components/catalyst/AutoRefresh';
import Scorecard from '@/components/signals/Scorecard';
import RecentSignals from '@/components/signals/RecentSignals';

export default async function SignalsPage() {
    const t = await getTranslations('signals');
    const session = await getSession();
    if (!session) {
        redirect('/sign-in');
    }

    const data = await getScorecard();

    return (
        <div className="min-h-screen bg-black text-gray-100 p-6 md:p-8">
            <AutoRefresh />

            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                        {t('page.title')}
                    </h1>
                    <p className="text-gray-500 mt-1">{t('page.subtitle')}</p>
                </div>
                <div className="text-xs text-gray-500 flex gap-3">
                    <span>{t('summary.total', { n: data.total, days: data.windowDays })}</span>
                    <span className="text-amber-400">{t('summary.pending', { n: data.pending })}</span>
                    {data.expired > 0 && <span className="text-gray-600">{t('summary.expired', { n: data.expired })}</span>}
                </div>
            </div>

            <div className="space-y-6">
                <Scorecard title={t('byKind.title')} hint={t('byKind.hint')} rows={data.byKind} labelKind="kind" />
                <Scorecard title={t('byAction.title')} hint={t('byAction.hint')} rows={data.byAction} labelKind="action" />
                <RecentSignals rows={data.recent} />
            </div>
        </div>
    );
}
