'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Crosshair, TriangleAlert } from 'lucide-react';
import type { FocusRowData } from '@/lib/actions/focus.actions';
import type { FactorGroup, Lean, Stance } from '@/lib/focus-math';

const STANCE_CLASS: Record<Stance, string> = {
    bullish: 'bg-teal-900/50 text-teal-300',
    bearish: 'bg-red-900/50 text-red-300',
    mixed: 'bg-amber-900/50 text-amber-300',
    watch: 'bg-gray-800 text-gray-400',
};
const LEAN_CLASS: Record<Lean, string> = { bull: 'text-teal-400', bear: 'text-red-400', neutral: 'text-gray-300' };
const GROUP_ORDER: FactorGroup[] = ['setup', 'confirm', 'urgency'];

const fmtPct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

function ScoreBar({ score, threshold }: { score: number; threshold: number | null }) {
    const cls = threshold !== null && score >= threshold ? 'bg-teal-500' : score >= 30 ? 'bg-gray-400' : 'bg-gray-700';
    return (
        <div className="flex items-center gap-2">
            <div className="w-20 h-1.5 rounded bg-gray-800 overflow-hidden">
                <div className={`h-full ${cls}`} style={{ width: `${score}%` }} />
            </div>
            <span className="tabular-nums w-7 text-right font-medium text-gray-100">{score}</span>
        </div>
    );
}

export default function FocusQueue({ rows, threshold }: { rows: FocusRowData[]; threshold: number | null }) {
    const t = useTranslations('focus');
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [showAll, setShowAll] = useState(false);
    const visible = showAll ? rows : rows.filter((r) => r.score > 0);
    const hiddenCount = rows.length - visible.length;

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                    <Crosshair className="w-5 h-5 text-teal-500" />
                    <h2 className="text-lg font-semibold">{t('queue.title')}</h2>
                </div>
                {hiddenCount > 0 && !showAll && (
                    <button onClick={() => setShowAll(true)} className="text-xs text-gray-500 hover:text-gray-300">
                        {t('queue.showZero', { n: hiddenCount })}
                    </button>
                )}
            </div>
            <p className="text-xs text-gray-600 mb-4">{t('queue.hint')}</p>

            {visible.length === 0 ? (
                <p className="text-sm text-gray-500">{t('queue.empty')}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-gray-500">
                                <th className="pb-2 w-6" />
                                <th className="pb-2 font-normal">{t('col.symbol')}</th>
                                <th className="pb-2 font-normal">{t('col.score')}</th>
                                <th className="pb-2 font-normal">{t('col.stance')}</th>
                                <th className="pb-2 font-normal text-right">{t('col.close')}</th>
                                <th className="pb-2 font-normal text-right">{t('col.streak')}</th>
                                <th className="pb-2 font-normal text-right">{t('col.drawdown')}</th>
                                <th className="pb-2 font-normal">{t('col.catalyst')}</th>
                                <th className="pb-2 font-normal">{t('col.topFactors')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map((r, i) => {
                                const isOpen = Boolean(open[r.symbol]);
                                const crossesLine = threshold !== null && i > 0 && visible[i - 1].score >= threshold && r.score < threshold;
                                const top = r.factors.slice().sort((a, b) => b.points - a.points).slice(0, 3);
                                return (
                                    <FragmentRow key={r.symbol}>
                                        {crossesLine && (
                                            <tr>
                                                <td colSpan={9} className="py-1">
                                                    <div className="flex items-center gap-2 text-[10px] text-gray-600">
                                                        <div className="flex-1 border-t border-dashed border-gray-700" />
                                                        {t('queue.thresholdLine', { threshold })}
                                                        <div className="flex-1 border-t border-dashed border-gray-700" />
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                        <tr
                                            className="border-t border-gray-800/60 text-gray-300 hover:bg-gray-800/30 cursor-pointer"
                                            onClick={() => setOpen((o) => ({ ...o, [r.symbol]: !o[r.symbol] }))}
                                        >
                                            <td className="py-2 text-gray-600">{isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</td>
                                            <td className="py-2">
                                                <Link href={`/stocks/${r.symbol}`} onClick={(e) => e.stopPropagation()} className="font-medium text-gray-100 hover:text-teal-400">{r.symbol}</Link>
                                                <span className="ml-2 text-gray-500 hidden md:inline">{r.name}</span>
                                                <span className="ml-2 text-[10px] text-gray-600 uppercase">{t(`universe.${r.universe}`)}</span>
                                            </td>
                                            <td className="py-2"><ScoreBar score={r.score} threshold={threshold} /></td>
                                            <td className="py-2">
                                                <span className={`px-1.5 py-0.5 rounded ${STANCE_CLASS[r.stance]}`}>{t(`stance.${r.stance}`)}</span>
                                                {r.caution && (
                                                    <span className="ml-1 inline-flex items-center gap-0.5 text-amber-400" title={t('caution.notPulledBack')}>
                                                        <TriangleAlert className="w-3 h-3" />
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-2 text-right tabular-nums">{r.lastClose !== null ? `$${r.lastClose.toFixed(2)}` : '—'}</td>
                                            <td className="py-2 text-right tabular-nums">{r.streakDays ?? '—'}</td>
                                            <td className={`py-2 text-right tabular-nums ${r.drawdownFromHighPct !== null && r.drawdownFromHighPct <= -15 ? 'text-red-400' : ''}`}>{fmtPct(r.drawdownFromHighPct)}</td>
                                            <td className="py-2 text-gray-400 whitespace-nowrap">
                                                {r.nextCatalyst ? <span title={r.nextCatalyst.title}>{t('col.inDays', { n: r.nextCatalyst.days })}</span> : ''}
                                            </td>
                                            <td className="py-2 text-gray-500">
                                                {top.map((f) => (
                                                    <span key={f.id} className={`mr-2 ${LEAN_CLASS[f.lean]}`}>{t(`factors.${f.id}`)}{f.detail ? ` ${f.detail}` : ''}</span>
                                                ))}
                                            </td>
                                        </tr>
                                        {isOpen && (
                                            <tr className="bg-gray-950/60">
                                                <td />
                                                <td colSpan={8} className="py-3 pr-3">
                                                    <div className="grid gap-3 md:grid-cols-3">
                                                        {GROUP_ORDER.map((g) => {
                                                            const fs = r.factors.filter((f) => f.group === g);
                                                            return (
                                                                <div key={g}>
                                                                    <div className="text-[10px] uppercase tracking-wide text-gray-600 mb-1">{t(`group.${g}`)}</div>
                                                                    {fs.length === 0 ? (
                                                                        <div className="text-gray-700">—</div>
                                                                    ) : (
                                                                        fs.map((f) => (
                                                                            <div key={f.id} className="flex justify-between gap-2">
                                                                                <span className={LEAN_CLASS[f.lean]}>{t(`factors.${f.id}`)}{f.detail ? <span className="text-gray-500"> {f.detail}</span> : null}</span>
                                                                                <span className="tabular-nums text-gray-400">+{f.points}</span>
                                                                            </div>
                                                                        ))
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    <div className="mt-2 text-[10px] text-gray-600">
                                                        {t('detail.balance', { bull: r.bullPoints, bear: r.bearPoints })}
                                                        {r.caution && <span className="ml-2 text-amber-500">{t('caution.notPulledBack')}</span>}
                                                        <span className="ml-2">{t('detail.session', { date: r.sessionDate })}</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </FragmentRow>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// React fragments cannot take a key inside a table map without the long form
function FragmentRow({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
