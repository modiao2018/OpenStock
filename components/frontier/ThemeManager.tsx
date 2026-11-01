'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { deleteFrontierTheme, saveFrontierTheme, type FrontierThemeData, type ThemeTickerData } from '@/lib/actions/frontier.actions';
import type { TickerTier } from '@/lib/frontier-math';

interface Form {
    id?: string;
    key: string;
    name: string;
    nameEn: string;
    description: string;
    keywordsText: string;
    trialField: 'query.intr' | 'query.cond';
    trialTerm: string;
    tickersText: string;
    enabled: boolean;
}

const TIERS: TickerTier[] = ['pure', 'pharma', 'tools'];

// 标的一行一个："RXRX | Recursion Pharmaceuticals | pure | Recursion, Exscientia"
function tickersToText(list: ThemeTickerData[]): string {
    return list.map((x) => [x.symbol, x.company, x.tier, x.aliases.join(', ')].join(' | ').replace(/ \| $/, '')).join('\n');
}

function textToTickers(text: string): ThemeTickerData[] {
    return text
        .split('\n')
        .map((line) => line.split('|').map((s) => s.trim()))
        .filter((p) => p[0] && p[1])
        .map(([symbol, company, tier, aliases]) => ({
            symbol: symbol.toUpperCase(),
            company,
            tier: (TIERS as string[]).includes(tier ?? '') ? (tier as TickerTier) : 'pure',
            aliases: (aliases ?? '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        }));
}

function toForm(x?: FrontierThemeData): Form {
    if (!x) return { key: '', name: '', nameEn: '', description: '', keywordsText: '', trialField: 'query.intr', trialTerm: '', tickersText: '', enabled: true };
    return {
        id: x.id,
        key: x.key,
        name: x.name,
        nameEn: x.nameEn,
        description: x.description,
        keywordsText: x.keywords.join(', '),
        trialField: x.trialField,
        trialTerm: x.trialTerm,
        tickersText: tickersToText(x.tickers),
        enabled: x.enabled,
    };
}

/** 主题管理：页头按钮打开，列表 ↔ 编辑双视图（与催化剂监控清单的交互一致） */
export default function ThemeManager({ themes }: { themes: FrontierThemeData[] }) {
    const t = useTranslations('frontier.themeManager');
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState<Form | null>(null);
    const [saving, setSaving] = useState(false);

    const save = async () => {
        if (!form) return;
        setSaving(true);
        try {
            await saveFrontierTheme({
                id: form.id,
                key: form.key,
                name: form.name,
                nameEn: form.nameEn,
                description: form.description,
                keywords: form.keywordsText.split(/[,，\n]/),
                trialField: form.trialField,
                trialTerm: form.trialTerm,
                tickers: textToTickers(form.tickersText),
                enabled: form.enabled,
            });
            toast.success(t('saved'));
            setForm(null);
            router.refresh();
        } catch {
            toast.error(t('saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    const remove = async (x: FrontierThemeData) => {
        if (!window.confirm(t('confirmDelete', { name: x.name }))) return;
        try {
            await deleteFrontierTheme(x.id);
            router.refresh();
        } catch {
            toast.error(t('saveFailed'));
        }
    };

    const field = (key: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
        <div>
            <Label className="text-gray-400">{label}</Label>
            <Input
                value={String(form?.[key] ?? '')}
                onChange={(e) => form && setForm({ ...form, [key]: e.target.value })}
                className="bg-gray-950 border-gray-700"
                {...props}
            />
        </div>
    );

    return (
        <>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="border-gray-700 text-gray-200">
                <Settings2 className="w-4 h-4 mr-1.5" />
                {t('button')}
            </Button>
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(null); }}>
                <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {form && (
                                <button type="button" onClick={() => setForm(null)} className="text-gray-400 hover:text-gray-200" aria-label={t('back')}>
                                    <ArrowLeft className="w-4 h-4" />
                                </button>
                            )}
                            {form ? (form.id ? t('editTitle') : t('addTitle')) : t('title')}
                        </DialogTitle>
                    </DialogHeader>

                    {!form ? (
                        <>
                            <p className="text-xs text-gray-500">{t('hint')}</p>
                            <ul className="divide-y divide-gray-800">
                                {themes.map((x) => (
                                    <li key={x.id} className="flex items-center justify-between py-2.5">
                                        <span>
                                            <span className={x.enabled ? 'text-gray-100' : 'text-gray-500 line-through'}>{x.name}</span>
                                            <span className="text-xs text-gray-500 ml-2">{t('summary', { k: x.keywords.length, n: x.tickers.length })}</span>
                                        </span>
                                        <span className="flex gap-1">
                                            <Button variant="ghost" size="sm" onClick={() => setForm(toForm(x))} aria-label={t('edit')}>
                                                <Pencil className="w-4 h-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => remove(x)} aria-label={t('delete')}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            <DialogFooter>
                                <Button onClick={() => setForm(toForm())} className="bg-teal-600 hover:bg-teal-500 text-white">
                                    <Plus className="w-4 h-4 mr-1" />
                                    {t('add')}
                                </Button>
                            </DialogFooter>
                        </>
                    ) : (
                        <>
                            <div className="space-y-3">
                                <div className="grid grid-cols-3 gap-3">
                                    {field('key', t('form.key'), { disabled: Boolean(form.id), placeholder: 'ai-drug' })}
                                    {field('name', t('form.name'))}
                                    {field('nameEn', t('form.nameEn'))}
                                </div>
                                <div>
                                    <Label className="text-gray-400">{t('form.description')}</Label>
                                    <textarea
                                        value={form.description}
                                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                                        rows={2}
                                        className="w-full rounded-md bg-gray-950 border border-gray-700 px-3 py-2 text-sm"
                                    />
                                </div>
                                <div>
                                    <Label className="text-gray-400">{t('form.keywords')}</Label>
                                    <textarea
                                        value={form.keywordsText}
                                        onChange={(e) => setForm({ ...form, keywordsText: e.target.value })}
                                        rows={3}
                                        className="w-full rounded-md bg-gray-950 border border-gray-700 px-3 py-2 text-sm"
                                    />
                                    <p className="text-xs text-gray-600 mt-1">{t('form.keywordsHint')}</p>
                                </div>
                                <div>
                                    <Label className="text-gray-400">{t('form.tickers')}</Label>
                                    <textarea
                                        value={form.tickersText}
                                        onChange={(e) => setForm({ ...form, tickersText: e.target.value })}
                                        rows={6}
                                        className="w-full rounded-md bg-gray-950 border border-gray-700 px-3 py-2 text-sm font-mono"
                                    />
                                    <p className="text-xs text-gray-600 mt-1">{t('form.tickersHint')}</p>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <Label className="text-gray-400">{t('form.trialField')}</Label>
                                        <select
                                            value={form.trialField}
                                            onChange={(e) => setForm({ ...form, trialField: e.target.value as Form['trialField'] })}
                                            className="w-full h-9 rounded-md bg-gray-950 border border-gray-700 px-2 text-sm"
                                        >
                                            <option value="query.intr">{t('form.trialIntr')}</option>
                                            <option value="query.cond">{t('form.trialCond')}</option>
                                        </select>
                                    </div>
                                    <div className="col-span-2">{field('trialTerm', t('form.trialTerm'), { placeholder: 'CRISPR OR base editing' })}</div>
                                </div>
                                <label className="flex items-center gap-2 text-sm text-gray-400">
                                    <input type="checkbox" className="accent-teal-500" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                                    {t('form.enabled')}
                                </label>
                            </div>
                            <DialogFooter>
                                <Button variant="ghost" onClick={() => setForm(null)}>{t('cancel')}</Button>
                                <Button onClick={save} disabled={saving || !form.key.trim() || !form.name.trim()} className="bg-teal-600 hover:bg-teal-500 text-white">
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
