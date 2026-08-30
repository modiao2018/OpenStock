'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Pencil, Plus, Radar, Search, Trash2 } from 'lucide-react';
import { searchStocks } from '@/lib/actions/finnhub.actions';
import { useDebounce } from '@/hooks/useDebounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
    deleteCatalystWatchItem,
    saveCatalystWatchItem,
    searchClinicalTrials,
    type CatalystWatchItemData,
    type TrialSearchResult,
} from '@/lib/actions/catalyst.actions';

/** 监控清单管理：页头入口按钮打开弹窗，列表 ↔ 编辑双视图 */
export default function CatalystManager({ initialItems }: { initialItems: CatalystWatchItemData[] }) {
    const t = useTranslations('catalyst.manager');
    const router = useRouter();

    const [managerOpen, setManagerOpen] = useState(false);
    const [view, setView] = useState<'list' | 'form'>('list');

    const [stockQuery, setStockQuery] = useState('');
    const [stockResults, setStockResults] = useState<StockWithWatchlistStatus[]>([]);
    const [stockSearching, setStockSearching] = useState(false);
    const [symbol, setSymbol] = useState('');
    const [company, setCompany] = useState('');
    const [keywords, setKeywords] = useState('');
    const [scenarioNotes, setScenarioNotes] = useState('');
    const [autoDiscover, setAutoDiscover] = useState(true);
    const [trialResults, setTrialResults] = useState<TrialSearchResult[]>([]);
    const [selectedNctIds, setSelectedNctIds] = useState<Set<string>>(new Set());
    const [searching, setSearching] = useState(false);
    const [searched, setSearched] = useState(false);
    const [saving, setSaving] = useState(false);

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

    const selectStock = (stock: StockWithWatchlistStatus) => {
        setSymbol(stock.symbol.toUpperCase());
        setCompany(stock.name);
        setStockQuery('');
        setStockResults([]);
    };

    const openForAdd = () => {
        setStockQuery('');
        setStockResults([]);
        setSymbol('');
        setCompany('');
        setKeywords('');
        setScenarioNotes('');
        setAutoDiscover(true);
        setTrialResults([]);
        setSelectedNctIds(new Set());
        setSearched(false);
        setView('form');
    };

    const openForEdit = (item: CatalystWatchItemData) => {
        setStockQuery('');
        setStockResults([]);
        setSymbol(item.symbol);
        setCompany(item.company);
        setKeywords(item.keywords.join(', '));
        setScenarioNotes(item.scenarioNotes ?? '');
        setAutoDiscover(item.autoDiscover ?? true);
        setTrialResults(item.nctIds.map((nctId) => ({ nctId, title: nctId, overallStatus: '', phase: '' })));
        setSelectedNctIds(new Set(item.nctIds));
        setSearched(false);
        setView('form');
    };

    const handleSearch = async () => {
        const q = company.trim() || symbol.trim();
        if (!q) return;
        setSearching(true);
        try {
            const results = await searchClinicalTrials(q);
            const found = new Set(results.map((r) => r.nctId));
            const kept = trialResults.filter((r) => selectedNctIds.has(r.nctId) && !found.has(r.nctId));
            setTrialResults([...kept, ...results]);
            setSearched(true);
        } finally {
            setSearching(false);
        }
    };

    const toggleTrial = (nctId: string) => {
        setSelectedNctIds((prev) => {
            const next = new Set(prev);
            if (next.has(nctId)) next.delete(nctId);
            else next.add(nctId);
            return next;
        });
    };

    const handleSave = async () => {
        if (!symbol.trim() || !company.trim()) return;
        setSaving(true);
        try {
            await saveCatalystWatchItem({
                symbol: symbol.trim(),
                company: company.trim(),
                nctIds: Array.from(selectedNctIds),
                keywords: keywords.split(/[,，]/).map((k) => k.trim()).filter(Boolean),
                scenarioNotes: scenarioNotes.trim() || undefined,
                autoDiscover,
            });
            setView('list');
            router.refresh();
        } catch {
            toast.error(t('saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (item: CatalystWatchItemData) => {
        if (!window.confirm(t('deleteConfirm', { symbol: item.symbol }))) return;
        await deleteCatalystWatchItem(item.symbol);
        router.refresh();
    };

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                onClick={() => {
                    setView('list');
                    setManagerOpen(true);
                }}
                className="border-gray-700 text-gray-200"
            >
                <Radar className="w-4 h-4 mr-1" />
                {t('title')}
            </Button>

            <Dialog open={managerOpen} onOpenChange={setManagerOpen}>
                <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {view === 'form' && (
                                <button type="button" onClick={() => setView('list')} aria-label={t('back')}>
                                    <ArrowLeft className="w-4 h-4 text-gray-400 hover:text-gray-200" />
                                </button>
                            )}
                            <Radar className="w-5 h-5 text-teal-500" />
                            {view === 'list' ? t('title') : t('dialogTitle')}
                        </DialogTitle>
                    </DialogHeader>

                    {view === 'list' ? (
                        <>
                            <p className="text-xs text-gray-600 -mt-2">{t('hint')}</p>
                            {initialItems.length === 0 ? (
                                <p className="text-gray-500 text-sm">{t('empty')}</p>
                            ) : (
                                <ul className="space-y-3">
                                    {initialItems.map((item) => (
                                        <li key={item.symbol} className="flex items-start justify-between gap-3 border-b border-gray-800 pb-3 last:border-0 last:pb-0">
                                            <div className="min-w-0">
                                                <div className="font-medium text-gray-100">
                                                    {item.symbol}
                                                    <span className="ml-2 text-sm text-gray-400">{item.company}</span>
                                                </div>
                                                <div className="text-xs text-gray-500 mt-1 space-x-2">
                                                    {item.nctIds.map((n) => (
                                                        <span key={n} className="inline-block bg-gray-800 rounded px-1.5 py-0.5">{n}</span>
                                                    ))}
                                                    {item.keywords.length > 0 && <span className="text-gray-600">{item.keywords.join(' / ')}</span>}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <Button variant="ghost" size="sm" onClick={() => openForEdit(item)} aria-label={t('edit')}>
                                                    <Pencil className="w-4 h-4 text-gray-400" />
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => handleDelete(item)} aria-label={t('delete')}>
                                                    <Trash2 className="w-4 h-4 text-red-400" />
                                                </Button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <DialogFooter>
                                <Button onClick={openForAdd} className="bg-teal-600 hover:bg-teal-500 text-white">
                                    <Plus className="w-4 h-4 mr-1" />
                                    {t('add')}
                                </Button>
                            </DialogFooter>
                        </>
                    ) : (
                        <>
                            <div className="space-y-4">
                                <div className="space-y-1.5 relative">
                                    <Label htmlFor="catalyst-stock-search">{t('stockSearch')}</Label>
                                    <div className="relative">
                                        <Input
                                            id="catalyst-stock-search"
                                            value={stockQuery}
                                            onChange={(e) => setStockQuery(e.target.value)}
                                            placeholder={t('stockSearchPlaceholder')}
                                            autoComplete="off"
                                            className="bg-gray-800 border-gray-700 pr-8"
                                        />
                                        {stockSearching && <Loader2 className="w-4 h-4 animate-spin text-gray-500 absolute right-2.5 top-1/2 -translate-y-1/2" />}
                                    </div>
                                    {stockResults.length > 0 && (
                                        <ul className="absolute z-50 left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-56 overflow-y-auto divide-y divide-gray-700/50">
                                            {stockResults.map((stock) => (
                                                <li key={stock.symbol}>
                                                    <button type="button" onClick={() => selectStock(stock)} className="w-full text-left px-3 py-2 hover:bg-gray-700/60 flex items-center justify-between gap-2">
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
                                        <Label htmlFor="catalyst-symbol">{t('symbol')}</Label>
                                        <Input id="catalyst-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="ABCL" className="bg-gray-800 border-gray-700" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="catalyst-company">{t('company')}</Label>
                                        <Input id="catalyst-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="AbCellera Biologics" className="bg-gray-800 border-gray-700" />
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="catalyst-keywords">{t('keywords')}</Label>
                                    <Input id="catalyst-keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="AbCellera, ABCL635, ABCL575" className="bg-gray-800 border-gray-700" />
                                </div>

                                <div>
                                    <Button variant="outline" size="sm" onClick={handleSearch} disabled={searching || (!company.trim() && !symbol.trim())} className="border-gray-700 text-gray-200">
                                        {searching ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
                                        {t('searchTrials')}
                                    </Button>
                                    <p className="text-xs text-gray-600 mt-1.5">{t('trialsHint')}</p>
                                    <label className="flex items-start gap-2 mt-2 cursor-pointer">
                                        <input type="checkbox" checked={autoDiscover} onChange={(e) => setAutoDiscover(e.target.checked)} className="mt-0.5 accent-teal-500" />
                                        <span className="text-xs text-gray-400">{t('autoDiscover')}</span>
                                    </label>
                                </div>

                                {trialResults.length > 0 && (
                                    <div className="max-h-64 overflow-y-auto border border-gray-800 rounded-lg divide-y divide-gray-800">
                                        {trialResults.map((trial) => (
                                            <label key={trial.nctId} className="flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-800/50">
                                                <input type="checkbox" checked={selectedNctIds.has(trial.nctId)} onChange={() => toggleTrial(trial.nctId)} className="mt-1 accent-teal-500" />
                                                <span className="min-w-0">
                                                    <span className="text-sm text-gray-200 block">{trial.title}</span>
                                                    <span className="text-xs text-gray-500">
                                                        {trial.nctId}
                                                        {trial.phase && ` · ${trial.phase}`}
                                                        {trial.overallStatus && ` · ${trial.overallStatus}`}
                                                        {trial.primaryCompletionDate && ` · ${trial.primaryCompletionDate}`}
                                                    </span>
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                                {searched && trialResults.length === 0 && <p className="text-sm text-gray-500">{t('noTrials')}</p>}
                                <p className="text-xs text-gray-600">{t('trialsSelected', { count: selectedNctIds.size })}</p>

                                <div className="space-y-1.5">
                                    <Label htmlFor="catalyst-scenarios">{t('scenarios')}</Label>
                                    <textarea
                                        id="catalyst-scenarios"
                                        value={scenarioNotes}
                                        onChange={(e) => setScenarioNotes(e.target.value)}
                                        placeholder={t('scenariosPlaceholder')}
                                        rows={4}
                                        className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600"
                                    />
                                </div>
                            </div>

                            <DialogFooter>
                                <Button variant="ghost" onClick={() => setView('list')}>{t('cancel')}</Button>
                                <Button onClick={handleSave} disabled={saving || !symbol.trim() || !company.trim()} className="bg-teal-600 hover:bg-teal-500 text-white">
                                    {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                                    {t('save')}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
