'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { deleteConference, saveConference, type ConferenceData } from '@/lib/actions/frontier.actions';
import { daysBetween } from '@/lib/frontier-math';
import { Card } from './shared';

const EMPTY = { name: '', startDate: '', precision: 'day' as 'day' | 'month', dateText: '', note: '', verified: true, themes: [] as string[] };

/** 行业会议倒计时：种子日期是按惯例估计的，标"待核实"；用户核对官网后可改成具体日期 */
export default function ConferencePanel({ conferences, themeNames }: { conferences: ConferenceData[]; themeNames: Record<string, string> }) {
    const t = useTranslations('frontier.conferences');
    const router = useRouter();
    const [editing, setEditing] = useState<(typeof EMPTY & { id?: string }) | null>(null);
    const [saving, setSaving] = useState(false);
    const today = new Date().toISOString().slice(0, 10);

    const save = async () => {
        if (!editing) return;
        setSaving(true);
        try {
            await saveConference(editing);
            setEditing(null);
            router.refresh();
        } catch {
            toast.error(t('saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    const remove = async (id: string) => {
        if (!window.confirm(t('confirmDelete'))) return;
        await deleteConference(id).catch(() => toast.error(t('saveFailed')));
        router.refresh();
    };

    return (
        <Card
            title={t('title')}
            icon={<CalendarDays className="w-5 h-5 text-teal-500" />}
            hint={t('hint')}
            actions={
                <Button variant="ghost" size="sm" onClick={() => setEditing({ ...EMPTY })} aria-label={t('add')}>
                    <Plus className="w-4 h-4" />
                </Button>
            }
        >
            {conferences.length === 0 ? (
                <p className="text-sm text-gray-500">{t('empty')}</p>
            ) : (
                <ul className="space-y-2.5">
                    {conferences.slice(0, 10).map((c) => {
                        const days = daysBetween(today, c.startDate);
                        return (
                            <li key={c.id} className="group text-sm">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-gray-200 truncate" title={c.note}>{c.name}</span>
                                    <span className="shrink-0 flex items-center gap-1">
                                        <span className="text-xs tabular-nums text-gray-400">
                                            {c.precision === 'day' ? (days <= 0 ? t('ongoing') : t('inDays', { n: days })) : c.dateText}
                                        </span>
                                        <button type="button" onClick={() => setEditing({ ...c })} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-300" aria-label={t('edit')}>
                                            <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                        <button type="button" onClick={() => remove(c.id)} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400" aria-label={t('delete')}>
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </span>
                                </div>
                                <div className="text-xs text-gray-600 mt-0.5 flex flex-wrap gap-x-2">
                                    {c.precision === 'day' && <span>{c.dateText || c.startDate}</span>}
                                    {c.themes.slice(0, 3).map((k) => <span key={k}>{themeNames[k] ?? k}</span>)}
                                    {!c.verified && <span className="text-amber-500/80">{t('unverified')}</span>}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
                <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editing?.id ? t('edit') : t('add')}</DialogTitle>
                    </DialogHeader>
                    {editing && (
                        <div className="space-y-3">
                            <div>
                                <Label className="text-gray-400">{t('name')}</Label>
                                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="bg-gray-950 border-gray-700" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-gray-400">{t('startDate')}</Label>
                                    <Input type="date" value={editing.startDate} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} className="bg-gray-950 border-gray-700" />
                                </div>
                                <div>
                                    <Label className="text-gray-400">{t('precision')}</Label>
                                    <select
                                        value={editing.precision}
                                        onChange={(e) => setEditing({ ...editing, precision: e.target.value as 'day' | 'month' })}
                                        className="w-full h-9 rounded-md bg-gray-950 border border-gray-700 px-2 text-sm"
                                    >
                                        <option value="day">{t('precisionDay')}</option>
                                        <option value="month">{t('precisionMonth')}</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <Label className="text-gray-400">{t('dateText')}</Label>
                                <Input value={editing.dateText} onChange={(e) => setEditing({ ...editing, dateText: e.target.value })} className="bg-gray-950 border-gray-700" />
                            </div>
                            <div>
                                <Label className="text-gray-400">{t('note')}</Label>
                                <Input value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} className="bg-gray-950 border-gray-700" />
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {Object.entries(themeNames).map(([k, name]) => {
                                    const on = editing.themes.includes(k);
                                    return (
                                        <button
                                            key={k}
                                            type="button"
                                            onClick={() => setEditing({ ...editing, themes: on ? editing.themes.filter((x) => x !== k) : [...editing.themes, k] })}
                                            className={`text-xs px-2 py-1 rounded-full border ${on ? 'border-teal-600 text-teal-300' : 'border-gray-700 text-gray-500'}`}
                                        >
                                            {name}
                                        </button>
                                    );
                                })}
                            </div>
                            <label className="flex items-center gap-2 text-sm text-gray-400">
                                <input type="checkbox" className="accent-teal-500" checked={editing.verified} onChange={(e) => setEditing({ ...editing, verified: e.target.checked })} />
                                {t('verified')}
                            </label>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Button>
                        <Button onClick={save} disabled={saving || !editing?.name || !editing?.startDate} className="bg-teal-600 hover:bg-teal-500 text-white">
                            {t('save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
