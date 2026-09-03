import { getTranslations } from 'next-intl/server';
import { Target } from 'lucide-react';
import { HORIZON_KEYS, MIN_SAMPLES, type HorizonStats, type ScoreRow } from '@/lib/signal-math';

const fmtPct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const pctClass = (v: number | null) => (v === null ? 'text-gray-600' : v > 0 ? 'text-teal-400' : v < 0 ? 'text-red-400' : 'text-gray-300');

function HitCell({ h, directional }: { h: HorizonStats; directional: boolean }) {
    if (h.n === 0) return <span className="text-gray-700">—</span>;
    if (!directional) return <span className="text-gray-500" title="无方向信号只看波动幅度">±{h.avgAbsExcessPct?.toFixed(1)}%</span>;
    if (h.hitRate === null) return <span className="text-gray-600" title={`样本 < ${MIN_SAMPLES}`}>n&lt;{MIN_SAMPLES}</span>;
    const pct = h.hitRate * 100;
    const cls = pct >= 60 ? 'text-teal-400' : pct <= 40 ? 'text-red-400' : 'text-gray-200';
    return <span className={cls}>{pct.toFixed(0)}%</span>;
}

interface Props {
    title: string;
    hint: string;
    rows: ScoreRow[];
    labelKind: 'kind' | 'action';
}

export default async function Scorecard({ title, hint, rows, labelKind }: Props) {
    const t = await getTranslations('signals');

    const label = (key: string) => {
        if (labelKind === 'action') return key;
        return t.has(`kinds.${key}`) ? t(`kinds.${key}`) : key;
    };

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <div className="flex items-center gap-2 mb-1">
                <Target className="w-5 h-5 text-teal-500" />
                <h2 className="text-lg font-semibold">{title}</h2>
            </div>
            <p className="text-xs text-gray-600 mb-4">{hint}</p>

            {rows.length === 0 ? (
                <p className="text-sm text-gray-500">{t('empty')}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-gray-500">
                                <th className="pb-2 font-normal">{t('col.signal')}</th>
                                <th className="pb-2 font-normal text-right">{t('col.n')}</th>
                                <th className="pb-2 font-normal text-right">{t('col.direction')}</th>
                                {HORIZON_KEYS.map((k) => (
                                    <th key={k} className="pb-2 font-normal text-right" colSpan={2}>
                                        <span className="uppercase">{k}</span>
                                        <span className="ml-1 text-gray-600">{t('col.hitExcess')}</span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const directional = r.directions.up + r.directions.down > 0;
                                return (
                                    <tr key={r.key} className="border-t border-gray-800/60 text-gray-300">
                                        <td className="py-2 font-medium text-gray-100">{label(r.key)}</td>
                                        <td className="py-2 text-right tabular-nums">{r.total}</td>
                                        <td className="py-2 text-right text-gray-500">
                                            {r.directions.up > 0 && <span className="text-teal-500">↑{r.directions.up}</span>}
                                            {r.directions.down > 0 && <span className="ml-1 text-red-400">↓{r.directions.down}</span>}
                                            {r.directions.none > 0 && <span className="ml-1">·{r.directions.none}</span>}
                                        </td>
                                        {HORIZON_KEYS.map((k) => {
                                            const h = r.horizons[k];
                                            return (
                                                <HorizonCells key={k} h={h} directional={directional} />
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function HorizonCells({ h, directional }: { h: HorizonStats; directional: boolean }) {
    return (
        <>
            <td className="py-2 text-right tabular-nums pl-4">
                <HitCell h={h} directional={directional} />
            </td>
            <td className={`py-2 text-right tabular-nums ${pctClass(h.n ? h.avgExcessPct : null)}`} title={h.n ? `中位数 ${fmtPct(h.medianExcessPct)} · 绝对收益 ${fmtPct(h.avgReturnPct)}` : undefined}>
                {h.n ? fmtPct(h.avgExcessPct) : ''}
                {h.n > 0 && <span className="ml-1 text-gray-600">({h.n})</span>}
            </td>
        </>
    );
}
