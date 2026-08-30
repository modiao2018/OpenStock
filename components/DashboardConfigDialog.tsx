'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CATALOG_INDUSTRIES, DEFAULT_DASHBOARD_SYMBOLS } from '@/lib/dashboard-catalog';
import { saveDashboardSymbols } from '@/lib/actions/dashboard.actions';

interface DashboardConfigDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentSymbols: string[];
}

const DashboardConfigDialog = ({ open, onOpenChange, currentSymbols }: DashboardConfigDialogProps) => {
    const t = useTranslations('dashboardConfig');
    const tSectors = useTranslations('sectors');
    const router = useRouter();
    const [selected, setSelected] = useState<Set<string>>(new Set(currentSymbols));
    const [isPending, startTransition] = useTransition();

    // Re-seed the draft from the saved config each time the dialog opens
    useEffect(() => {
        if (open) setSelected(new Set(currentSymbols));
    }, [open, currentSymbols]);

    const sectorLabel = (industry: string) =>
        tSectors.has(industry) ? tSectors(industry) : industry;

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

    const handleSave = () => {
        startTransition(async () => {
            const result = await saveDashboardSymbols([...selected]);
            if (result.ok) {
                toast.success(t('saved'));
                onOpenChange(false);
                router.refresh();
            } else {
                toast.error(t('saveFailed'));
            }
        });
    };

    const chipClass = (active: boolean) =>
        `rounded-md border px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer ${
            active
                ? 'border-teal-500 bg-teal-500/10 text-teal-400'
                : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
        }`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl border-gray-700 bg-gray-900 text-gray-100">
                <DialogHeader>
                    <DialogTitle>{t('title')}</DialogTitle>
                    <DialogDescription className="text-gray-400">{t('description')}</DialogDescription>
                </DialogHeader>

                <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-2">
                    {CATALOG_INDUSTRIES.map(({ industry, symbols }) => {
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
                                    {symbols.map((symbol) => (
                                        <button
                                            key={symbol}
                                            type="button"
                                            className={chipClass(selected.has(symbol))}
                                            onClick={() => toggleStock(symbol)}
                                        >
                                            {symbol}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <DialogFooter className="flex items-center gap-2 sm:justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">{t('selectedCount', { count: selected.size })}</span>
                        <button
                            type="button"
                            className="text-xs text-gray-400 hover:text-teal-400 cursor-pointer"
                            onClick={() => setSelected(new Set(DEFAULT_DASHBOARD_SYMBOLS))}
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
                            disabled={isPending || selected.size === 0}
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
