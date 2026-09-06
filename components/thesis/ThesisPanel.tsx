'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Bell, BellOff, ChevronDown, ChevronRight, Lightbulb, Loader2, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { searchStocks } from '@/lib/actions/finnhub.actions';
import { useDebounce } from '@/hooks/useDebounce';
import { formatClock } from '@/lib/format-time';
import { isRedUpLocale } from '@/lib/utils';
import {
    appendThesisNote,
    closeThesis,
    createThesis,
    deleteThesis,
    reopenThesis,
    type ThesisData,
} from '@/lib/actions/thesis.actions';
import { daysUntil, type ThesisDirection, type ThesisOutcome } from '@/lib/thesis-math';

interface Props {
    items: ThesisData[];
    /** 个股页：固定标的，表单不再搜索股票 */
    symbol?: string;
    name?: string;
    /** 个股页用紧凑样式 */
    compact?: boolean;
}

const fmtPrice = (v: number | null) => (v === null ? '—' : `$${v.toFixed(2)}`);
const fmtPct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const todayIso = () => new Date().toISOString().slice(0, 10);

const DIR_CLASS: Record<ThesisDirection, string> = {
    long: 'bg-teal-900/50 text-teal-300',
    short: 'bg-red-900/50 text-red-300',
    watch: 'bg-gray-800 text-gray-400',
};

export default function ThesisPanel({ items, symbol: fixedSymbol, name: fixedName, compact = false }: Props) {
    const t = useTranslations('thesis');
    const locale = useLocale();
    const router = useRouter();
    const redUp = isRedUpLocale(locale);
    const pctClass = (v: number | null) => {
        if (v === null || v === 0) return 'text-gray-400';
        const up = v > 0;
        return (redUp ? up : !up) ? 'text-red-400' : 'text-green-400';
    };

    const [showClosed, setShowClosed] = useState(false);
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [formOpen, setFormOpen] = useState(false);
    const [closing, setClosing] = useState<ThesisData | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const active = items.filter((i) => i.status === 'active');
    const closed = items.filter((i) => i.status !== 'active');
    const visible = showClosed ? [...active, ...closed] : active;

    const run = async (id: string, fn: () => Promise<unknown>, okMsg?: string) => {
        setBusy(id);
        try {
            await fn();
            if (okMsg) toast.success(okMsg);
            router.refresh();
        } catch {
            toast.error(t('actionFailed'));
        } finally {
            setBusy(null);
        }
    };

    const handleDelete = (item: ThesisData) => {
        if (!window.confirm(t('deleteConfirm', { symbol: item.symbol }))) return;
        void run(item.id, () => deleteThesis(item.id));
    };

    return (
        <div className={`rounded-xl border border-gray-800 bg-gray-900/50 ${compact ? 'p-4' : 'p-5'}`}>
            <div className="flex items-center justify-between gap-3 mb-1">
                <div className="flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-amber-400" />
                    <h2 className="text-lg font-semibold">{t('title')}</h2>
                    {active.length > 0 && <span className="text-xs text-gray-500">{t('activeCount', { n: active.length })}</span>}
                </div>
                <div className="flex items-center gap-2">
                    {closed.length > 0 && (
                        <button type="button" onClick={() => setShowClosed((v) => !v)} className="text-xs text-gray-500 hover:text-gray-300">
                            {showClosed ? t('hideClosed') : t('showClosed', { n: closed.length })}
                        </button>
                    )}
                    <Button size="sm" onClick={() => setFormOpen(true)} className="bg-amber-600 hover:bg-amber-500 text-white">
                        <Plus className="w-4 h-4" />
                        {fixedSymbol ? t('addFor', { symbol: fixedSymbol }) : t('add')}
                    </Button>
                </div>
            </div>
            <p className="text-xs text-gray-600 mb-4">{t('hint')}</p>

            {visible.length === 0 ? (
                <p className="text-sm text-gray-500">{fixedSymbol ? t('emptyFor', { symbol: fixedSymbol }) : t('empty')}</p>
            ) : (
                <ul className="space-y-2">
                    {visible.map((item) => {
                        const isOpen = Boolean(open[item.id]);
                        const daysLeft = daysUntil(todayIso(), item.horizonDate);
                        const isActive = item.status === 'active';
                        const last = item.followups[item.followups.length - 1];
                        return (
                            <li key={item.id} className={`rounded-lg border ${isActive ? 'border-gray-800 bg-gray-950/40' : 'border-gray-800/50 bg-gray-950/20 opacity-70'}`}>
                                <div
                                    className="flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-800/20"
                                    onClick={() => setOpen((o) => ({ ...o, [item.id]: !o[item.id] }))}
                                >
                                    <span className="text-gray-600 mt-1">{isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2 text-sm">
                                            {fixedSymbol ? (
                                                <span className="font-medium text-gray-100">{item.symbol}</span>
                                            ) : (
                                                <Link href={`/stocks/${item.symbol}`} onClick={(e) => e.stopPropagation()} className="font-medium text-gray-100 hover:text-teal-400">
                                                    {item.symbol}
                                                </Link>
                                            )}
                                            {!compact && <span className="text-gray-500 hidden md:inline">{item.name}</span>}
                                            <span className={`px-1.5 py-0.5 rounded text-xs ${DIR_CLASS[item.direction]}`}>{t(`direction.${item.direction}`)}</span>
                                            {!isActive && (
                                                <span className="px-1.5 py-0.5 rounded text-xs bg-gray-800 text-gray-400">
                                                    {t(`status.${item.status}`)}{item.outcome ? ` · ${t(`outcome.${item.outcome}`)}` : ''}
                                                </span>
                                            )}
                                            {isActive && (
                                                <span className={`text-xs ${daysLeft <= 1 ? 'text-amber-400' : 'text-gray-500'}`}>
                                                    {daysLeft < 0 ? t('row.overdue', { n: -daysLeft }) : daysLeft === 0 ? t('row.dueToday') : t('row.daysLeft', { n: daysLeft })}
                                                </span>
                                            )}
                                        </div>
                                        <p className={`text-sm text-gray-300 mt-1 ${isOpen ? 'whitespace-pre-wrap' : 'truncate'}`}>{item.note}</p>
                                        {item.framing && !isOpen && (
                                            <p className="text-xs text-gray-500 mt-1 truncate flex items-center gap-1">
                                                <Sparkles className="w-3 h-3 text-amber-500/70 shrink-0" />{item.framing.thesis}
                                            </p>
                                        )}
                                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-1.5 tabular-nums">
                                            <span>{t('row.entry')} {fmtPrice(item.entryPrice)}</span>
                                            {item.lastPrice !== null && (
                                                <span>
                                                    {t('row.last')} {fmtPrice(item.lastPrice)} <span className={pctClass(item.changePct)}>{fmtPct(item.changePct)}</span>
                                                </span>
                                            )}
                                            {item.targetPrice !== null && <span>{t('row.target')} {fmtPrice(item.targetPrice)}</span>}
                                            {item.stopPrice !== null && <span>{t('row.stop')} {fmtPrice(item.stopPrice)}</span>}
                                            <span>{t('row.until', { date: item.horizonDate })}</span>
                                            {item.followups.length > 0 && <span>{t('row.followups', { n: item.followups.length })}</span>}
                                        </div>
                                        {!isOpen && last && (
                                            <p className="text-xs text-gray-500 mt-1 truncate">
                                                <span className="text-amber-500/80">{formatClock(last.at, locale)}</span> {last.note}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                        {busy === item.id ? (
                                            <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                                        ) : isActive ? (
                                            <Button variant="ghost" size="sm" onClick={() => setClosing(item)} title={t('actions.close')} aria-label={t('actions.close')}>
                                                <BellOff className="w-4 h-4 text-gray-400" />
                                            </Button>
                                        ) : (
                                            <Button variant="ghost" size="sm" onClick={() => void run(item.id, () => reopenThesis(item.id), t('reopened'))} title={t('actions.reopen')} aria-label={t('actions.reopen')}>
                                                <RotateCcw className="w-4 h-4 text-gray-400" />
                                            </Button>
                                        )}
                                        <Button variant="ghost" size="sm" onClick={() => handleDelete(item)} title={t('actions.delete')} aria-label={t('actions.delete')}>
                                            <Trash2 className="w-4 h-4 text-red-400" />
                                        </Button>
                                    </div>
                                </div>

                                {isOpen && (
                                    <div className="border-t border-gray-800/60 px-3 pb-3 pt-2 space-y-3">
                                        {item.closingNote && (
                                            <p className="text-xs text-gray-400"><span className="text-gray-600">{t('closingNoteLabel')}</span> {item.closingNote}</p>
                                        )}
                                        <div>
                                            <div className="text-[10px] uppercase tracking-wide text-gray-600 mb-1 flex items-center gap-1">
                                                <Sparkles className="w-3 h-3 text-amber-500/70" />{t('framing.title')}
                                            </div>
                                            {item.framing ? (
                                                <div className="text-xs space-y-1.5">
                                                    <p className="text-gray-200">{item.framing.thesis}</p>
                                                    <div className="grid gap-2 md:grid-cols-2">
                                                        <FramingList label={t('framing.confirm')} items={item.framing.confirm} cls="text-teal-400/90" />
                                                        <FramingList label={t('framing.refute')} items={item.framing.refute} cls="text-red-400/90" />
                                                    </div>
                                                    {item.framing.questions.length > 0 && <FramingList label={t('framing.questions')} items={item.framing.questions} cls="text-amber-300/90" />}
                                                    {item.framing.keywords.length > 0 && (
                                                        <p className="text-gray-500">
                                                            {t('framing.keywords')}{' '}
                                                            {item.framing.keywords.map((k) => <span key={k} className="inline-block bg-gray-800 rounded px-1 mr-1">{k}</span>)}
                                                        </p>
                                                    )}
                                                </div>
                                            ) : (
                                                <p className="text-xs text-gray-600">{isActive ? t('framing.pending') : t('framing.none')}</p>
                                            )}
                                        </div>
                                        <div>
                                            <div className="text-[10px] uppercase tracking-wide text-gray-600 mb-1">{t('followup.title')}</div>
                                            {item.followups.length === 0 ? (
                                                <p className="text-xs text-gray-600">{t('followup.none')}</p>
                                            ) : (
                                                <ul className="space-y-2">
                                                    {item.followups.slice().reverse().map((f, i) => (
                                                        <li key={i} className="text-xs">
                                                            <div className="flex flex-wrap items-center gap-2 text-gray-500">
                                                                <Bell className={`w-3 h-3 ${f.delivered ? 'text-amber-400' : 'text-gray-600'}`} />
                                                                <span>{formatClock(f.at, locale)}</span>
                                                                <span className="tabular-nums">{fmtPrice(f.price)}</span>
                                                                {f.triggers.map((tr) => (
                                                                    <span key={tr} className="px-1 rounded bg-gray-800 text-gray-400">{t(`triggers.${tr}`)}</span>
                                                                ))}
                                                                {!f.delivered && <span className="text-gray-600">{t('followup.notDelivered')}</span>}
                                                            </div>
                                                            <p className="text-gray-300 mt-0.5 whitespace-pre-wrap">{f.note}</p>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                        {isActive && <AppendNote id={item.id} />}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <ThesisForm open={formOpen} onOpenChange={setFormOpen} fixedSymbol={fixedSymbol} fixedName={fixedName} />
            <CloseDialog item={closing} onClose={() => setClosing(null)} />
        </div>
    );
}

function FramingList({ label, items, cls }: { label: string; items: string[]; cls: string }) {
    if (items.length === 0) return null;
    return (
        <div>
            <div className={`text-[10px] ${cls}`}>{label}</div>
            <ul className="text-gray-400 space-y-0.5">
                {items.map((x, i) => <li key={i}>· {x}</li>)}
            </ul>
        </div>
    );
}

function AppendNote({ id }: { id: string }) {
    const t = useTranslations('thesis');
    const router = useRouter();
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    const submit = async () => {
        if (!text.trim()) return;
        setSaving(true);
        try {
            await appendThesisNote(id, text);
            setText('');
            router.refresh();
        } catch {
            toast.error(t('actionFailed'));
        } finally {
            setSaving(false);
        }
    };
    return (
        <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('actions.appendPlaceholder')} className="bg-gray-800 border-gray-700 h-8 text-xs" onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
            <Button size="sm" variant="outline" disabled={saving || !text.trim()} onClick={() => void submit()} className="border-gray-700 text-gray-200 h-8">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : t('actions.append')}
            </Button>
        </div>
    );
}

function ThesisForm({ open, onOpenChange, fixedSymbol, fixedName }: { open: boolean; onOpenChange: (v: boolean) => void; fixedSymbol?: string; fixedName?: string }) {
    const t = useTranslations('thesis');
    const router = useRouter();
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    // AI 没认出标的时才出现：补个代码再提交
    const [needsSymbol, setNeedsSymbol] = useState(false);
    const [symbol, setSymbol] = useState('');
    const [name, setName] = useState('');
    const [stockQuery, setStockQuery] = useState('');
    const [stockResults, setStockResults] = useState<StockWithWatchlistStatus[]>([]);
    const [stockSearching, setStockSearching] = useState(false);

    useEffect(() => {
        if (!open) return;
        setText('');
        setNeedsSymbol(false);
        setSymbol('');
        setName('');
        setStockQuery('');
        setStockResults([]);
    }, [open]);

    const handleStockSearch = async () => {
        const q = stockQuery.trim();
        if (!q) {
            setStockResults([]);
            return;
        }
        setStockSearching(true);
        try {
            const results = await searchStocks(q);
            setStockResults(results.slice(0, 8));
        } finally {
            setStockSearching(false);
        }
    };
    const debouncedStockSearch = useDebounce(handleStockSearch, 300);
    useEffect(() => {
        debouncedStockSearch();
    }, [debouncedStockSearch, stockQuery]);

    const canSave = text.trim().length > 0 && (!needsSymbol || symbol.trim().length > 0);

    const handleSave = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            const res = await createThesis({
                text,
                symbol: fixedSymbol ?? (needsSymbol ? symbol.trim() : undefined),
                name: fixedName ?? (needsSymbol ? name.trim() || undefined : undefined),
            });
            if (res.status === 'needsSymbol') {
                setNeedsSymbol(true);
                toast.info(t('form.needsSymbol'));
                return;
            }
            toast.success(res.framed ? t('saved', { symbol: res.symbol }) : t('savedUnframed', { symbol: res.symbol }));
            onOpenChange(false);
            router.refresh();
        } catch {
            toast.error(t('saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Lightbulb className="w-5 h-5 text-amber-400" />
                        {fixedSymbol ? t('form.titleFor', { symbol: fixedSymbol }) : t('form.title')}
                    </DialogTitle>
                </DialogHeader>
                <p className="text-xs text-gray-500 -mt-2">{t('form.intro')}</p>

                <div className="space-y-3">
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={fixedSymbol ? t('form.placeholderFor', { symbol: fixedSymbol }) : t('form.placeholder')}
                        rows={7}
                        autoFocus
                        className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600"
                        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void handleSave(); }}
                    />
                    <p className="text-xs text-gray-600 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-amber-500/70" />{t('form.aiHint')}
                    </p>

                    {needsSymbol && !fixedSymbol && (
                        <div className="space-y-2 rounded-md border border-amber-900/60 bg-amber-950/20 p-3">
                            <p className="text-xs text-amber-300">{t('form.needsSymbol')}</p>
                            <div className="relative">
                                <Input value={stockQuery} onChange={(e) => setStockQuery(e.target.value)} placeholder={t('form.stockSearchPlaceholder')} autoComplete="off" className="bg-gray-800 border-gray-700 pr-8" />
                                {stockSearching && <Loader2 className="w-4 h-4 animate-spin text-gray-500 absolute right-2.5 top-1/2 -translate-y-1/2" />}
                                {stockResults.length > 0 && (
                                    <ul className="absolute z-50 left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-56 overflow-y-auto divide-y divide-gray-700/50">
                                        {stockResults.map((st) => (
                                            <li key={st.symbol}>
                                                <button type="button" onClick={() => { setSymbol(st.symbol.toUpperCase()); setName(st.name); setStockQuery(''); setStockResults([]); }} className="w-full text-left px-3 py-2 hover:bg-gray-700/60 flex items-center justify-between gap-2">
                                                    <span className="min-w-0"><span className="text-sm font-medium text-gray-100">{st.symbol}</span><span className="ml-2 text-sm text-gray-400 truncate">{st.name}</span></span>
                                                    <span className="text-xs text-gray-500 shrink-0">{st.exchange}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="NVDA" className="bg-gray-800 border-gray-700 max-w-[10rem]" />
                                {name && <span className="text-xs text-gray-400 truncate">{name}</span>}
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('form.cancel')}</Button>
                    <Button onClick={() => void handleSave()} disabled={saving || !canSave} className="bg-amber-600 hover:bg-amber-500 text-white">
                        {saving ? (<><Loader2 className="w-4 h-4 animate-spin" />{t('form.saving')}</>) : t('form.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CloseDialog({ item, onClose }: { item: ThesisData | null; onClose: () => void }) {
    const t = useTranslations('thesis');
    const router = useRouter();
    const [outcome, setOutcome] = useState<ThesisOutcome>('abandoned');
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        if (item) {
            setOutcome('abandoned');
            setNote('');
        }
    }, [item]);
    const submit = async () => {
        if (!item) return;
        setSaving(true);
        try {
            await closeThesis(item.id, outcome, note);
            toast.success(t('closed', { symbol: item.symbol }));
            onClose();
            router.refresh();
        } catch {
            toast.error(t('actionFailed'));
        } finally {
            setSaving(false);
        }
    };
    return (
        <Dialog open={Boolean(item)} onOpenChange={(v) => { if (!v) onClose(); }}>
            <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <BellOff className="w-5 h-5 text-gray-400" />
                        {t('closeDialog.title', { symbol: item?.symbol ?? '' })}
                    </DialogTitle>
                </DialogHeader>
                <p className="text-xs text-gray-500 -mt-2">{t('closeDialog.intro')}</p>
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label>{t('closeDialog.outcome')}</Label>
                        <div className="flex gap-2">
                            {(['confirmed', 'refuted', 'abandoned'] as ThesisOutcome[]).map((o) => (
                                <button key={o} type="button" onClick={() => setOutcome(o)} className={`px-2.5 py-1 rounded text-xs border ${outcome === o ? 'border-amber-500 bg-amber-900/30 text-amber-200' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}>
                                    {t(`outcome.${o}`)}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="thesis-closing-note">{t('closeDialog.note')}</Label>
                        <textarea id="thesis-closing-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('closeDialog.notePlaceholder')} rows={3} className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>{t('form.cancel')}</Button>
                    <Button onClick={() => void submit()} disabled={saving} className="bg-gray-700 hover:bg-gray-600 text-white">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('closeDialog.confirm')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
