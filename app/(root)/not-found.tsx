import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

// Themed 404 for the signed-in shell; the framework default is white on white here
export default async function NotFound() {
    const t = await getTranslations('common.notFound');
    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
            <p className="font-mono text-sm tracking-[0.2em] text-gray-600">404</p>
            <h1 className="mt-3 text-2xl font-semibold text-white">{t('title')}</h1>
            <p className="mt-2 max-w-[40ch] text-gray-500">{t('body')}</p>
            <Link href="/" className="mt-8 rounded-xl bg-white/5 px-5 py-2.5 text-sm text-gray-200 transition-colors hover:bg-white/10 hover:text-white">
                {t('home')}
            </Link>
        </div>
    );
}
