import React from 'react';
import { isRedUpLocale } from '@/lib/utils';

/** 生物科技前沿各组件共用的小件：重要度星级、事件类型配色、涨跌配色 */

export const TYPE_BADGE: Record<string, string> = {
    approval: 'bg-emerald-900/50 text-emerald-300',
    rejection: 'bg-rose-900/50 text-rose-300',
    adcom: 'bg-sky-900/50 text-sky-300',
    deal: 'bg-purple-900/50 text-purple-300',
    acquisition: 'bg-fuchsia-900/50 text-fuchsia-300',
    financing: 'bg-indigo-900/50 text-indigo-300',
    'trial-start': 'bg-blue-900/50 text-blue-300',
    data: 'bg-amber-900/50 text-amber-300',
    'ai-milestone': 'bg-teal-900/60 text-teal-300',
    regulatory: 'bg-cyan-900/50 text-cyan-300',
    policy: 'bg-orange-900/50 text-orange-300',
    research: 'bg-lime-900/40 text-lime-300',
    other: 'bg-gray-800 text-gray-300',
};

export function Stars({ n }: { n: number | null }) {
    const v = n ?? 0;
    return (
        <span className="tabular-nums text-xs tracking-tight" aria-label={`${v}/5`}>
            <span className={v >= 4 ? 'text-amber-400' : 'text-gray-400'}>{'★'.repeat(v)}</span>
            <span className="text-gray-700">{'★'.repeat(Math.max(0, 5 - v))}</span>
        </span>
    );
}

/** 方向色：中文界面红涨绿跌，英文界面绿涨红跌 */
export function directionClass(value: number | null | undefined, locale: string): string {
    if (value === null || value === undefined || value === 0) return 'text-gray-400';
    const up = value > 0;
    if (isRedUpLocale(locale)) return up ? 'text-red-400' : 'text-green-400';
    return up ? 'text-green-400' : 'text-red-400';
}

export function fmtPct(v: number | null | undefined): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

/** 看多/看空徽章：同样遵循红涨绿跌 */
export function stanceClass(stance: string, locale: string): string {
    if (stance === 'bullish') return isRedUpLocale(locale) ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300';
    if (stance === 'bearish') return isRedUpLocale(locale) ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300';
    return 'bg-gray-800 text-gray-300';
}

export function beijingDay(iso: string, locale: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return iso;
    const d = new Date(t + 8 * 3600_000);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toLocaleDateString(locale, {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
        timeZone: 'UTC',
    });
}

export function Card({ title, icon, hint, actions, children }: { title: React.ReactNode; icon?: React.ReactNode; hint?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
            <div className="flex items-start justify-between gap-3 mb-1">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    {icon}
                    {title}
                </h2>
                {actions}
            </div>
            {hint && <p className="text-xs text-gray-600 mb-3 leading-relaxed">{hint}</p>}
            {children}
        </div>
    );
}
