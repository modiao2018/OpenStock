import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getSession } from '@/lib/get-session';
import { getSourcesStatus, getXcheckStatus } from '@/lib/actions/sources.actions';
import AutoRefresh from '@/components/catalyst/AutoRefresh';
import SourcesPanel from '@/components/status/SourcesPanel';
import XcheckCard from '@/components/status/XcheckCard';

export default async function StatusPage() {
    const t = await getTranslations('status');
    const session = await getSession();
    if (!session) {
        redirect('/sign-in');
    }

    const [sources, xcheck] = await Promise.all([getSourcesStatus(), getXcheckStatus()]);
    const down = sources.filter((s) => s.level === 'down').length;
    const warn = sources.filter((s) => s.level === 'warn').length;
    const chip = down > 0
        ? { label: t('summary.down', { n: down }), cls: 'bg-red-900/50 text-red-300' }
        : warn > 0
          ? { label: t('summary.warn', { n: warn }), cls: 'bg-amber-900/50 text-amber-300' }
          : { label: t('summary.allOk'), cls: 'bg-teal-900/60 text-teal-300' };

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
                <span className={`text-xs px-2 py-1 rounded-full ${chip.cls}`}>● {chip.label}</span>
            </div>

            <div className="space-y-6">
                <XcheckCard status={xcheck} />
                <SourcesPanel rows={sources} />
            </div>
        </div>
    );
}
