import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getSession } from '@/lib/get-session';
import { getFocusQueue } from '@/lib/actions/focus.actions';
import AutoRefresh from '@/components/catalyst/AutoRefresh';
import FocusQueue from '@/components/focus/FocusQueue';
import DeferredList from '@/components/focus/DeferredList';
import { formatClock } from '@/lib/format-time';

export default async function FocusPage() {
    const t = await getTranslations('focus');
    const locale = await getLocale();
    const session = await getSession();
    if (!session) {
        redirect('/sign-in');
    }

    const data = await getFocusQueue();
    const above = data.threshold === null ? 0 : data.rows.filter((r) => r.score >= data.threshold!).length;
    const computed = data.computedAt ? formatClock(data.computedAt, locale) : null;

    return (
        <div className="min-h-screen bg-black text-gray-100 p-6 md:p-8">
            <AutoRefresh intervalMs={120_000} />

            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                        {t('page.title')}
                    </h1>
                    <p className="text-gray-500 mt-1">{t('page.subtitle')}</p>
                </div>
                <div className="text-xs text-gray-500 flex gap-3">
                    {computed ? <span>{t('summary.computedAt', { time: computed })}</span> : <span>{t('summary.never')}</span>}
                    {data.threshold !== null && (
                        <span className="text-teal-400">{t('summary.above', { n: above, threshold: data.threshold })}</span>
                    )}
                </div>
            </div>

            <div className="space-y-6">
                <FocusQueue rows={data.rows} threshold={data.threshold} />
                <DeferredList items={data.deferred} />
            </div>
        </div>
    );
}
