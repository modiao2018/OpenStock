import type { EdgarFilingRef } from '@/lib/actions/edgar.actions';
import type { FundamentalPoint, FundamentalsSnapshot } from '@/lib/edgar';
import { yoyGrowth } from '@/lib/edgar';
import { fmtCompact, fmtDate, fmtMoney, fmtRatioPct, signClass } from './format';

interface FundamentalsCardProps {
    fundamentals: FundamentalsSnapshot | null;
    filings: EdgarFilingRef[];
}

function Metric({ label, point, format }: { label: string; point: FundamentalPoint | null; format: (v: number) => string }) {
    return (
        <div className="rounded-lg border border-gray-800 bg-black/20 p-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">{label}</p>
            <p className="mt-2 text-lg font-semibold text-white">{point ? format(point.value) : 'N/A'}</p>
            {point ? (
                <p className="text-xs text-gray-500">
                    {point.fiscalPeriod} FY{point.fiscalYear} · {point.form}
                </p>
            ) : null}
        </div>
    );
}

function Sparkline({ series }: { series: FundamentalPoint[] }) {
    const points = [...series].reverse();
    if (points.length < 2) return null;
    const max = Math.max(...points.map((p) => p.value));
    const min = Math.min(0, ...points.map((p) => p.value));
    const range = max - min || 1;
    return (
        <div className="flex h-16 items-end gap-1">
            {points.map((p) => (
                <div
                    key={p.periodEnd}
                    className={`flex-1 rounded-t ${p.value >= 0 ? 'bg-emerald-500/60' : 'bg-rose-500/60'}`}
                    style={{ height: `${Math.max(4, ((p.value - min) / range) * 100)}%` }}
                    title={`${p.periodEnd}: ${fmtCompact(p.value, '$')}`}
                />
            ))}
        </div>
    );
}

export default function FundamentalsCard({ fundamentals, filings }: FundamentalsCardProps) {
    if (!fundamentals && filings.length === 0) return null;

    const revenueYoy = fundamentals ? yoyGrowth(fundamentals.quarterlyRevenue) : null;
    const netIncomeYoy = fundamentals ? yoyGrowth(fundamentals.quarterlyNetIncome) : null;
    const debtToEquity =
        fundamentals?.longTermDebt && fundamentals.stockholdersEquity && fundamentals.stockholdersEquity.value > 0
            ? fundamentals.longTermDebt.value / fundamentals.stockholdersEquity.value
            : null;
    const netMargin =
        fundamentals?.netIncome && fundamentals.revenue && fundamentals.revenue.value > 0
            ? fundamentals.netIncome.value / fundamentals.revenue.value
            : null;

    return (
        <section className="rounded-2xl border border-gray-800 bg-gray-950/40 p-5 backdrop-blur-sm">
            <div className="flex flex-col gap-5">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">Reported Financials</p>
                    <h2 className="mt-2 text-xl font-semibold text-white">
                        {fundamentals?.entityName ?? 'SEC filings'}
                    </h2>
                    <p className="mt-1 text-sm text-gray-400">
                        As reported in XBRL-tagged 10-Q / 10-K filings on SEC EDGAR.
                        {fundamentals?.latestFiling
                            ? ` Latest: ${fundamentals.latestFiling.form} filed ${fmtDate(fundamentals.latestFiling.filed)}.`
                            : ''}
                    </p>
                </div>

                {fundamentals ? (
                    <>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            <Metric label="Revenue (Q)" point={fundamentals.revenue} format={(v) => fmtCompact(v, '$')} />
                            <Metric label="Net income (Q)" point={fundamentals.netIncome} format={(v) => fmtCompact(v, '$')} />
                            <Metric label="Diluted EPS (Q)" point={fundamentals.dilutedEps} format={(v) => fmtMoney(v)} />
                            <Metric label="Operating cash flow (Q)" point={fundamentals.operatingCashFlow} format={(v) => fmtCompact(v, '$')} />
                            <Metric label="Cash" point={fundamentals.cashAndEquivalents} format={(v) => fmtCompact(v, '$')} />
                            <Metric label="Long-term debt" point={fundamentals.longTermDebt} format={(v) => fmtCompact(v, '$')} />
                            <Metric label="Total assets" point={fundamentals.totalAssets} format={(v) => fmtCompact(v, '$')} />
                            <Metric label="Shareholders' equity" point={fundamentals.stockholdersEquity} format={(v) => fmtCompact(v, '$')} />
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <article className="rounded-xl border border-gray-800 bg-black/20 p-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-base font-semibold text-white">Quarterly revenue</h3>
                                    <span className={`text-sm font-semibold ${signClass(revenueYoy)}`}>{fmtRatioPct(revenueYoy)} YoY</span>
                                </div>
                                <div className="mt-3">
                                    <Sparkline series={fundamentals.quarterlyRevenue} />
                                </div>
                            </article>
                            <article className="rounded-xl border border-gray-800 bg-black/20 p-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-base font-semibold text-white">Quarterly net income</h3>
                                    <span className={`text-sm font-semibold ${signClass(netIncomeYoy)}`}>{fmtRatioPct(netIncomeYoy)} YoY</span>
                                </div>
                                <div className="mt-3">
                                    <Sparkline series={fundamentals.quarterlyNetIncome} />
                                </div>
                            </article>
                        </div>

                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400">
                            <span>Net margin: <span className="text-gray-200">{fmtRatioPct(netMargin, 1, false)}</span></span>
                            <span>LT debt / equity: <span className="text-gray-200">{debtToEquity !== null ? debtToEquity.toFixed(2) : 'N/A'}</span></span>
                            <span>Shares outstanding: <span className="text-gray-200">{fmtCompact(fundamentals.sharesOutstanding?.value)}</span></span>
                        </div>
                    </>
                ) : null}

                {filings.length > 0 ? (
                    <div className="rounded-xl border border-gray-800 bg-black/20 p-4">
                        <h3 className="text-base font-semibold text-white">Recent material filings</h3>
                        <ul className="mt-3 divide-y divide-gray-800/80">
                            {filings.map((f) => (
                                <li key={f.accessionNumber} className="flex items-center justify-between py-2 text-sm">
                                    <a
                                        href={f.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-medium text-gray-100 hover:text-white hover:underline"
                                    >
                                        {f.form}
                                        <span className="ml-2 text-xs font-normal text-gray-500">{f.description !== f.form ? f.description : ''}</span>
                                    </a>
                                    <span className="text-xs text-gray-400">
                                        filed {fmtDate(f.filingDate)}
                                        {f.reportDate && f.reportDate !== f.filingDate ? ` · event ${fmtDate(f.reportDate)}` : ''}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
