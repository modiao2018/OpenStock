import React from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { isRedUpLocale } from '@/lib/utils';
import type { SymbolTileData } from '@/lib/actions/catalyst.actions';

function Sparkline({ points, up, redUp }: { points: number[]; up: boolean; redUp: boolean }) {
    if (points.length < 2) return <div className="h-9" />;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const w = 120;
    const h = 36;
    const coords = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - 4 - ((p - min) / range) * (h - 8)}`);
    // 中国惯例红涨绿跌；英文界面自动反转
    const color = up === redUp ? '#f87171' : '#4ade80';
    const [lastX, lastY] = coords[coords.length - 1].split(',');
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={coords.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
            <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
        </svg>
    );
}

/** 标的速览瓦片：收盘 · 当日涨跌 · 当日走势火花线 · 异动σ · 下一催化剂倒计时 */
export default async function SymbolTiles({ tiles }: { tiles: SymbolTileData[] }) {
    const t = await getTranslations('catalyst.tiles');
    const redUp = isRedUpLocale(await getLocale());
    if (tiles.length === 0) return null;

    return (
        <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {tiles.map((tile) => {
                const up = (tile.dayChangePct ?? 0) >= 0;
                const changeColor =
                    tile.dayChangePct === undefined
                        ? 'text-gray-500'
                        : up === redUp
                          ? 'text-red-400'
                          : 'text-green-400';
                return (
                    <div key={tile.symbol} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                        <div className="flex items-baseline justify-between">
                            <div className="min-w-0">
                                <span className="font-semibold text-gray-100">{tile.symbol}</span>
                                <span className="ml-2 text-xs text-gray-600 truncate">{tile.company}</span>
                            </div>
                            {tile.z !== undefined && (
                                <span
                                    className={`text-xs tabular-nums ${Math.abs(tile.z) >= 2 ? 'text-amber-400' : 'text-gray-600'}`}
                                    title={t('zTitle')}
                                >
                                    {tile.z > 0 ? '+' : ''}
                                    {tile.z}σ
                                </span>
                            )}
                        </div>

                        <div className="flex items-baseline gap-2 mt-1.5">
                            <span className="text-2xl font-semibold text-gray-50 tabular-nums">
                                {tile.lastClose !== undefined ? `$${tile.lastClose.toFixed(2)}` : '—'}
                            </span>
                            <span className={`text-sm tabular-nums ${changeColor}`}>
                                {tile.dayChangePct !== undefined
                                    ? `${tile.dayChangePct > 0 ? '+' : ''}${tile.dayChangePct}%`
                                    : t('noData')}
                            </span>
                        </div>

                        <div className="mt-1" title={t('sparkTitle')}>
                            <Sparkline points={tile.spark} up={up} redUp={redUp} />
                        </div>

                        <div className="mt-1.5 text-xs">
                            {tile.nextCatalyst ? (
                                <span className={tile.nextCatalyst.days <= 7 ? 'text-amber-400' : 'text-gray-500'}>
                                    <span className="tabular-nums font-medium">T-{tile.nextCatalyst.days}</span>
                                    <span className="mx-1 text-gray-700">·</span>
                                    <span className="text-gray-500">{tile.nextCatalyst.title.slice(0, 24)}</span>
                                </span>
                            ) : (
                                <span className="text-gray-700">{t('noCatalyst')}</span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
