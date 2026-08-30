'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
    addCustomCatalyst,
    deleteCustomCatalyst,
    type CustomCatalystData,
    type CustomCatalystKind,
} from '@/lib/actions/catalyst.actions';

const KINDS: CustomCatalystKind[] = ['data-readout', 'pdufa', 'adcom', 'earnings', 'conference', 'other'];

export default function CustomCatalystSection({ items }: { items: CustomCatalystData[] }) {
    const t = useTranslations('catalyst.custom');
    const router = useRouter();

    const [open, setOpen] = useState(false);
    const [symbol, setSymbol] = useState('');
    const [title, setTitle] = useState('');
    const [date, setDate] = useState('');
    const [kind, setKind] = useState<CustomCatalystKind>('data-readout');
    const [saving, setSaving] = useState(false);

    const now = Date.now();

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
            toast.error(t('addFailed'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        await deleteCustomCatalyst(id);
        router.refresh();
    };

    return (
        <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs uppercase tracking-wide text-gray-500">{t('title')}</h3>
                <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-teal-400 h-6 px-2">
                    <Plus className="w-3.5 h-3.5 mr-0.5" />
                    {t('add')}
                </Button>
            </div>

            {items.length === 0 ? (
                <p className="text-xs text-gray-600">{t('empty')}</p>
            ) : (
                <ul className="space-y-2">
                    {items.map((ev) => {
                        const days = Math.ceil((Date.parse(ev.date) - now) / 86_400_000);
                        return (
                            <li key={ev.id} className="flex items-start justify-between gap-2 text-sm">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-gray-100">{ev.symbol}</span>
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                                            {t(`kind.${ev.kind}`)}
                                        </span>
                                        {ev.source === 'auto' && (
                                            <span className="text-xs text-teal-500/80 flex items-center gap-0.5" title={ev.note}>
                                                <Sparkles className="w-3 h-3" />
                                                {t('auto')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-gray-400 text-xs mt-0.5">{ev.title}</div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <span className={`text-xs font-semibold ${days >= 0 ? 'text-amber-400' : 'text-gray-600'}`}>
                                        {ev.date}
                                        {days >= 0 && ` · ${t('daysLeft', { days })}`}
                                    </span>
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleDelete(ev.id)}>
                                        <Trash2 className="w-3 h-3 text-gray-600 hover:text-red-400" />
                                    </Button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{t('dialogTitle')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="cc-symbol">{t('symbol')}</Label>
                                <Input
                                    id="cc-symbol"
                                    value={symbol}
                                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                                    placeholder="ABCL"
                                    className="bg-gray-800 border-gray-700"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="cc-date">{t('date')}</Label>
                                <Input
                                    id="cc-date"
                                    type="date"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                    className="bg-gray-800 border-gray-700"
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="cc-kind">{t('kindLabel')}</Label>
                            <select
                                id="cc-kind"
                                value={kind}
                                onChange={(e) => setKind(e.target.value as CustomCatalystKind)}
                                className="w-full h-9 rounded-md bg-gray-800 border border-gray-700 px-3 text-sm text-gray-100"
                            >
                                {KINDS.map((k) => (
                                    <option key={k} value={k}>
                                        {t(`kind.${k}`)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="cc-title">{t('eventTitle')}</Label>
                            <Input
                                id="cc-title"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder={t('titlePlaceholder')}
                                className="bg-gray-800 border-gray-700"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setOpen(false)}>
                            {t('cancel')}
                        </Button>
                        <Button
                            onClick={handleAdd}
                            disabled={saving || !symbol.trim() || !title.trim() || !date}
                            className="bg-teal-600 hover:bg-teal-500 text-white"
                        >
                            {t('save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
