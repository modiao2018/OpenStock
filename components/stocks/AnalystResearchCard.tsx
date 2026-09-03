import type { AnalystResearch, RatingChange, RatingDistribution } from '@/lib/actions/analyst.helpers';
import { consensusLabel, targetsAgree } from '@/lib/actions/analyst.helpers';
import { fmtCompact, fmtDate, fmtMoney, fmtPct, fmtRatioPct, signClass } from './format';

interface AnalystResearchCardProps {
    research: AnalystResearch | null;
}

const SOURCE_LABELS: Record<string, string> = {
    yahoo: 'Yahoo Finance (LSEG)',
    nasdaq: 'Nasdaq (Zacks)',
};

function consensusClass(label: string): string {
    if (label === 'Strong Buy') return 'text-emerald-400';
    if (label === 'Buy') return 'text-emerald-300';
    if (label === 'Hold') return 'text-amber-300';
    if (label === 'Underperform' || label === 'Sell') return 'text-rose-400';
    return 'text-gray-400';
}

function actionLabel(change: RatingChange): { text: string; className: string } {
    const pt = change.priceTargetAction?.toLowerCase() ?? '';
    if (change.action === 'up') return { text: 'Upgrade', className: 'text-emerald-400' };
    if (change.action === 'down') return { text: 'Downgrade', className: 'text-rose-400' };
    if (change.action === 'init') return { text: 'Initiated', className: 'text-blue-300' };
    if (pt.includes('raise')) return { text: 'PT raised', className: 'text-emerald-300' };
    if (pt.includes('lower')) return { text: 'PT lowered', className: 'text-rose-300' };
    if (change.action === 'reit') return { text: 'Reiterated', className: 'text-gray-300' };
    return { text: 'Maintained', className: 'text-gray-300' };
}

function RatingBar({ distribution }: { distribution: RatingDistribution }) {
    if (distribution.total === 0) return null;
    const segments: Array<{ key: keyof RatingDistribution; label: string; className: string }> = [
        { key: 'strongBuy', label: 'Strong Buy', className: 'bg-emerald-500' },
        { key: 'buy', label: 'Buy', className: 'bg-emerald-400/70' },
        { key: 'hold', label: 'Hold', className: 'bg-amber-400/80' },
        { key: 'sell', label: 'Sell', className: 'bg-rose-400/70' },
        { key: 'strongSell', label: 'Strong Sell', className: 'bg-rose-500' },
    ];
    return (
        <div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-800">
                {segments.map((seg) => {
                    const count = distribution[seg.key] as number;
                    if (!count) return null;
                    return (
                        <div
                            key={seg.key}
                            className={seg.className}
                            style={{ width: `${(count / distribution.total) * 100}%` }}
                            title={`${seg.label}: ${count}`}
                        />
                    );
                })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                {segments.map((seg) => (
                    <span key={seg.key}>
                        <span className={`mr-1 inline-block h-2 w-2 rounded-full ${seg.className}`} />
                        {seg.label} {distribution[seg.key] as number}
                    </span>
                ))}
            </div>
        </div>
    );
}

export default function AnalystResearchCard({ research }: AnalystResearchCardProps) {
    if (!research) return null;

    const primary = research.targets[0] ?? null;
    const secondary = research.targets[1] ?? null;
    const latestTrend = research.ratingTrend[0] ?? null;
    const consensus = consensusLabel(latestTrend);
    const agreement = targetsAgree(primary, secondary);
    const currentEstimate = research.estimates.find((e) => e.period === '0q') ?? null;
    const currentYear = research.estimates.find((e) => e.period === '0y') ?? null;
    const nextYear = research.estimates.find((e) => e.period === '+1y') ?? null;

    return (
        <section className="rounded-2xl border border-gray-800 bg-gray-950/40 p-5 backdrop-blur-sm">
            <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                            Analyst Research
                        </p>
                        <h2 className="mt-2 text-xl font-semibold text-white">
                            {research.symbol} ratings, price targets and estimates
                        </h2>
                        <p className="mt-1 text-sm text-gray-400">
                            Sources: {research.sources.join(' · ')}
                            {research.nextEarningsDate ? ` · Next earnings ${fmtDate(research.nextEarningsDate)}` : ''}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-2xl border border-gray-800 bg-black/20 p-4 md:min-w-[320px]">
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Consensus</p>
                            <p className={`mt-1 text-lg font-semibold ${consensusClass(consensus)}`}>{consensus}</p>
                            {latestTrend ? <p className="text-xs text-gray-500">{latestTrend.total} analysts</p> : null}
                        </div>
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Mean Target</p>
                            <p className="mt-1 text-lg font-semibold text-white">{fmtMoney(primary?.mean)}</p>
                            <p className={`text-xs ${signClass(primary?.upsidePct)}`}>
                                {primary?.upsidePct !== null && primary?.upsidePct !== undefined
                                    ? `${fmtPct(primary.upsidePct)} vs ${fmtMoney(primary.currentPrice)}`
                                    : 'No upside data'}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Target Range</p>
                            <p className="mt-1 text-sm font-semibold text-white">
                                {fmtMoney(primary?.low, 0)} – {fmtMoney(primary?.high, 0)}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Cross-check</p>
                            <p
                                className={`mt-1 text-sm font-semibold ${
                                    agreement === null ? 'text-gray-400' : agreement ? 'text-emerald-400' : 'text-amber-300'
                                }`}
                            >
                                {agreement === null
                                    ? 'Single source'
                                    : agreement
                                      ? 'Sources agree'
                                      : `Sources differ (${fmtMoney(secondary?.mean)})`}
                            </p>
                        </div>
                    </div>
                </div>

                {latestTrend ? (
                    <div className="rounded-xl border border-gray-800 bg-black/20 p-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-semibold text-white">Rating distribution</h3>
                            <span className="text-xs text-gray-500">
                                {research.ratingTrend.length > 1 ? `${research.ratingTrend.length} periods tracked` : 'Current'}
                            </span>
                        </div>
                        <div className="mt-4">
                            <RatingBar distribution={latestTrend} />
                        </div>
                        {research.targets.length > 0 ? (
                            <div className="mt-4 grid grid-cols-1 gap-2 text-xs text-gray-400 sm:grid-cols-2">
                                {research.targets.map((t) => (
                                    <div key={t.source} className="rounded-lg border border-gray-800/80 bg-black/20 px-3 py-2">
                                        <span className="font-medium text-gray-300">{SOURCE_LABELS[t.source] ?? t.source}</span>
                                        <span className="ml-2">
                                            mean {fmtMoney(t.mean)} · {t.analystCount ?? '?'} analysts
                                            {t.recommendationMean !== null ? ` · score ${t.recommendationMean.toFixed(2)}/5` : ''}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {research.estimates.length > 0 ? (
                    <div className="rounded-xl border border-gray-800 bg-black/20 p-4">
                        <h3 className="text-base font-semibold text-white">Consensus estimates</h3>
                        <div className="mt-3 overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="text-xs uppercase tracking-wide text-gray-500">
                                    <tr>
                                        <th className="py-2 pr-3 font-medium">Period</th>
                                        <th className="py-2 pr-3 font-medium">EPS est.</th>
                                        <th className="py-2 pr-3 font-medium">Revision (90d)</th>
                                        <th className="py-2 pr-3 font-medium">Revenue est.</th>
                                        <th className="py-2 pr-3 font-medium">Growth</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-200">
                                    {research.estimates.map((e) => {
                                        const revision =
                                            e.epsAvg !== null && e.eps90DaysAgo !== null && e.eps90DaysAgo !== 0
                                                ? ((e.epsAvg - e.eps90DaysAgo) / Math.abs(e.eps90DaysAgo)) * 100
                                                : null;
                                        return (
                                            <tr key={e.period} className="border-t border-gray-800/80">
                                                <td className="py-2 pr-3">
                                                    {e.periodLabel}
                                                    {e.endDate ? <span className="ml-1 text-xs text-gray-500">{e.endDate}</span> : null}
                                                </td>
                                                <td className="py-2 pr-3">
                                                    {fmtMoney(e.epsAvg)}
                                                    {e.epsAnalysts ? <span className="ml-1 text-xs text-gray-500">({e.epsAnalysts})</span> : null}
                                                </td>
                                                <td className={`py-2 pr-3 ${signClass(revision)}`}>{fmtPct(revision)}</td>
                                                <td className="py-2 pr-3">{fmtCompact(e.revenueAvg, '$')}</td>
                                                <td className={`py-2 pr-3 ${signClass(e.growth)}`}>{fmtRatioPct(e.growth)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {currentEstimate || currentYear || nextYear ? (
                            <p className="mt-2 text-xs text-gray-500">
                                EPS revisions compare today&apos;s consensus with the estimate 90 days ago. Positive revisions tend to precede upgrades.
                            </p>
                        ) : null}
                    </div>
                ) : null}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {research.ratingChanges.length > 0 ? (
                        <article className="rounded-xl border border-gray-800 bg-black/20 p-4">
                            <h3 className="text-base font-semibold text-white">Recent rating actions</h3>
                            <ul className="mt-3 divide-y divide-gray-800/80">
                                {research.ratingChanges.slice(0, 8).map((c, idx) => {
                                    const action = actionLabel(c);
                                    return (
                                        <li key={`${c.epoch}-${c.firm}-${idx}`} className="flex items-start justify-between gap-3 py-2 text-sm">
                                            <div>
                                                <p className="font-medium text-gray-100">{c.firm}</p>
                                                <p className="text-xs text-gray-400">
                                                    {c.fromGrade && c.fromGrade !== c.toGrade ? `${c.fromGrade} → ` : ''}
                                                    {c.toGrade}
                                                    {c.priceTarget ? ` · PT ${fmtMoney(c.priceTarget, 0)}` : ''}
                                                    {c.priorPriceTarget && c.priceTarget && c.priorPriceTarget !== c.priceTarget
                                                        ? ` (from ${fmtMoney(c.priorPriceTarget, 0)})`
                                                        : ''}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className={`text-xs font-semibold ${action.className}`}>{action.text}</p>
                                                <p className="text-xs text-gray-500">{fmtDate(c.date)}</p>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </article>
                    ) : null}

                    <div className="flex flex-col gap-4">
                        {research.surprises.length > 0 ? (
                            <article className="rounded-xl border border-gray-800 bg-black/20 p-4">
                                <h3 className="text-base font-semibold text-white">Earnings vs. consensus</h3>
                                <ul className="mt-3 divide-y divide-gray-800/80">
                                    {research.surprises.slice(0, 4).map((s) => (
                                        <li key={s.period} className="flex items-center justify-between py-2 text-sm">
                                            <span className="text-gray-300">{s.fiscalQuarter}</span>
                                            <span className="text-gray-400">
                                                {fmtMoney(s.actual)} vs {fmtMoney(s.estimate)}
                                            </span>
                                            <span className={`font-semibold ${signClass(s.surprisePct)}`}>{fmtPct(s.surprisePct)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </article>
                        ) : null}

                        {research.topHolders.length > 0 || research.ownership ? (
                            <article className="rounded-xl border border-gray-800 bg-black/20 p-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-base font-semibold text-white">Institutional ownership</h3>
                                    {research.ownership ? (
                                        <span className="text-xs text-gray-400">
                                            {fmtRatioPct(research.ownership.institutionsPct, 1, false)} institutions ·{' '}
                                            {fmtRatioPct(research.ownership.insidersPct, 2, false)} insiders
                                        </span>
                                    ) : null}
                                </div>
                                <ul className="mt-3 divide-y divide-gray-800/80">
                                    {research.topHolders.slice(0, 6).map((h) => (
                                        <li key={h.organization} className="flex items-center justify-between py-2 text-sm">
                                            <span className="truncate pr-3 text-gray-200">{h.organization}</span>
                                            <span className="shrink-0 text-gray-400">{fmtRatioPct(h.pctHeld, 2, false)}</span>
                                            <span className={`ml-3 w-16 shrink-0 text-right text-xs ${signClass(h.pctChange)}`}>
                                                {fmtRatioPct(h.pctChange)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                                <p className="mt-2 text-xs text-gray-500">Change column is the quarter-over-quarter position change from 13F filings.</p>
                            </article>
                        ) : null}
                    </div>
                </div>
            </div>
        </section>
    );
}
