import React from 'react';
import { getTranslations } from 'next-intl/server';
import { Waves } from 'lucide-react';
import type { MarketSnapshotData } from '@/lib/actions/catalyst.actions';

function beijing(iso: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return iso;
    const d = new Date(t + 8 * 3600_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export default async function MarketPanel({ snapshot }: { snapshot: MarketSnapshotData }) {
    const t = await getTranslations('catalyst.market');

    return (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Waves className="w-5 h-5 text-teal-500" />
                    {t('title')}
                </h2>
                {snapshot.configured && snapshot.marketOpen !== undefined && (
                    <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                            snapshot.marketOpen ? 'bg-teal-900/60 text-teal-300' : 'bg-gray-800 text-gray-500'
                        }`}
                    >
                        {snapshot.marketOpen ? t('open') : t('closed')}
                    </span>
                )}
            </div>
            <p className="text-xs text-gray-600 mb-4">
                {t('hint', {
                    benchmark: snapshot.benchmark,
                    sigma: snapshot.sigmaThreshold,
                    rvol: snapshot.rvolThreshold,
                })}
            </p>

            {!snapshot.configured ? (
                <p className="text-sm text-gray-500">{t('notConfigured')}</p>
            ) : snapshot.symbols.length === 0 ? (
                <p className="text-sm text-gray-500">{t('noData')}</p>
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-xs text-gray-500 text-left">
                            <th className="pb-2 font-normal">{t('symbol')}</th>
                            <th className="pb-2 font-normal text-right">{t('ar')}</th>
                            <th className="pb-2 font-normal text-right">σ</th>
                            <th className="pb-2 font-normal text-right">{t('rvol')}</th>
                            <th className="pb-2 font-normal text-right">{t('dataAsOf')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {snapshot.symbols.map((s) => {
                            const hot = Math.abs(s.z) >= snapshot.sigmaThreshold && s.rvol >= snapshot.rvolThreshold;
                            const warm = Math.abs(s.z) >= snapshot.sigmaThreshold * 0.6;
                            return (
                                <tr key={s.symbol} className="border-t border-gray-800">
                                    <td className="py-2 font-medium text-gray-100">
                                        <span
                                            className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${
                                                hot ? 'bg-red-400' : warm ? 'bg-amber-400' : s.fresh ? 'bg-teal-500' : 'bg-gray-600'
                                            }`}
                                        />
                                        {s.symbol}
                                    </td>
                                    <td className={`py-2 text-right ${hot ? 'text-red-300' : warm ? 'text-amber-300' : 'text-gray-300'}`}>
                                        {s.arPct > 0 ? '+' : ''}
                                        {s.arPct}%
                                    </td>
                                    <td className={`py-2 text-right ${hot ? 'text-red-300' : 'text-gray-400'}`}>
                                        {s.z > 0 ? '+' : ''}
                                        {s.z}
                                    </td>
                                    <td className="py-2 text-right text-gray-400">{s.rvol}x</td>
                                    <td className="py-2 text-right text-xs text-gray-600" title={s.fresh ? '' : t('stale')}>
                                        {beijing(s.lastBarAt)}
                                        {!s.fresh && ' ⏸'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </div>
    );
}
