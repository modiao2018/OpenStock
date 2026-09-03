import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { History } from 'lucide-react';
import { HORIZON_KEYS } from '@/lib/signal-math';
import type { SignalRowData } from '@/lib/actions/signals.actions';

const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const pctClass = (v: number | null | undefined) =>
    v === null || v === undefined ? 'text-gray-700' : v > 0 ? 'text-teal-400' : v < 0 ? 'text-red-400' : 'text-gray-300';

const DIR_GLYPH = { up: '↑', down: '↓', none: '·' } as const;
const DIR_CLASS = { up: 'text-teal-500', down: 'text-red-400', none: 'text-gray-600' } as const;

export default async function RecentSignals({ rows }: { rows: SignalRowData[] }) {
    const t = await getTranslations('signals');
    const locale = await getLocale();
    const fmtTime = (iso: string) =>
        new Date(iso).toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const kindLabel = (k: string) => (t.has(`kinds.${k}`) ? t(`kinds.${k}`) : k);

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <div className="flex items-center gap-2 mb-1">
                <History className="w-5 h-5 text-teal-500" />
                <h2 className="text-lg font-semibold">{t('recent.title')}</h2>
            </div>
            <p className="text-xs text-gray-600 mb-4">{t('recent.hint')}</p>

            {rows.length === 0 ? (
                <p className="text-sm text-gray-500">{t('empty')}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-gray-500">
                                <th className="pb-2 font-normal">{t('col.firedAt')}</th>
                                <th className="pb-2 font-normal">{t('col.symbol')}</th>
                                <th className="pb-2 font-normal">{t('col.signal')}</th>
                                <th className="pb-2 font-normal">{t('col.action')}</th>
                                <th className="pb-2 font-normal text-right">{t('col.entry')}</th>
                                {HORIZON_KEYS.map((k) => (
                                    <th key={k} className="pb-2 font-normal text-right uppercase">{k}</th>
                                ))}
                                <th className="pb-2 font-normal text-right">{t('col.status')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} className="border-t border-gray-800/60 text-gray-300">
                                    <td className="py-1.5 text-gray-500 whitespace-nowrap">{fmtTime(r.firedAt)}</td>
                                    <td className="py-1.5">
                                        <Link href={`/stocks/${r.symbol}`} className="font-medium text-gray-100 hover:text-teal-400">{r.symbol}</Link>
                                        <span className={`ml-1 ${DIR_CLASS[r.direction]}`}>{DIR_GLYPH[r.direction]}</span>
                                    </td>
                                    <td className="py-1.5 max-w-[22rem] truncate" title={r.title}>
                                        <span className="text-gray-400">{kindLabel(r.kind)}</span>
                                        <span className="ml-2 text-gray-500">{r.title}</span>
                                    </td>
                                    <td className="py-1.5 text-gray-400">{r.action ?? ''}</td>
                                    <td className="py-1.5 text-right tabular-nums text-gray-400 whitespace-nowrap">
                                        {r.entryClose !== null ? `$${r.entryClose.toFixed(2)}` : r.entryDate}
                                    </td>
                                    {HORIZON_KEYS.map((k) => {
                                        const h = r.horizons[k];
                                        const v = h ? (h.excessPct ?? h.returnPct) : null;
                                        return (
                                            <td key={k} className={`py-1.5 text-right tabular-nums ${pctClass(v)}`} title={h ? `${h.date} 绝对 ${fmtPct(h.returnPct)} vs ${r.benchmark}` : undefined}>
                                                {fmtPct(v)}
                                            </td>
                                        );
                                    })}
                                    <td className="py-1.5 text-right">
                                        <span className={r.status === 'complete' ? 'text-gray-500' : r.status === 'expired' ? 'text-gray-700' : 'text-amber-500/80'}>
                                            {t(`status.${r.status}`)}
                                        </span>
                                        {!r.delivered && <span className="ml-1 text-gray-700" title={t('notDelivered')}>✕</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
