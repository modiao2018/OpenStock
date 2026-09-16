'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronDown, Loader2, Search, Trash2 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebounce } from '@/hooks/useDebounce';
import {
    buildCatalog,
    DASHBOARD_CATALOG,
    DEFAULT_DASHBOARD_SYMBOLS,
    EMPTY_CATALOG_EDITS,
    groupCatalog,
    setStockIndustry,
    type DashboardCatalogEdits,
    type DashboardCustomStock,
} from '@/lib/dashboard-catalog';
import { MAX_HEATMAP_SYMBOLS } from '@/lib/heatmap-tile';
import { lookupDashboardStock, saveDashboardConfig } from '@/lib/actions/dashboard.actions';
import { searchStocks } from '@/lib/actions/finnhub.actions';

interface DashboardConfigDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentSymbols: string[];
    currentEdits: DashboardCatalogEdits;
}

const MASTER_SYMBOLS = new Set(DASHBOARD_CATALOG.map((s) => s.symbol));

const DashboardConfigDialog = ({ open, onOpenChange, currentSymbols, currentEdits }: DashboardConfigDialogProps) => {
    const t = useTranslations('dashboardConfig');
    const tSectors = useTranslations('sectors');
    const router = useRouter();
    const [selected, setSelected] = useState<Set<string>>(new Set(currentSymbols));
    const [edits, setEdits] = useState<DashboardCatalogEdits>(currentEdits);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<StockWithWatchlistStatus[]>([]);
    const [searching, setSearching] = useState(false);
    const [adding, setAdding] = useState<string | null>(null);
    // Chip whose industry / remove menu is open, and the new-industry draft inside it
    const [menuFor, setMenuFor] = useState<string | null>(null);
    const [newIndustry, setNewIndustry] = useState('');
    const [isPending, startTransition] = useTransition();

    // Re-seed the draft from the saved config each time the dialog opens
    useEffect(() => {
        if (!open) return;
        setSelected(new Set(currentSymbols));
        setEdits(currentEdits);
        setQuery('');
        setResults([]);
        setMenuFor(null);
    }, [open, currentSymbols, currentEdits]);

    const catalog = useMemo(() => buildCatalog(edits), [edits]);
    const groups = useMemo(() => groupCatalog(catalog), [catalog]);
    const catalogSymbols = useMemo(() => new Set(catalog.map((s) => s.symbol)), [catalog]);
    const industryOf = useMemo(() => new Map(catalog.map((s) => [s.symbol, s.industry])), [catalog]);
    const namesBySymbol = useMemo(() => new Map(edits.added.map((s) => [s.symbol, s.name])), [edits.added]);

    const sectorLabel = (industry: string) =>
        tSectors.has(industry) ? tSectors(industry) : industry;

    const runSearch = async () => {
        const q = query.trim();
        if (!q) {
            setResults([]);
            return;
        }
        setSearching(true);
        try {
            const found = await searchStocks(q);
            setResults(found.slice(0, 8));
        } finally {
            setSearching(false);
        }
    };
    const debouncedSearch = useDebounce(runSearch, 300);
    useEffect(() => {
        debouncedSearch();
    }, [debouncedSearch, query]);

    const toggleStock = (symbol: string) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(symbol)) next.delete(symbol);
            else next.add(symbol);
            return next;
        });
    };

    const toggleIndustry = (symbols: string[]) => {
        setSelected((current) => {
            const next = new Set(current);
            const allSelected = symbols.every((s) => next.has(s));
            for (const s of symbols) {
                if (allSelected) next.delete(s);
                else next.add(s);
            }
            return next;
        });
    };

    // Drop a stock from the picker: a master-catalog stock is recorded as
    // removed, a user-added one is simply forgotten. Either way it leaves the
    // selection so it cannot stay on the heatmap unseen.
    const removeStock = (symbol: string) => {
        setMenuFor(null);
        setEdits((current) => ({
            added: current.added.filter((s) => s.symbol !== symbol),
            removed: MASTER_SYMBOLS.has(symbol) && !current.removed.includes(symbol)
                ? [...current.removed, symbol]
                : current.removed,
        }));
        setSelected((current) => {
            const next = new Set(current);
            next.delete(symbol);
            return next;
        });
    };

    const moveStock = (symbol: string, industry: string) => {
        const target = industry.trim();
        if (!target) return;
        setEdits((current) => setStockIndustry(current, symbol, target));
        setNewIndustry('');
        setMenuFor(null);
    };

    const includeStock = (stock: DashboardCustomStock) => {
        setEdits((current) => ({
            added: current.added.some((s) => s.symbol === stock.symbol) ? current.added : [...current.added, stock],
            removed: current.removed.filter((s) => s !== stock.symbol),
        }));
        setSelected((current) => new Set(current).add(stock.symbol));
    };

    // Search pick / Enter: a stock already in the picker is just selected; a
    // removed master stock comes back; anything else is looked up on the
    // server for its profile (name + industry) before it joins the picker.
    const addStock = async (rawSymbol: string) => {
        const symbol = rawSymbol.trim().toUpperCase();
        if (!symbol) return;
        setQuery('');
        setResults([]);
        if (catalogSymbols.has(symbol)) {
            setSelected((current) => new Set(current).add(symbol));
            return;
        }
        if (edits.removed.includes(symbol)) {
            setEdits((current) => ({ ...current, removed: current.removed.filter((s) => s !== symbol) }));
            setSelected((current) => new Set(current).add(symbol));
            return;
        }
        setAdding(symbol);
        try {
            const result = await lookupDashboardStock(symbol);
            if (result.ok) {
                includeStock(result.stock);
            } else {
                const key = {
                    invalid: 'lookupInvalid',
                    unknown: 'lookupUnknown',
                    unsupported: 'lookupUnsupported',
                    error: 'lookupError',
                }[result.reason] as 'lookupInvalid' | 'lookupUnknown' | 'lookupUnsupported' | 'lookupError';
                toast.error(t(key, { symbol }));
            }
        } finally {
            setAdding(null);
        }
    };

    const resetDefault = () => {
        setSelected(new Set(DEFAULT_DASHBOARD_SYMBOLS));
        setEdits(EMPTY_CATALOG_EDITS);
    };

    const handleSave = () => {
        startTransition(async () => {
            const result = await saveDashboardConfig({ symbols: [...selected], edits });
            if (result.ok) {
                toast.success(t('saved'));
                onOpenChange(false);
                router.refresh();
            } else {
                toast.error(t('saveFailed'));
            }
        });
    };

    const overLimit = selected.size > MAX_HEATMAP_SYMBOLS;

    const chipClass = (active: boolean) =>
        `rounded-l-md border px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer ${
            active
                ? 'border-teal-500 bg-teal-500/10 text-teal-400'
                : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
        }`;
    const menuTriggerClass = (active: boolean) =>
        `rounded-r-md border border-l-0 px-1 py-1 text-gray-700 transition-colors cursor-pointer group-hover:text-gray-400 hover:!text-teal-400 data-[state=open]:text-teal-400 ${
            active ? 'border-teal-500 bg-teal-500/10' : 'border-gray-700 group-hover:border-gray-500'
        }`;
    const industryOptionClass = (current: boolean) =>
        `w-full rounded px-2 py-1 text-left text-xs transition-colors cursor-pointer ${
            current ? 'bg-teal-500/10 text-teal-400' : 'text-gray-300 hover:bg-gray-700/60'
        }`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl border-gray-700 bg-gray-900 text-gray-100">
                <DialogHeader>
                    <DialogTitle>{t('title')}</DialogTitle>
                    <DialogDescription className="text-gray-400">{t('description')}</DialogDescription>
                </DialogHeader>

                <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                void addStock(query);
                            }
                        }}
                        placeholder={t('addPlaceholder')}
                        aria-label={t('addLabel')}
                        disabled={adding !== null}
                        className="border-gray-700 bg-gray-800 pl-9 pr-9 text-gray-100 placeholder:text-gray-500"
                    />
                    {(searching || adding) && (
                        <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-500" />
                    )}
                    {query.trim() && !searching && results.length === 0 && (
                        <div className="absolute left-0 right-0 z-50 mt-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-500 shadow-xl">
                            {t('noResults')}
                        </div>
                    )}
                    {results.length > 0 && (
                        <ul className="absolute left-0 right-0 z-50 mt-1 max-h-56 divide-y divide-gray-700/50 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 shadow-xl">
                            {results.map((stock) => (
                                <li key={stock.symbol}>
                                    <button
                                        type="button"
                                        onClick={() => void addStock(stock.symbol)}
                                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-gray-700/60"
                                    >
                                        <span className="min-w-0 truncate">
                                            <span className="font-mono text-sm font-medium text-gray-100">{stock.symbol}</span>
                                            <span className="ml-2 text-sm text-gray-400">{stock.name}</span>
                                        </span>
                                        <span className="shrink-0 text-xs text-gray-500">
                                            {catalogSymbols.has(stock.symbol.toUpperCase()) ? t('alreadyListed') : stock.exchange}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="max-h-[50vh] space-y-5 overflow-y-auto pr-2">
                    {groups.map(({ industry, symbols }) => {
                        const selectedCount = symbols.filter((s) => selected.has(s)).length;
                        const allSelected = selectedCount === symbols.length;
                        return (
                            <div key={industry}>
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-sm font-medium text-gray-200">
                                        {sectorLabel(industry)}
                                        <span className="ml-2 text-xs text-gray-500">{selectedCount}/{symbols.length}</span>
                                    </span>
                                    <button
                                        type="button"
                                        className="text-xs text-teal-500 hover:text-teal-400 cursor-pointer"
                                        onClick={() => toggleIndustry(symbols)}
                                    >
                                        {allSelected ? t('clearIndustry') : t('selectIndustry')}
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {symbols.map((symbol) => {
                                        const active = selected.has(symbol);
                                        return (
                                            <span key={symbol} className="group inline-flex items-stretch">
                                                <button
                                                    type="button"
                                                    className={chipClass(active)}
                                                    title={namesBySymbol.get(symbol)}
                                                    onClick={() => toggleStock(symbol)}
                                                >
                                                    {symbol}
                                                </button>
                                                <Popover
                                                    open={menuFor === symbol}
                                                    onOpenChange={(isOpen) => {
                                                        setMenuFor(isOpen ? symbol : null);
                                                        setNewIndustry('');
                                                    }}
                                                >
                                                    <PopoverTrigger asChild>
                                                        <button
                                                            type="button"
                                                            className={menuTriggerClass(active)}
                                                            title={t('stockMenu', { symbol })}
                                                            aria-label={t('stockMenu', { symbol })}
                                                        >
                                                            <ChevronDown className="h-3 w-3" />
                                                        </button>
                                                    </PopoverTrigger>
                                                    <PopoverContent
                                                        align="start"
                                                        className="w-56 border-gray-700 bg-gray-800 p-2 text-gray-100"
                                                    >
                                                        <div className="mb-1 px-2 text-xs text-gray-500">
                                                            <span className="font-mono text-gray-300">{symbol}</span> · {t('industryLabel')}
                                                        </div>
                                                        <div className="max-h-48 overflow-y-auto">
                                                            {groups.map((group) => (
                                                                <button
                                                                    key={group.industry}
                                                                    type="button"
                                                                    className={industryOptionClass(industryOf.get(symbol) === group.industry)}
                                                                    onClick={() => moveStock(symbol, group.industry)}
                                                                >
                                                                    {sectorLabel(group.industry)}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        <Input
                                                            value={newIndustry}
                                                            onChange={(e) => setNewIndustry(e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    e.preventDefault();
                                                                    moveStock(symbol, newIndustry);
                                                                }
                                                            }}
                                                            placeholder={t('newIndustryPlaceholder')}
                                                            className="mt-2 h-8 border-gray-700 bg-gray-900 text-xs text-gray-100 placeholder:text-gray-500"
                                                        />
                                                        <button
                                                            type="button"
                                                            className="mt-2 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-red-400 transition-colors cursor-pointer hover:bg-red-500/10"
                                                            onClick={() => removeStock(symbol)}
                                                        >
                                                            <Trash2 className="h-3 w-3" />
                                                            {t('removeStock', { symbol })}
                                                        </button>
                                                    </PopoverContent>
                                                </Popover>
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <DialogFooter className="flex items-center gap-2 sm:justify-between">
                    <div className="flex items-center gap-3">
                        <span className={`text-xs ${overLimit ? 'text-red-400' : 'text-gray-500'}`}>
                            {t('selectedCount', { count: selected.size, max: MAX_HEATMAP_SYMBOLS })}
                            {overLimit && ` · ${t('overLimit', { max: MAX_HEATMAP_SYMBOLS })}`}
                        </span>
                        <button
                            type="button"
                            className="text-xs text-gray-400 hover:text-teal-400 cursor-pointer"
                            onClick={resetDefault}
                        >
                            {t('resetDefault')}
                        </button>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="ghost" className="text-gray-400" onClick={() => onOpenChange(false)}>
                            {t('cancel')}
                        </Button>
                        <Button
                            className="bg-teal-500 text-gray-900 hover:bg-teal-400"
                            onClick={handleSave}
                            disabled={isPending || selected.size === 0 || overLimit}
                        >
                            {isPending ? t('saving') : t('save')}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default DashboardConfigDialog;
