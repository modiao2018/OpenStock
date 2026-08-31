import React from 'react';
import { Bell, CalendarDays } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

// Decorative product collage for the auth page's right panel: a price chart,
// a mini heatmap using the real StockHeatmap ramps, a triggered alert toast,
// and a catalyst chip. Pure CSS/SVG — no screenshots to go stale.

// Mirrors components/StockHeatmap.tsx RED_RAMP / GREEN_RAMP
const TILES = [
    { symbol: 'NVDA', change: '+4.2%', color: '#089981', area: 'nvda' },
    { symbol: 'AAPL', change: '+1.6%', color: '#0f6b58', area: 'aapl' },
    { symbol: 'MSFT', change: '+0.8%', color: '#1c4a40', area: 'msft' },
    { symbol: 'TSM', change: '-2.3%', color: '#c0303c', area: 'tsm' },
    { symbol: 'META', change: '+0.5%', color: '#1c4a40', area: 'meta' },
];

const AuthShowcase = async () => {
    const t = await getTranslations('auth.layout');

    return (
        <div aria-hidden="true" className="relative flex-1 mt-2 lg:mt-8 max-lg:hidden select-none">
            {/* Ambient brand glow anchoring the collage */}
            <div className="absolute -top-16 right-0 h-96 w-96 rounded-full bg-teal-400/10 blur-3xl" />
            <div className="absolute bottom-8 left-8 h-72 w-72 rounded-full bg-teal-400/5 blur-3xl" />

            {/* Price chart — the anchor card */}
            <div className="absolute left-0 top-6 w-[68%] rounded-2xl border border-white/10 bg-gray-900/90 p-5 shadow-[0_20px_50px_-16px_rgba(0,0,0,0.6)]">
                <div className="flex items-baseline justify-between">
                    <div className="flex items-center gap-2.5">
                        <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-xs font-semibold text-gray-200">NVDA</span>
                        <span className="text-sm text-gray-400">NVIDIA</span>
                    </div>
                    <div className="flex items-baseline gap-2 tabular-nums">
                        <span className="text-xl font-semibold text-white">$954.20</span>
                        <span className="rounded-md bg-teal-400/10 px-1.5 py-0.5 text-sm font-medium text-teal-300">+4.17%</span>
                    </div>
                </div>
                <svg viewBox="0 0 400 160" className="mt-4 w-full" role="presentation">
                    <defs>
                        <linearGradient id="auth-chart-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#0FEDBE" stopOpacity="0.28" />
                            <stop offset="100%" stopColor="#0FEDBE" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    {[40, 80, 120].map((y) => (
                        <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                    ))}
                    <path
                        d="M0,122 C28,112 44,132 68,116 C94,98 110,120 136,102 C162,84 176,96 202,76 C226,60 242,80 266,58 C292,38 310,52 336,34 C356,20 376,30 396,20 L396,160 L0,160 Z"
                        fill="url(#auth-chart-fill)"
                    />
                    <path
                        d="M0,122 C28,112 44,132 68,116 C94,98 110,120 136,102 C162,84 176,96 202,76 C226,60 242,80 266,58 C292,38 310,52 336,34 C356,20 376,30 396,20"
                        fill="none"
                        stroke="#0FEDBE"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                    />
                    <circle cx="396" cy="20" r="7" fill="#0FEDBE" opacity="0.25" />
                    <circle cx="396" cy="20" r="3.5" fill="#0FEDBE" />
                </svg>
                <div className="mt-2 flex justify-between font-mono text-[10px] text-gray-500 tabular-nums">
                    <span>10:00</span><span>12:00</span><span>14:00</span><span>16:00</span>
                </div>
            </div>

            {/* Mini heatmap — overlaps the chart's right edge */}
            <div className="absolute right-0 top-40 z-10 w-[44%] rounded-2xl border border-white/10 bg-gray-900/95 p-4 shadow-[0_20px_50px_-16px_rgba(0,0,0,0.6)]">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('showcaseHeatmap')}</p>
                <div
                    className="grid gap-1"
                    style={{
                        gridTemplateColumns: '1.6fr 1fr 1fr',
                        gridTemplateRows: '64px 52px',
                        gridTemplateAreas: '"nvda aapl msft" "nvda tsm meta"',
                    }}
                >
                    {TILES.map((tile) => (
                        <div
                            key={tile.symbol}
                            className="flex flex-col items-center justify-center rounded-[4px] leading-tight"
                            style={{ gridArea: tile.area, backgroundColor: tile.color }}
                        >
                            <span className="text-xs font-bold text-white">{tile.symbol}</span>
                            <span className="text-[10px] text-white/90 tabular-nums">{tile.change}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Triggered alert — the single authored motion moment */}
            <div className="auth-alert-in absolute bottom-24 left-8 z-20 flex items-center gap-3 rounded-xl border border-teal-400/25 bg-gray-900 py-3 pl-3 pr-5 shadow-[0_16px_40px_-12px_rgba(15,237,190,0.25)]">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-400/15">
                    <Bell className="h-4.5 w-4.5 text-teal-400" />
                </span>
                <span>
                    <span className="block text-sm font-semibold text-white">{t('showcaseAlertTitle')}</span>
                    <span className="block text-xs text-gray-400 tabular-nums">{t('showcaseAlertBody')}</span>
                </span>
            </div>

            {/* Catalyst chip */}
            <div className="absolute bottom-10 right-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-gray-900/90 px-4 py-2 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.5)]">
                <CalendarDays className="h-4 w-4 text-teal-400" />
                <span className="text-xs text-gray-300">{t('showcaseCatalyst')}</span>
            </div>
        </div>
    );
};

export default AuthShowcase;
