import { getLocale, getTranslations } from 'next-intl/server';
import { GitCompareArrows, TriangleAlert } from 'lucide-react';
import type { XcheckStatus } from '@/lib/actions/sources.actions';
import { formatClock } from '@/lib/format-time';

function formatTime(iso: string | undefined, locale: string): string {
    return iso ? formatClock(iso, locale) : '—';
}

export default async function XcheckCard({ status }: { status: XcheckStatus }) {
    const t = await getTranslations('status.xcheck');
    const locale = await getLocale();
    const { quotes, insider } = status;
    const hasIssues = (quotes?.mismatches.length ?? 0) > 0 || (insider?.missing.length ?? 0) > 0;

    return (
        <div className={`rounded-xl border p-5 ${hasIssues ? 'border-amber-700/60 bg-amber-950/20' : 'border-gray-800 bg-gray-900/50'}`}>
            <div className="flex items-center gap-2 mb-1">
                {hasIssues ? <TriangleAlert className="w-5 h-5 text-amber-400" /> : <GitCompareArrows className="w-5 h-5 text-teal-500" />}
                <h2 className="text-lg font-semibold">{t('title')}</h2>
            </div>
            <p className="text-xs text-gray-600 mb-4">{t('hint')}</p>

            <div className="grid gap-4 md:grid-cols-2">
                {/* 行情 */}
                <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
                    <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">{t('quotesTitle')}</h3>
                    {!status.twelveConfigured ? (
                        <p className="text-sm text-gray-500">{t('notConfigured')}</p>
                    ) : !quotes ? (
                        <p className="text-sm text-gray-500">{t('never')}</p>
                    ) : (
                        <>
                            <p className="text-xs text-gray-400 mb-2">
                                {t('lastCheck', { time: formatTime(quotes.checkedAt, locale) })} · {t('session', { date: quotes.sessionDate })} · {t('sampled', { n: quotes.sampled.length })}
                                {quotes.errors.length > 0 && <span className="ml-2 text-amber-400">{t('errors', { n: quotes.errors.length })}</span>}
                            </p>
                            {quotes.mismatches.length === 0 ? (
                                <p className="text-sm text-teal-400">{t('noMismatch')}</p>
                            ) : (
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-left text-gray-500">
                                            <th className="pb-1 font-normal">{t('symbol')}</th>
                                            <th className="pb-1 font-normal text-right">Alpaca</th>
                                            <th className="pb-1 font-normal text-right">Twelve</th>
                                            <th className="pb-1 font-normal text-right">Finnhub</th>
                                            <th className="pb-1 font-normal text-right">{t('deviation')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {quotes.mismatches.map((m) => (
                                            <tr key={m.symbol} className="border-t border-gray-800/60 text-gray-300">
                                                <td className="py-1 font-medium text-gray-100">{m.symbol}</td>
                                                <td className="py-1 text-right tabular-nums">{m.alpaca?.toFixed(2) ?? '—'}</td>
                                                <td className="py-1 text-right tabular-nums">
                                                    {m.twelve?.toFixed(2) ?? '—'}
                                                    {m.reason === 'dateMismatch' && <span className="ml-1 text-amber-400">({m.twelveDate})</span>}
                                                </td>
                                                <td className={`py-1 text-right tabular-nums ${m.finnhubOff ? 'text-amber-400' : ''}`}>{m.finnhub?.toFixed(2) ?? '—'}</td>
                                                <td className="py-1 text-right tabular-nums text-amber-400">
                                                    {m.reason === 'dateMismatch' ? t('dateMismatch') : `${m.deviationPct?.toFixed(2)}%`}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </>
                    )}
                </div>

                {/* 内部人 */}
                <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
                    <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">{t('insiderTitle')}</h3>
                    {!insider ? (
                        <p className="text-sm text-gray-500">{t('never')}</p>
                    ) : (
                        <>
                            <p className="text-xs text-gray-400 mb-2">
                                {t('lastCheck', { time: formatTime(insider.checkedAt, locale) })} · {t('window', { from: insider.windowFrom, to: insider.windowTo })} · {t('checkedFilings', { n: insider.checkedFilings })}
                            </p>
                            {insider.missing.length === 0 ? (
                                <p className="text-sm text-teal-400">{t('noMissing')}</p>
                            ) : (
                                <ul className="space-y-1 text-xs">
                                    {insider.missing.map((m) => (
                                        <li key={m.accessionNumber} className="flex items-center justify-between gap-2 text-gray-300">
                                            <span>
                                                <span className="font-medium text-gray-100">{m.symbol}</span>
                                                <span className="ml-2 text-gray-500">{m.filingDate}</span>
                                            </span>
                                            {m.url && (
                                                <a href={m.url} target="_blank" rel="noreferrer" className="text-teal-400 hover:text-teal-300">
                                                    {t('openInEdgar')}
                                                </a>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
