'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarClock, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
    addCustomCatalyst,
    deleteCustomCatalyst,
    type CatalystTrialData,
    type CustomCatalystData,
    type CustomCatalystKind,
} from '@/lib/actions/catalyst.actions';

const KINDS: CustomCatalystKind[] = ['data-readout', 'pdufa', 'adcom', 'earnings', 'conference', 'other'];

interface AgendaEntry {
    key: string;
    date: string; // YYYY-MM-DD；未知日期用 '9999-12'
    symbol: string;
    title: string;
    chip: string;
    isCustom: boolean;
    customId?: string;
    auto?: boolean;
    note?: string;
    url?: string;
    statusKey?: string;
}

function phaseDigits(phase: string): string {
    return phase.split('/').map((p) => p.replace('EARLY_PHASE', '早期').replace('PHASE', '')).filter(Boolean).join('/') || phase;
}

/** 催化剂日程：自定义催化剂与试验日期合并成按月分组的时间议程 */
export default function CatalystAgenda({
    customEvents,
    trials,
}: {
    customEvents: CustomCatalystData[];
    trials: CatalystTrialData[];
}) {
    const t = useTranslations('catalyst.calendar');
    const tCustom = useTranslations('catalyst.custom');
    const tStatus = useTranslations('catalyst.status');
    const locale = useLocale();
    const router = useRouter();

    const [open, setOpen] = useState(false);
    const [symbol, setSymbol] = useState('');
    const [title, setTitle] = useState('');
    const [date, setDate] = useState('');
    const [kind, setKind] = useState<CustomCatalystKind>('data-readout');
    const [saving, setSaving] = useState(false);

    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    const groups = useMemo(() => {
        const entries: AgendaEntry[] = [];
        for (const c of customEvents) {
            entries.push({
                key: `c-${c.id}`,
                date: c.date,
                symbol: c.symbol,
                title: c.title,
                chip: tCustom(`kind.${c.kind}`),
                isCustom: true,
                customId: c.id,
                auto: c.source === 'auto',
                note: c.note,
            });
        }
        for (const tr of trials) {
            const d = tr.primaryCompletionDate;
            const iso = d && /^\d{4}-\d{2}$/.test(d) ? `${d}-01` : d;
            entries.push({
                key: `t-${tr.nctId}`,
                date: iso ?? '9999-12-31',
                symbol: tr.symbol,
                title: tr.title,
                chip: t('phase', { phases: phaseDigits(tr.phase) }),
                isCustom: false,
                url: `https://clinicaltrials.gov/study/${tr.nctId}`,
                statusKey: tr.overallStatus,
                note: tr.nctId,
            });
        }
        entries.sort((a, b) => a.date.localeCompare(b.date));

        const byMonth = new Map<string, AgendaEntry[]>();
        for (const e of entries) {
            const month =
                e.date >= '9999'
                    ? t('undated')
                    : new Date(e.date + 'T00:00:00').toLocaleDateString(locale, { year: 'numeric', month: 'long' });
            if (!byMonth.has(month)) byMonth.set(month, []);
            byMonth.get(month)!.push(e);
        }
        return [...byMonth.entries()];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customEvents, trials, locale]);

    const handleAdd = async () => {
        setSaving(true);
        try {
            await addCustomCatalyst({ symbol, title, date, kind });
            setOpen(false);
            setSymbol('');
            setTitle('');
            setDate('');
            router.refresh();
        } catch {
            toast.error(tCustom('addFailed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <CalendarClock className="w-5 h-5 text-teal-500" />
                    {t('title')}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-teal-400 h-7 px-2">
                    <Plus className="w-4 h-4 mr-0.5" />
                    {tCustom('add')}
                </Button>
            </div>
            <p className="text-xs text-gray-600 mb-4">{t('hint')}</p>

            {groups.length === 0 ? (
                <p className="text-gray-500 text-sm">{t('empty')}</p>
            ) : (
                <div className="space-y-4">
                    {groups.map(([month, entries]) => (
                        <div key={month}>
                            <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2 sticky top-0">{month}</h3>
                            <ul className="space-y-2.5">
                                {entries.map((e) => {
                                    const days = e.date < '9999' ? Math.ceil((Date.parse(e.date) - now) / 86_400_000) : null;
                                    const past = e.date < today;
                                    return (
                                        <li key={e.key} className="flex items-start gap-2.5">
                                            <span
                                                className={`shrink-0 w-14 text-right tabular-nums text-sm font-medium ${
                                                    past ? 'text-gray-700' : days !== null && days <= 7 ? 'text-amber-400' : 'text-teal-400'
                                                }`}
                                            >
                                                {days === null ? '—' : past ? t('past') : `T-${days}`}
                                            </span>
                                            <div className="min-w-0 flex-1 border-l border-gray-800 pl-2.5">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="text-sm font-medium text-gray-200">{e.symbol}</span>
                                                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{e.chip}</span>
                                                    {e.auto && (
                                                        <span className="text-xs text-teal-500/80 flex items-center gap-0.5" title={e.note}>
                                                            <Sparkles className="w-3 h-3" />
                                                            {tCustom('auto')}
                                                        </span>
                                                    )}
                                                    {e.statusKey && (
                                                        <span className="text-xs text-gray-600">
                                                            {tStatus.has(e.statusKey) ? tStatus(e.statusKey) : e.statusKey}
                                                        </span>
                                                    )}
                                                    <span className="text-xs text-gray-600 tabular-nums ml-auto">{e.date < '9999' ? e.date : ''}</span>
                                                    {e.isCustom && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-5 w-5 p-0"
                                                            onClick={async () => {
                                                                await deleteCustomCatalyst(e.customId!);
                                                                router.refresh();
                                                            }}
                                                        >
                                                            <Trash2 className="w-3 h-3 text-gray-600 hover:text-red-400" />
                                                        </Button>
                                                    )}
                                                </div>
                                                {e.url ? (
                                                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-teal-400 line-clamp-1 block mt-0.5">
                                                        {e.title}
                                                    </a>
                                                ) : (
                                                    <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{e.title}</p>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{tCustom('dialogTitle')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="ag-symbol">{tCustom('symbol')}</Label>
                                <Input id="ag-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="ABCL" className="bg-gray-800 border-gray-700" />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="ag-date">{tCustom('date')}</Label>
                                <Input id="ag-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-gray-800 border-gray-700" />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="ag-kind">{tCustom('kindLabel')}</Label>
                            <select id="ag-kind" value={kind} onChange={(e) => setKind(e.target.value as CustomCatalystKind)} className="w-full h-9 rounded-md bg-gray-800 border border-gray-700 px-3 text-sm text-gray-100">
                                {KINDS.map((k) => (
                                    <option key={k} value={k}>{tCustom(`kind.${k}`)}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="ag-title">{tCustom('eventTitle')}</Label>
                            <Input id="ag-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tCustom('titlePlaceholder')} className="bg-gray-800 border-gray-700" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setOpen(false)}>{tCustom('cancel')}</Button>
                        <Button onClick={handleAdd} disabled={saving || !symbol.trim() || !title.trim() || !date} className="bg-teal-600 hover:bg-teal-500 text-white">
                            {tCustom('save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
