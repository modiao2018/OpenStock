import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getSession } from '@/lib/get-session';
import { getAiDipsSnapshot } from '@/lib/actions/ai-dips.actions';
import AiDipsBoard from '@/components/ai-dips/AiDipsBoard';

export default async function AiDipsPage() {
    const t = await getTranslations('aiDips.page');
    const session = await getSession();

    if (!session) {
        redirect('/sign-in');
    }

    // Last-known-good snapshot paints instantly; the board's mount refresh
    // fetches live data right after hydration
    const snapshot = await getAiDipsSnapshot();

    return (
        <div className="min-h-screen bg-black text-gray-100 p-6 md:p-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                    {t('title')}
                </h1>
                <p className="text-gray-500 mt-1">{t('subtitle')}</p>
            </div>
            <AiDipsBoard initialData={snapshot} />
        </div>
    );
}
