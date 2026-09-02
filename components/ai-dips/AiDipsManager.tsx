'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Import, Loader2, Plus, Settings2, X } from 'lucide-react';
import { searchStocks } from '@/lib/actions/finnhub.actions';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import {
    addAiDipStocks,
    getAiDipPoolItems,
    removeAiDipStock,
} from '@/lib/actions/ai-dips-pool.actions';
import { AI_DIP_POOL_MAX, AI_SUB_SECTORS, type AiDipMeta, type AiSubSector } from '@/lib/ai-dips-catalog';
import { useDebounce } from '@/hooks/useDebounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface WatchlistEntry {
    symbol: string;
    company: string;
}

/** 股票池管理：页头入口按钮打开弹窗，列表 / 搜索添加 / 自选股导入三视图 */
export default function AiDipsManager({ userId }: { userId: string }) {
    const t = useTranslations('aiDips.manage');
    const tSector = useTranslations('aiDips.subSectors');
    const router = useRouter();

    const [open, setOpen] = useState(false);
    const [view, setView] = useState<'list' | 'add' | 'import'>('list');
    const [pool, setPool] = useState<AiDipMeta[] | null>(null);
    const [saving, setSaving] = useState(false);

    // add view
    const [stockQuery, setStockQuery] = useState('');
    const [stockResults, setStockResults] = useState<StockWithWatchlistStatus[]>([]);
    const [stockSearching, setStockSearching] = useState(false);
    const [symbol, setSymbol] = useState('');
    const [name, setName] = useState('');
    const [subSector, setSubSector] = useState<AiSubSector>('custom');

    // import view
    const [watchlist, setWatchlist] = useState<WatchlistEntry[] | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const refreshPool = async () => {
        setPool(await getAiDipPoolItems());
    };

    const openDialog = () => {
        setView('list');
        setOpen(true);
        void refreshPool();
    };

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

    const openAdd = () => {
        setStockQuery('');
        setStockResults([]);
        setSymbol('');
        setName('');
        setSubSector('custom');
        setView('add');
    };

    const openImport = async () => {
        setSelected(new Set());
        setWatchlist(null);
        setView('import');
        const items = (await getUserWatchlist(userId)) as Array<{ symbol: string; company: string }>;
        setWatchlist(items.map((i) => ({ symbol: i.symbol, company: i.company })));
    };

    const poolSymbols = new Set((pool ?? []).map((s) => s.symbol));
    const importCandidates = (watchlist ?? []).filter((w) => !poolSymbols.has(w.symbol));

    const submitAdd = async (items: Array<{ symbol: string; name: string; subSector?: AiSubSector }>) => {
        setSaving(true);
        try {
            const res = await addAiDipStocks(items);
            if (res.capped) {
                toast.error(t('poolFull', { max: AI_DIP_POOL_MAX }));
                return;
            }
            if (!res.ok) {
                toast.error(t('saveFailed'));
                return;
            }
            toast.success(t('added', { n: res.added }));
            await refreshPool();
            setView('list');
            // 通知 Board 立即刷新，并在后台建档完成后（~30s）再刷一次
            window.dispatchEvent(new Event('aidips-pool-changed'));
            router.refresh();
        } catch {
            toast.error(t('saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (item: AiDipMeta) => {
        if (!window.confirm(t('deleteConfirm', { symbol: item.symbol }))) return;
        const res = await removeAiDipStock(item.symbol);
        if (!res.ok) {
            toast.error(t('saveFailed'));
            return;
        }
        await refreshPool();
        router.refresh();
    };

    const toggleSelected = (sym: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(sym)) next.delete(sym);
            else next.add(sym);
            return next;
        });
    };

    const backButton = (
        <button type="button" onClick={() => setView('list')} aria-label={t('back')}>
            <ArrowLeft className="w-4 h-4 text-gray-400 hover:text-gray-200" />
        </button>
    );

    const sectorLabel = (s: AiSubSector) => tSector(s);

    return (
        <>
            <Button variant="outline" size="sm" onClick={openDialog} className="border-gray-700 text-gray-200">
                <Settings2 className="w-4 h-4 mr-1" />
                {t('button')}
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {view !== 'list' && backButton}
                            <Settings2 className="w-5 h-5 text-teal-500" />
                            {view === 'list' ? t('title') : view === 'add' ? t('addTitle') : t('importTitle')}
                            {pool && (
                                <span className="ml-auto text-xs font-normal text-gray-500">
                                    {t('count', { n: pool.length, max: AI_DIP_POOL_MAX })}
                                </span>
                            )}
                        </DialogTitle>
                    </DialogHeader>

                    {view === 'list' && (
                        <>
                            {pool === null ? (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {AI_SUB_SECTORS.filter((s) => pool.some((p) => p.subSector === s)).map((sector) => (
                                        <div key={sector}>
                                            <p className="text-xs text-gray-500 mb-1.5">{sectorLabel(sector)}</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {pool.filter((p) => p.subSector === sector).map((item) => (
                                                    <span
                                                        key={item.symbol}
                                                        className="inline-flex items-center gap-1 rounded-full border border-gray-700 bg-gray-800/60 px-2.5 py-1 text-xs text-gray-200"
                                                        title={item.name}
                                                    >
                                                        {item.symbol}
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDelete(item)}
                                                            aria-label={t('delete', { symbol: item.symbol })}
                                                            className="cursor-pointer text-gray-500 hover:text-red-400"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <DialogFooter>
                                <Button variant="outline" onClick={openImport} className="border-gray-700 text-gray-200">
                                    <Import className="w-4 h-4 mr-1" />
                                    {t('importButton')}
                                </Button>
                                <Button onClick={openAdd} className="bg-teal-600 hover:bg-teal-500 text-white">
                                    <Plus className="w-4 h-4 mr-1" />
                                    {t('addButton')}
                                </Button>
                            </DialogFooter>
                        </>
                    )}

                    {view === 'add' && (
                        <>
                            <div className="space-y-4">
                                <div className="space-y-1.5 relative">
                                    <Label htmlFor="ai-dips-stock-search">{t('search')}</Label>
                                    <div className="relative">
                                        <Input
                                            id="ai-dips-stock-search"
                                            value={stockQuery}
                                            onChange={(e) => setStockQuery(e.target.value)}
                                            placeholder={t('searchPlaceholder')}
                                            autoComplete="off"
                                            className="bg-gray-800 border-gray-700 pr-8"
                                        />
                                        {stockSearching && <Loader2 className="w-4 h-4 animate-spin text-gray-500 absolute right-2.5 top-1/2 -translate-y-1/2" />}
                                    </div>
                                    {stockResults.length > 0 && (
                                        <ul className="absolute z-50 left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-56 overflow-y-auto divide-y divide-gray-700/50">
                                            {stockResults.map((stock) => (
                                                <li key={stock.symbol}>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSymbol(stock.symbol.toUpperCase());
                                                            setName(stock.name);
                                                            setStockQuery('');
                                                            setStockResults([]);
                                                        }}
                                                        className="w-full text-left px-3 py-2 hover:bg-gray-700/60 flex items-center justify-between gap-2"
                                                    >
                                                        <span className="min-w-0">
                                                            <span className="text-sm font-medium text-gray-100">{stock.symbol}</span>
                                                            <span className="ml-2 text-sm text-gray-400 truncate">{stock.name}</span>
                                                        </span>
                                                        <span className="text-xs text-gray-500 shrink-0">{stock.exchange}</span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="ai-dips-symbol">{t('symbol')}</Label>
                                        <Input
                                            id="ai-dips-symbol"
                                            value={symbol}
                                            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                                            placeholder="NVDA"
                                            className="bg-gray-800 border-gray-700"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>{t('sector')}</Label>
                                        <Select value={subSector} onValueChange={(v) => setSubSector(v as AiSubSector)}>
                                            <SelectTrigger className="bg-gray-800 border-gray-700 text-gray-200 w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-gray-800 border-gray-700 text-gray-200">
                                                {AI_SUB_SECTORS.map((s) => (
                                                    <SelectItem key={s} value={s}>{sectorLabel(s)}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="ai-dips-name">{t('company')}</Label>
                                    <Input
                                        id="ai-dips-name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="NVIDIA"
                                        className="bg-gray-800 border-gray-700"
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="ghost" onClick={() => setView('list')}>{t('cancel')}</Button>
                                <Button
                                    onClick={() => submitAdd([{ symbol, name, subSector }])}
                                    disabled={saving || !symbol.trim()}
                                    className="bg-teal-600 hover:bg-teal-500 text-white"
                                >
                                    {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                                    {t('save')}
                                </Button>
                            </DialogFooter>
                        </>
                    )}

                    {view === 'import' && (
                        <>
                            {watchlist === null ? (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                                </div>
                            ) : importCandidates.length === 0 ? (
                                <p className="text-sm text-gray-500">{t('importEmpty')}</p>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3 text-xs">
                                        <button
                                            type="button"
                                            onClick={() => setSelected(new Set(importCandidates.map((w) => w.symbol)))}
                                            className="cursor-pointer text-teal-400 hover:text-teal-300"
                                        >
                                            {t('selectAll')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSelected(new Set())}
                                            className="cursor-pointer text-gray-500 hover:text-gray-300"
                                        >
                                            {t('clearAll')}
                                        </button>
                                        <span className="ml-auto text-gray-600">{t('selectedCount', { n: selected.size })}</span>
                                    </div>
                                    <div className="max-h-72 overflow-y-auto border border-gray-800 rounded-lg divide-y divide-gray-800">
                                        {importCandidates.map((w) => (
                                            <label key={w.symbol} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-800/50">
                                                <input
                                                    type="checkbox"
                                                    checked={selected.has(w.symbol)}
                                                    onChange={() => toggleSelected(w.symbol)}
                                                    className="accent-teal-500"
                                                />
                                                <span className="min-w-0">
                                                    <span className="text-sm font-medium text-gray-100">{w.symbol}</span>
                                                    <span className="ml-2 text-sm text-gray-400 truncate">{w.company}</span>
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                    <p className="text-xs text-gray-600">{t('importHint')}</p>
                                </div>
                            )}
                            <DialogFooter>
                                <Button variant="ghost" onClick={() => setView('list')}>{t('cancel')}</Button>
                                <Button
                                    onClick={() =>
                                        submitAdd(
                                            importCandidates
                                                .filter((w) => selected.has(w.symbol))
                                                .map((w) => ({ symbol: w.symbol, name: w.company, subSector: 'custom' as const })),
                                        )
                                    }
                                    disabled={saving || selected.size === 0}
                                    className="bg-teal-600 hover:bg-teal-500 text-white"
                                >
                                    {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                                    {t('importSave', { n: selected.size })}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
