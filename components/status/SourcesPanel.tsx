'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Loader2, Radar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { probeSourceAction, type SourceStatusRow } from '@/lib/actions/sources.actions';
import type { SourceGroup } from '@/lib/sources-registry';
import type { SourceLevel } from '@/lib/source-stats-math';
import { formatClock } from '@/lib/format-time';

const GROUP_ORDER: SourceGroup[] = ['quotes', 'filings', 'clinical', 'ai', 'other'];

const DOT: Record<SourceLevel, string> = {
    ok: 'bg-teal-400',
    warn: 'bg-amber-400',
    down: 'bg-red-400',
    idle: 'bg-gray-600',
    unconfigured: 'bg-gray-700',
};

const LEVEL_TEXT: Record<SourceLevel, string> = {
    ok: 'text-teal-400',
    warn: 'text-amber-400',
    down: 'text-red-400',
    idle: 'text-gray-500',
    unconfigured: 'text-gray-600',
};

function formatTime(ms: number | null, locale: string): string {
    return ms ? formatClock(ms, locale) : '—';
}

const formatLatency = (v: number | null) => (v === null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

export default function SourcesPanel({ rows }: { rows: SourceStatusRow[] }) {
    const t = useTranslations('status.sources');
    const tFeat = useTranslations('status.features');
    const locale = useLocale();
    const router = useRouter();
    const [probing, setProbing] = useState<string | null>(null);
    const [probingAll, setProbingAll] = useState(false);
    const [open, setOpen] = useState<Set<string>>(new Set());

    const probe = async (id: string, name: string) => {
        setProbing(id);
        try {
            const r = await probeSourceAction(id);
            if (r.ok) toast.success(`${name}: ${t('probeOk', { ms: r.latencyMs })}`);
            else toast.error(`${name}: ${t('probeFail', { error: r.error ?? '' })}`);
        } catch {
            toast.error(`${name}: ${t('probeFail', { error: '' })}`);
        } finally {
            setProbing(null);
        }
    };

    const probeAll = async () => {
        setProbingAll(true);
        try {
            const targets = rows.flatMap((r) => (r.children ? r.children : [r])).filter((r) => r.probeable);
            let ok = 0;
            for (const r of targets) {
                const res = await probeSourceAction(r.id);
                if (res.ok) ok++;
            }
            toast.success(t('probeAllDone', { ok, total: targets.length }));
            router.refresh();
        } finally {
            setProbingAll(false);
        }
    };

    const toggle = (id: string) =>
        setOpen((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const renderRow = (r: SourceStatusRow, child = false) => {
        const rate = r.window24h.okRate;
        return (
            <tr key={r.id} className={`border-t border-gray-800/60 ${child ? 'bg-gray-950/40' : ''}`}>
                <td className={`py-2.5 pr-3 ${child ? 'pl-8' : 'pl-3'}`}>
                    <div className="flex items-center gap-2">
                        {r.children && r.children.length > 0 ? (
                            <button type="button" onClick={() => toggle(r.id)} className="cursor-pointer text-gray-500 hover:text-gray-300" aria-label={t('expand')}>
                                {open.has(r.id) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </button>
                        ) : (
                            <span className="w-3.5" />
                        )}
                        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[r.level]}`} />
                        <div className="min-w-0">
                            <div className="text-sm text-gray-100">{r.name}</div>
                            <div className="text-[11px] text-gray-600 truncate" title={r.host}>{r.host}</div>
                        </div>
                    </div>
                </td>
                <td className={`py-2.5 pr-3 text-xs ${LEVEL_TEXT[r.level]}`}>{t(`level.${r.level}`)}</td>
                <td className="py-2.5 pr-3 text-xs">
                    {r.keyless ? (
                        <span className="text-gray-600">{t('keyNotNeeded')}</span>
                    ) : r.configured ? (
                        <span className="text-teal-400">{t('keyConfigured')}</span>
                    ) : (
                        <span className="text-gray-500">{t('keyMissing')}</span>
                    )}
                </td>
                <td className="py-2.5 pr-3 text-right text-xs tabular-nums">
                    {rate === null ? (
                        <span className="text-gray-600">—</span>
                    ) : (
                        <span className={rate < 0.9 ? 'text-amber-400' : 'text-gray-200'}>
                            {(rate * 100).toFixed(rate === 1 ? 0 : 1)}%
                            <span className="ml-1 text-gray-600">/ {r.window24h.calls}</span>
                        </span>
                    )}
                </td>
                <td className="py-2.5 pr-3 text-right text-xs tabular-nums text-gray-300">{formatLatency(r.window24h.avgLatencyMs)}</td>
                <td className="hidden lg:table-cell py-2.5 pr-3 text-xs text-gray-400 tabular-nums">{formatTime(r.lastOkAt, locale)}</td>
                <td className="hidden lg:table-cell py-2.5 pr-3 text-xs tabular-nums">
                    <span className={r.consecutiveFails > 0 ? 'text-red-400' : 'text-gray-500'}>
                        {formatTime(r.lastFailAt, locale)}
                        {r.consecutiveFails > 0 && ` ×${r.consecutiveFails}`}
                    </span>
                    {r.lastError && (
                        <p className="max-w-[220px] truncate text-[11px] text-red-400/70" title={r.lastError}>{r.lastError}</p>
                    )}
                </td>
                <td className="hidden xl:table-cell py-2.5 pr-3">
                    <div className="flex flex-wrap gap-1">
                        {r.usedBy.map((f) => (
                            <span key={f} className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">{tFeat(f)}</span>
                        ))}
                    </div>
                </td>
                <td className="py-2.5 pr-3 text-right">
                    {r.children ? null : r.probeable ? (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => probe(r.id, r.name)}
                            disabled={probing !== null || probingAll}
                            className="h-7 border-gray-700 text-xs text-gray-300"
                        >
                            {probing === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : t('probe')}
                        </Button>
                    ) : (
                        <span className="text-[11px] text-gray-600">{r.configured ? t('passive') : ''}</span>
                    )}
                </td>
            </tr>
        );
    };

    return (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Radar className="w-5 h-5 text-teal-500" />
                    {t('title')}
                </h2>
                <Button size="sm" variant="outline" onClick={probeAll} disabled={probingAll || probing !== null} className="border-gray-700 text-gray-200">
                    {probingAll ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                    {t('probeAll')}
                </Button>
            </div>
            <p className="text-xs text-gray-600 mb-4">{t('hint')}</p>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                    <thead>
                        <tr className="text-left text-xs text-gray-500">
                            <th className="pb-2 pl-3 pr-3 font-normal">{t('col.source')}</th>
                            <th className="pb-2 pr-3 font-normal">{t('col.status')}</th>
                            <th className="pb-2 pr-3 font-normal">{t('col.key')}</th>
                            <th className="pb-2 pr-3 font-normal text-right">{t('col.rate24h')}</th>
                            <th className="pb-2 pr-3 font-normal text-right">{t('col.latency')}</th>
                            <th className="hidden lg:table-cell pb-2 pr-3 font-normal">{t('col.lastOk')}</th>
                            <th className="hidden lg:table-cell pb-2 pr-3 font-normal">{t('col.lastFail')}</th>
                            <th className="hidden xl:table-cell pb-2 pr-3 font-normal">{t('col.usedBy')}</th>
                            <th className="pb-2 pr-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {GROUP_ORDER.map((g) => {
                            const groupRows = rows.filter((r) => r.group === g);
                            if (groupRows.length === 0) return null;
                            return (
                                <Fragment key={g}>
                                    <tr>
                                        <td colSpan={9} className="pt-4 pb-1 pl-3 text-xs uppercase tracking-wide text-gray-500">
                                            {t(`group.${g}`)}
                                        </td>
                                    </tr>
                                    {groupRows.map((r) => (
                                        <Fragment key={r.id}>
                                            {renderRow(r)}
                                            {open.has(r.id) && r.children?.map((c) => renderRow(c, true))}
                                        </Fragment>
                                    ))}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
