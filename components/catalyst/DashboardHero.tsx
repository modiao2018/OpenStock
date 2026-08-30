import React from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { DashboardOverview } from '@/lib/actions/catalyst.actions';

const RUNWAY_DAYS = 90;

/**
 * 签名元素：下一个催化剂的倒计时头条 + 未来 90 天跑道。
 * 医药催化剂投资的本质是等待有日期的二元事件——页面开门见山回答"还有几天"。
 */
export default async function DashboardHero({ overview }: { overview: DashboardOverview }) {
    const t = await getTranslations('catalyst.hero');

    if (!overview.hero) {
        return (
            <div className="border border-gray-800 rounded-xl p-6 mb-6 bg-gray-900/40">
                <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">{t('eyebrow')}</p>
                <p className="text-gray-400">{t('empty')}</p>
            </div>
        );
    }

    const { hero, runway } = overview;
    const locale = await getLocale();
    const weekday = new Date(hero.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short' });

    return (
        <div className="border border-gray-800 rounded-xl px-6 pt-5 pb-4 mb-6 bg-gradient-to-r from-teal-950/40 via-gray-900/40 to-gray-900/40">
            <p className="text-xs uppercase tracking-widest text-teal-500 mb-2">{t('eyebrow')}</p>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span className="text-5xl font-bold tracking-tight text-gray-50 tabular-nums">
                    T-{hero.days}
                    <span className="text-xl font-normal text-gray-500 ml-1">{t('days')}</span>
                </span>
                <span className="text-lg text-gray-200">
                    <span className="font-semibold text-teal-300">{hero.symbol}</span>
                    <span className="mx-2 text-gray-600">·</span>
                    {hero.title}
                </span>
                <span className="text-sm text-gray-500 tabular-nums">
                    {hero.date}（{weekday}）
                </span>
            </div>

            {/* 跑道：未来 90 天时间轴，7 天内的催化剂点亮为琥珀色 */}
            <div className="mt-4">
                <svg viewBox="0 0 800 46" className="w-full h-12" role="img" aria-label={t('runwayLabel')}>
                    <line x1="16" y1="14" x2="784" y2="14" stroke="#1f2937" strokeWidth="2" />
                    <line x1="784" y1="14" x2="776" y2="10" stroke="#1f2937" strokeWidth="2" />
                    <line x1="784" y1="14" x2="776" y2="18" stroke="#1f2937" strokeWidth="2" />
                    {[0, 30, 60, 90].map((d) => (
                        <g key={d}>
                            <line x1={16 + (d / RUNWAY_DAYS) * 760} y1="10" x2={16 + (d / RUNWAY_DAYS) * 760} y2="18" stroke="#374151" strokeWidth="1" />
                            <text x={16 + (d / RUNWAY_DAYS) * 760} y="30" textAnchor="middle" fontSize="9" fill="#4b5563">
                                {d === 0 ? t('today') : `+${d}d`}
                            </text>
                        </g>
                    ))}
                    {runway.map((c, i) => {
                        const x = 16 + (Math.min(c.days, RUNWAY_DAYS) / RUNWAY_DAYS) * 760;
                        const near = c.days <= 7;
                        return (
                            <g key={`${c.symbol}-${c.date}-${i}`}>
                                <circle cx={x} cy="14" r={near ? 5 : 4} fill={near ? '#fbbf24' : '#2dd4bf'} stroke="#000" strokeWidth="2">
                                    <title>{`${c.symbol} ${c.title} · ${c.date}（T-${c.days}）`}</title>
                                </circle>
                                {i < 3 && (
                                    <text x={x} y={i % 2 === 0 ? 42 : 6} textAnchor="middle" fontSize="9" fill="#9ca3af">
                                        {c.symbol} T-{c.days}
                                    </text>
                                )}
                            </g>
                        );
                    })}
                </svg>
            </div>
        </div>
    );
}
