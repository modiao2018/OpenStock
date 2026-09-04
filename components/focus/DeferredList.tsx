import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BellOff } from 'lucide-react';
import type { DeferredItemData } from '@/lib/actions/focus.actions';
import { formatClock } from '@/lib/format-time';

export default async function DeferredList({ items }: { items: DeferredItemData[] }) {
    const t = await getTranslations('focus.deferred');
    const locale = await getLocale();
    const fmt = (iso: string) => formatClock(iso, locale);

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <div className="flex items-center gap-2 mb-1">
                <BellOff className="w-5 h-5 text-gray-500" />
                <h2 className="text-lg font-semibold">{t('title')}</h2>
            </div>
            <p className="text-xs text-gray-600 mb-4">{t('hint')}</p>
            {items.length === 0 ? (
                <p className="text-sm text-gray-500">{t('empty')}</p>
            ) : (
                <ul className="space-y-1.5 text-xs">
                    {items.map((d) => (
                        <li key={d.id} className="flex items-start gap-3 text-gray-300">
                            <span className="text-gray-600 whitespace-nowrap w-24">{fmt(d.createdAt)}</span>
                            <Link href={`/stocks/${d.symbol}`} className="font-medium text-gray-100 hover:text-teal-400 w-14">{d.symbol}</Link>
                            <span className="text-gray-600 tabular-nums w-10">{d.scoreAtDefer}</span>
                            <span className="flex-1 truncate" title={d.body}>{d.title}</span>
                            <span className={`whitespace-nowrap ${d.sentAt ? 'text-gray-600' : 'text-amber-500/80'}`}>{d.sentAt ? t('sent') : t('queued')}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
