import type { InsiderActivity } from '@/lib/actions/edgar.actions';
import { describeTransactionCode, isOpenMarketTrade } from '@/lib/edgar';
import { fmtCompact, fmtDate, fmtMoney, fmtShares, signClass } from './format';

interface InsiderActivityCardProps {
    activity: InsiderActivity | null;
}

function signalClass(signal: string): string {
    if (signal === 'net buying') return 'text-emerald-400';
    if (signal === 'net selling') return 'text-rose-400';
    if (signal === 'mixed') return 'text-amber-300';
    return 'text-gray-400';
}

function roleLabel(tx: { isDirector: boolean; isOfficer: boolean; isTenPercentOwner: boolean; ownerTitle: string | null }): string {
    if (tx.ownerTitle) return tx.ownerTitle;
    const roles: string[] = [];
    if (tx.isOfficer) roles.push('Officer');
    if (tx.isDirector) roles.push('Director');
    if (tx.isTenPercentOwner) roles.push('10% owner');
    return roles.join(' · ') || 'Insider';
}

export default function InsiderActivityCard({ activity }: InsiderActivityCardProps) {
    if (!activity) return null;

    const { summary, transactions } = activity;
    const openMarket = transactions.filter(isOpenMarketTrade);
    const other = transactions.filter((tx) => !isOpenMarketTrade(tx));
    const rows = [...openMarket, ...other].slice(0, 12);

    return (
        <section className="rounded-2xl border border-gray-800 bg-gray-950/40 p-5 backdrop-blur-sm">
            <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                            Insider Transactions
                        </p>
                        <h2 className="mt-2 text-xl font-semibold text-white">
                            {summary.symbol} Form 4 filings, last {summary.lookbackDays} days
                        </h2>
                        <p className="mt-1 text-sm text-gray-400">
                            Read directly from SEC EDGAR, the primary record. Open-market trades (codes P and S) are weighted; grants,
                            option exercises and tax withholding are listed but excluded from the signal.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-2xl border border-gray-800 bg-black/20 p-4 md:min-w-[320px]">
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Signal</p>
                            <p className={`mt-1 text-sm font-semibold capitalize ${signalClass(summary.signal)}`}>{summary.signal}</p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Net value</p>
                            <p className={`mt-1 text-lg font-semibold ${signClass(summary.netValue, 'text-white')}`}>
                                {fmtCompact(summary.netValue, '$')}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Open-market buys</p>
                            <p className="mt-1 text-lg font-semibold text-white">
                                {summary.openMarketBuys}
                                <span className="ml-1 text-xs font-normal text-gray-500">{fmtCompact(summary.buyValue, '$')}</span>
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Open-market sells</p>
                            <p className="mt-1 text-lg font-semibold text-white">
                                {summary.openMarketSells}
                                <span className="ml-1 text-xs font-normal text-gray-500">{fmtCompact(summary.sellValue, '$')}</span>
                            </p>
                        </div>
                    </div>
                </div>

                {transactions.length === 0 ? (
                    <p className="rounded-xl border border-gray-800 bg-black/20 p-4 text-sm text-gray-400">
                        No Form 4 filings on EDGAR in this window.
                    </p>
                ) : (
                    <div className="rounded-xl border border-gray-800 bg-black/20 p-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-semibold text-white">
                                {summary.filingCount} filings · {summary.transactionCount} transactions
                            </h3>
                            <span className="text-xs text-gray-500">Latest filed {fmtDate(summary.latestFilingDate)}</span>
                        </div>
                        <div className="mt-3 overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="text-xs uppercase tracking-wide text-gray-500">
                                    <tr>
                                        <th className="py-2 pr-3 font-medium">Insider</th>
                                        <th className="py-2 pr-3 font-medium">Type</th>
                                        <th className="py-2 pr-3 font-medium text-right">Shares</th>
                                        <th className="py-2 pr-3 font-medium text-right">Price</th>
                                        <th className="py-2 pr-3 font-medium text-right">Value</th>
                                        <th className="py-2 pr-3 font-medium text-right">Traded</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-200">
                                    {rows.map((tx, idx) => {
                                        const open = isOpenMarketTrade(tx);
                                        return (
                                            <tr
                                                key={`${tx.accessionNumber}-${idx}`}
                                                className={`border-t border-gray-800/80 ${open ? '' : 'text-gray-400'}`}
                                            >
                                                <td className="py-2 pr-3">
                                                    <a
                                                        href={tx.filingUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="font-medium text-gray-100 hover:text-white hover:underline"
                                                    >
                                                        {tx.ownerName}
                                                    </a>
                                                    <p className="text-xs text-gray-500">{roleLabel(tx)}</p>
                                                </td>
                                                <td className="py-2 pr-3">
                                                    <span
                                                        className={
                                                            tx.transactionCode === 'P'
                                                                ? 'text-emerald-400'
                                                                : tx.transactionCode === 'S'
                                                                  ? 'text-rose-400'
                                                                  : ''
                                                        }
                                                    >
                                                        {describeTransactionCode(tx.transactionCode)}
                                                    </span>
                                                    {tx.isRule10b51 && open ? (
                                                        <span className="ml-1 text-xs text-gray-500" title="Pre-scheduled 10b5-1 plan trade">
                                                            10b5-1
                                                        </span>
                                                    ) : null}
                                                    {tx.isDerivative ? <span className="ml-1 text-xs text-gray-500">deriv.</span> : null}
                                                </td>
                                                <td className={`py-2 pr-3 text-right ${signClass(tx.change, 'text-gray-300')}`}>
                                                    {tx.change !== null ? `${tx.change > 0 ? '+' : ''}${fmtShares(tx.change)}` : fmtShares(tx.shares)}
                                                </td>
                                                <td className="py-2 pr-3 text-right">{tx.pricePerShare ? fmtMoney(tx.pricePerShare) : '—'}</td>
                                                <td className="py-2 pr-3 text-right">{tx.value !== null ? fmtCompact(tx.value, '$') : '—'}</td>
                                                <td className="py-2 pr-3 text-right text-xs text-gray-400">{fmtDate(tx.transactionDate)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {transactions.length > rows.length ? (
                            <p className="mt-2 text-xs text-gray-500">Showing {rows.length} of {transactions.length} transactions.</p>
                        ) : null}
                    </div>
                )}
            </div>
        </section>
    );
}
