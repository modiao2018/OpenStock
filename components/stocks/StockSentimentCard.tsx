import { getLocale, getTranslations } from 'next-intl/server';

import type { StockSentimentInsights } from '@/lib/actions/adanos.helpers';
import { isRedUpLocale } from '@/lib/utils';

interface StockSentimentCardProps {
    insight: StockSentimentInsights | null;
}

function formatScore(value: number | null, suffix: string): string {
    if (value === null) return 'N/A';
    return `${value.toFixed(1)}${suffix}`;
}

function formatCompactNumber(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(value);
}

// `redUp` follows the Chinese market convention: red = up/bullish, green = down/bearish
function getTrendClasses(trend: string | null, redUp: boolean): string {
    if (trend === 'rising') return redUp ? 'text-rose-400' : 'text-emerald-400';
    if (trend === 'falling') return redUp ? 'text-emerald-400' : 'text-rose-400';
    if (trend === 'stable') return 'text-amber-300';
    return 'text-gray-400';
}

function getAlignmentClasses(alignment: string, redUp: boolean): string {
    if (alignment === 'bullishAlignment') return redUp ? 'text-rose-400' : 'text-emerald-400';
    if (alignment === 'bearishAlignment') return redUp ? 'text-emerald-400' : 'text-rose-400';
    if (alignment === 'wideDivergence') return 'text-rose-400';
    if (alignment === 'tightAlignment') return 'text-blue-300';
    if (alignment === 'mixed') return 'text-amber-300';
    if (alignment === 'singleSource') return 'text-slate-300';
    if (alignment === 'noSentimentMix') return 'text-zinc-400';
    return 'text-gray-300';
}

export default async function StockSentimentCard({ insight }: StockSentimentCardProps) {
    if (!insight) {
        return null;
    }

    const t = await getTranslations('sentiment');
    const locale = await getLocale();
    const redUp = isRedUpLocale(locale);

    const trendLabel = (trend: string | null): string =>
        trend ? t(`trends.${trend}`) : t('noTrend');

    return (
        <section className="rounded-2xl border border-gray-800 bg-gray-950/40 p-5 backdrop-blur-sm">
            <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <p className="text-xs font-semibold text-gray-500">
                            {t('title')}
                        </p>
                        <h2 className="mt-2 text-xl font-semibold text-white">
                            {t('heading', { symbol: insight.symbol })}
                        </h2>
                        {insight.companyName ? (
                            <p className="mt-1 text-sm font-medium text-gray-300">
                                {insight.companyName}
                            </p>
                        ) : null}
                        <p className="mt-1 text-sm text-gray-400">
                            {t('description')}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-2xl border border-gray-800 bg-black/20 p-4 md:min-w-[320px]">
                        <div>
                            <p className="text-[11px] font-medium text-gray-500">
                                {t('avgBuzz')}
                            </p>
                            <p className="mt-1 text-lg font-semibold text-white">
                                {formatScore(insight.averageBuzz, '/100')}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium text-gray-500">
                                {t('bullishAvg')}
                            </p>
                            <p className="mt-1 text-lg font-semibold text-white">
                                {formatScore(insight.bullishAverage, '%')}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium text-gray-500">
                                {t('sourceAlignment')}
                            </p>
                            <p className={`mt-1 text-sm font-semibold ${getAlignmentClasses(insight.sourceAlignment, redUp)}`}>
                                {t(`alignment.${insight.sourceAlignment}`)}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium text-gray-500">
                                {t('coverage')}
                            </p>
                            <p className="mt-1 text-lg font-semibold text-white">
                                {insight.availableSources}/4
                            </p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {insight.sources.map((source) => (
                        <article
                            key={source.source}
                            className="rounded-xl border border-gray-800 bg-black/20 p-4"
                        >
                            <div className="flex items-center justify-between">
                                <h3 className="text-base font-semibold text-white">
                                    {t(`sources.${source.source}`)}
                                </h3>
                                <span className={`text-sm font-medium ${getTrendClasses(source.trend, redUp)}`}>
                                    {trendLabel(source.trend)}
                                </span>
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <div className="rounded-lg border border-gray-800 bg-black/20 p-3">
                                    <p className="text-[11px] font-medium text-gray-500">
                                        {t('buzz')}
                                    </p>
                                    <p className="mt-2 text-xl font-semibold text-white">
                                        {formatScore(source.buzzScore, '/100')}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-gray-800 bg-black/20 p-3">
                                    <p className="text-[11px] font-medium text-gray-500">
                                        {t('bullish')}
                                    </p>
                                    <p className="mt-2 text-xl font-semibold text-white">
                                        {formatScore(source.bullishPct, '%')}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-gray-800 bg-black/20 p-3">
                                    <p className="text-[11px] font-medium text-gray-500">
                                        {t(`metrics.${source.metricLabel}`)}
                                    </p>
                                    <p className="mt-2 text-xl font-semibold text-white">
                                        {formatCompactNumber(source.metricValue, locale)}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-gray-800 bg-black/20 p-3">
                                    <p className="text-[11px] font-medium text-gray-500">
                                        {t('trend')}
                                    </p>
                                    <p className={`mt-2 text-xl font-semibold ${getTrendClasses(source.trend, redUp)}`}>
                                        {source.trend ? t(`trends.${source.trend}`) : 'N/A'}
                                    </p>
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
}
