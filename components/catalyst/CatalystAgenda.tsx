'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarClock, ChevronLeft, ChevronRight, List, Plus, Sparkles, Trash2 } from 'lucide-react';
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
    date: string; // YYYY-MM-DD；未知日期用 '9999-12-31'
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

function isoOf(y: number, m: number, d: number): string {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 催化剂日程：月历 / 列表双视图，自定义催化剂与试验日期合并展示 */
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

    const [view, setView] = useState<'calendar' | 'list'>('calendar');
    const [showTrials, setShowTrials] = useState(true);

    // 最早的未来催化剂日：月历初始定位 + 默认展开明细，打开即有内容
    const today0 = new Date().toISOString().slice(0, 10);
    const firstUpcoming = [
        ...customEvents.map((c) => c.date),
        ...trials.map((tr) => {
            const d = tr.primaryCompletionDate;
            return d && /^\d{4}-\d{2}$/.test(d) ? `${d}-01` : d;
        }),
    ]
        .filter((d): d is string => !!d && d >= today0 && d < '9999')
        .sort()[0];

    const [monthCursor, setMonthCursor] = useState(() => {
        const base = firstUpcoming ? new Date(firstUpcoming + 'T00:00:00') : new Date();
        return { y: base.getFullYear(), m: base.getMonth() };
    });
    const [selectedDay, setSelectedDay] = useState<string | null>(firstUpcoming ?? null);

    const [open, setOpen] = useState(false);
    const [symbol, setSymbol] = useState('');
    const [title, setTitle] = useState('');
    const [date, setDate] = useState('');
    const [kind, setKind] = useState<CustomCatalystKind>('data-readout');
    const [saving, setSaving] = useState(false);

    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    const entries = useMemo(() => {
        const out: AgendaEntry[] = [];
        for (const c of customEvents) {
            out.push({
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
        if (showTrials)
            for (const tr of trials) {
                const d = tr.primaryCompletionDate;
                const iso = d && /^\d{4}-\d{2}$/.test(d) ? `${d}-01` : d;
                out.push({
                    key: `t-${tr.nctId}`,
                    date: iso ?? '9999-12-31',
                    symbol: tr.symbol,
                    // 中文界面优先显示 AI 翻译的标题，原文可通过链接核对
                    title: locale.startsWith('zh') ? (tr.titleZh ?? tr.title) : tr.title,
                    chip: t('phase', { phases: phaseDigits(tr.phase) }),
                    isCustom: false,
                    url: `https://clinicaltrials.gov/study/${tr.nctId}`,
                    statusKey: tr.overallStatus,
                    note: tr.nctId,
                });
            }
        // 同日先显示自定义催化剂（信息最准），试验注册日期垫后
        out.sort((a, b) => a.date.localeCompare(b.date) || Number(b.isCustom) - Number(a.isCustom));
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customEvents, trials, showTrials, locale]);

    const byDate = useMemo(() => {
        const m = new Map<string, AgendaEntry[]>();
        for (const e of entries) {
            if (e.date >= '9999') continue;
            if (!m.has(e.date)) m.set(e.date, []);
            m.get(e.date)!.push(e);
        }
        return m;
    }, [entries]);

    const listGroups = useMemo(() => {
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
    }, [entries, locale]);

    // 月历格子：周一起始
    const grid = useMemo(() => {
        const { y, m } = monthCursor;
        const first = new Date(Date.UTC(y, m, 1));
        const lead = (first.getUTCDay() + 6) % 7; // 周一=0
        const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        const cells: Array<{ day: number; iso: string } | null> = [];
        for (let i = 0; i < lead; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, iso: isoOf(y, m, d) });
        return cells;
    }, [monthCursor]);

    const weekdayLabels = useMemo(() => {
        // 2024-01-01 是周一
        return Array.from({ length: 7 }, (_, i) =>
            new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale, { weekday: 'narrow', timeZone: 'UTC' })
        );
    }, [locale]);

    const monthTitle = new Date(Date.UTC(monthCursor.y, monthCursor.m, 1)).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        timeZone: 'UTC',
    });

    const shiftMonth = (delta: number) => {
        setSelectedDay(null);
        setMonthCursor(({ y, m }) => {
            const nm = m + delta;
            return { y: y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
        });
    };

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

    const renderEntryRow = (e: AgendaEntry) => {
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
                <div
                    className={`min-w-0 flex-1 pl-2.5 ${
                        e.isCustom ? 'border-l-2 border-teal-600 bg-teal-950/25 rounded-r-lg py-1 pr-1.5' : 'border-l border-gray-800'
                    }`}
                >
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
                            <span className="text-xs text-gray-600">{tStatus.has(e.statusKey) ? tStatus(e.statusKey) : e.statusKey}</span>
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
                        <p className={`text-xs line-clamp-1 mt-0.5 ${e.isCustom ? 'text-gray-300' : 'text-gray-500'}`}>{e.title}</p>
                    )}
                </div>
            </li>
        );
    };

    return (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <CalendarClock className="w-5 h-5 text-teal-500" />
                    {t('title')}
                </h2>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setView('calendar')}
                        aria-label={t('viewMonth')}
                        className={`p-1.5 rounded ${view === 'calendar' ? 'bg-gray-800 text-teal-400' : 'text-gray-600 hover:text-gray-300'}`}
                    >
                        <CalendarClock className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setView('list')}
                        aria-label={t('viewList')}
                        className={`p-1.5 rounded ${view === 'list' ? 'bg-gray-800 text-teal-400' : 'text-gray-600 hover:text-gray-300'}`}
                    >
                        <List className="w-4 h-4" />
                    </button>
                    <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-teal-400 h-7 px-2">
                        <Plus className="w-4 h-4 mr-0.5" />
                        {tCustom('add')}
                    </Button>
                </div>
            </div>
            <p className="text-xs text-gray-600 mb-2">{t('hint')}</p>
            {trials.length > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer mb-4">
                    <input type="checkbox" checked={showTrials} onChange={(e) => setShowTrials(e.target.checked)} className="accent-teal-500" />
                    {t('showTrials', { count: trials.length })}
                </label>
            )}

            {view === 'calendar' ? (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <button type="button" onClick={() => shiftMonth(-1)} className="p-1 text-gray-500 hover:text-gray-200" aria-label="prev">
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-sm font-medium text-gray-200">
                            {monthTitle}
                            {(() => {
                                const prefix = `${monthCursor.y}-${String(monthCursor.m + 1).padStart(2, '0')}`;
                                const n = [...byDate.entries()].filter(([d]) => d.startsWith(prefix)).reduce((a, [, v]) => a + v.length, 0);
                                return n > 0 ? <span className="ml-2 text-xs text-teal-500">{t('monthCount', { count: n })}</span> : null;
                            })()}
                        </span>
                        <button type="button" onClick={() => shiftMonth(1)} className="p-1 text-gray-500 hover:text-gray-200" aria-label="next">
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center">
                        {weekdayLabels.map((w, i) => (
                            <div key={i} className="text-[10px] text-gray-600 pb-1">
                                {w}
                            </div>
                        ))}
                        {grid.map((cell, i) => {
                            if (!cell) return <div key={`x${i}`} className="h-14" />;
                            const dayEntries = byDate.get(cell.iso) ?? [];
                            const isToday = cell.iso === today;
                            const isPast = cell.iso < today;
                            const hasCustom = dayEntries.some((e) => e.isCustom);
                            const near = !isPast && dayEntries.length > 0 && (Date.parse(cell.iso) - now) / 86_400_000 <= 7;
                            const selected = selectedDay === cell.iso;
                            // 悬浮卡定位：边缘列贴边、前两行朝下弹，避免溢出
                            const col = i % 7;
                            const row = Math.floor(i / 7);
                            const posX = col <= 1 ? 'left-0' : col >= 5 ? 'right-0' : 'left-1/2 -translate-x-1/2';
                            const posY = row < 2 ? 'top-full mt-1' : 'bottom-full mb-1';
                            const daysUntilCell = Math.ceil((Date.parse(cell.iso) - now) / 86_400_000);
                            return (
                                <div key={cell.iso} className="relative group">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedDay(selected ? null : cell.iso)}
                                        disabled={dayEntries.length === 0}
                                        className={`w-full h-14 rounded-lg text-xs tabular-nums flex flex-col items-center justify-start pt-1 gap-0.5 ${
                                            selected
                                                ? 'bg-teal-900/50 text-teal-200 ring-1 ring-teal-600'
                                                : dayEntries.length > 0
                                                  ? 'bg-gray-800/70 text-gray-200 hover:bg-gray-800 cursor-pointer'
                                                  : 'text-gray-700'
                                        } ${isToday ? 'ring-1 ring-teal-500' : ''} ${isPast && dayEntries.length > 0 ? 'opacity-50' : ''}`}
                                    >
                                        {cell.day}
                                        {/* 直接显示标的代码——不用点开就知道是谁的事；颜色即类型 */}
                                        {dayEntries.slice(0, 2).map((e, j) => (
                                            <span
                                                key={j}
                                                className={`text-[9px] leading-none font-medium ${
                                                    near ? 'text-amber-400' : e.isCustom ? 'text-teal-400' : 'text-gray-500'
                                                }`}
                                            >
                                                {e.symbol}
                                            </span>
                                        ))}
                                        {dayEntries.length > 2 && <span className="text-[8px] leading-none text-gray-500">+{dayEntries.length - 2}</span>}
                                    </button>

                                    {/* 即时悬浮详情卡（替代原生 title 的迟钝纯文本） */}
                                    {dayEntries.length > 0 && (
                                        <div
                                            className={`pointer-events-none invisible group-hover:visible absolute z-30 ${posX} ${posY} w-60 rounded-lg border border-gray-700 bg-gray-900 shadow-xl p-2.5 text-left`}
                                        >
                                            <p className="text-[10px] text-gray-500 tabular-nums mb-1.5">
                                                {cell.iso}
                                                {!isPast && <span className="ml-1.5 text-amber-400 font-medium">T-{daysUntilCell}</span>}
                                                {isPast && <span className="ml-1.5 text-gray-600">{t('past')}</span>}
                                            </p>
                                            <ul className="space-y-1.5">
                                                {dayEntries.slice(0, 4).map((e) => (
                                                    <li key={e.key} className="text-xs leading-snug">
                                                        <span className={`font-medium ${e.isCustom ? 'text-teal-300' : 'text-gray-300'}`}>{e.symbol}</span>
                                                        <span className="ml-1.5 text-[10px] px-1 py-px rounded bg-gray-800 text-gray-400">{e.chip}</span>
                                                        {e.auto && <span className="ml-1 text-[10px] text-teal-500/80">AI</span>}
                                                        <span className="block text-gray-500 line-clamp-2">{e.title}</span>
                                                    </li>
                                                ))}
                                                {dayEntries.length > 4 && (
                                                    <li className="text-[10px] text-gray-600">+{dayEntries.length - 4}</li>
                                                )}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-600">
                        <span className="text-teal-400">■</span>{t('legendCustom')}
                        <span className="text-gray-500">■</span>{t('legendTrial')}
                        <span className="text-amber-400">■</span>{t('legendNear')}
                    </div>
                    {selectedDay && (
                        <div className="mt-3 border-t border-gray-800 pt-3">
                            <p className="text-xs text-gray-500 mb-2 tabular-nums">{selectedDay}</p>
                            <ul className="space-y-2.5">{(byDate.get(selectedDay) ?? []).map(renderEntryRow)}</ul>
                        </div>
                    )}
                </div>
            ) : listGroups.length === 0 ? (
                <p className="text-gray-500 text-sm">{t('empty')}</p>
            ) : (
                <div className="space-y-4">
                    {listGroups.map(([month, monthEntries]) => (
                        <div key={month}>
                            <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">{month}</h3>
                            <ul className="space-y-2.5">{monthEntries.map(renderEntryRow)}</ul>
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
