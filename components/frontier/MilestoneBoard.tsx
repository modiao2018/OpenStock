'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, ExternalLink, FlaskConical, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
    deleteMilestone,
    resolveMilestoneProposal,
    resolveProposedDrug,
    saveMilestone,
    type MilestoneData,
    type MilestoneInput,
} from '@/lib/actions/frontier.actions';
import { formatClock } from '@/lib/format-time';
import { Card } from './shared';

const PHASES = [1, 2, 3];
const STATUS_CLASS: Record<string, string> = {
    RECRUITING: 'text-teal-300',
    ACTIVE_NOT_RECRUITING: 'text-sky-300',
    COMPLETED: 'text-amber-300',
    NOT_YET_RECRUITING: 'text-gray-400',
    ENROLLING_BY_INVITATION: 'text-teal-300',
};

/** 临床阶段进度条：P1/P2/P3 三格，点亮到登记库里的最高阶段 */
function PhaseBar({ phase }: { phase: number }) {
    return (
        <div className="flex gap-0.5" aria-label={`phase ${phase}`}>
            {PHASES.map((p) => (
                <span
                    key={p}
                    className={`h-2 w-7 rounded-sm ${phase >= p ? (p === 3 ? 'bg-amber-400' : 'bg-teal-500') : phase >= p - 0.5 && phase > 0 ? 'bg-teal-900' : 'bg-gray-800'}`}
                />
            ))}
        </div>
    );
}

const EMPTY: MilestoneInput = { drug: '', aliases: [], company: '', symbol: '', approach: '', indication: '' };

export default function MilestoneBoard({ milestones }: { milestones: MilestoneData[] }) {
    const t = useTranslations('frontier.milestones');
    const locale = useLocale();
    const router = useRouter();
    const [editing, setEditing] = useState<(MilestoneInput & { aliasesText: string }) | null>(null);
    const [saving, setSaving] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);

    const active = milestones.filter((m) => m.status === 'active');
    const proposed = milestones.filter((m) => m.status === 'proposed');
    const byPhase = (n: number) => active.filter((m) => (m.registry?.maxPhase ?? 0) >= n && (m.registry?.maxPhase ?? 0) < n + 1).length;

    const run = async (fn: () => Promise<unknown>) => {
        try {
            await fn();
            router.refresh();
        } catch {
            toast.error(t('failed'));
        }
    };

    const openEdit = (m?: MilestoneData) =>
        setEditing(
            m
                ? { id: m.id, drug: m.drug, aliases: m.aliases, company: m.company, symbol: m.symbol ?? '', approach: m.approach, indication: m.indication, aliasesText: m.aliases.join(', ') }
                : { ...EMPTY, aliasesText: '' },
        );

    const save = async () => {
        if (!editing) return;
        setSaving(true);
        try {
            await saveMilestone({ ...editing, aliases: editing.aliasesText.split(/[,，]/).map((s) => s.trim()).filter(Boolean) });
            setEditing(null);
            router.refresh();
        } catch {
            toast.error(t('failed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                    { label: t('countTotal'), n: active.length },
                    { label: 'P1', n: byPhase(1) },
                    { label: 'P2', n: byPhase(2) },
                    { label: 'P3', n: byPhase(3) + active.filter((m) => (m.registry?.maxPhase ?? 0) >= 4).length },
                ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-gray-800 bg-gray-900/40 p-3">
                        <div className="text-xs text-gray-500">{s.label}</div>
                        <div className="text-2xl font-semibold tabular-nums text-gray-100 mt-1">{s.n}</div>
                    </div>
                ))}
            </div>

            {proposed.length > 0 && (
                <Card title={t('proposedTitle')} icon={<Sparkles className="w-5 h-5 text-amber-400" />} hint={t('proposedHint')}>
                    <ul className="space-y-2">
                        {proposed.map((m) => (
                            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 p-2.5 text-sm">
                                <span>
                                    <span className="text-gray-100">{m.drug}</span>
                                    <span className="text-xs text-gray-400 ml-2">{m.company}{m.symbol ? ` (${m.symbol})` : ''} · {m.indication} · {m.approach}</span>
                                    {m.history[0] && (
                                        <span className="block text-xs text-gray-500 mt-0.5">
                                            {m.history[0].url ? <a href={m.history[0].url} target="_blank" rel="noopener noreferrer" className="hover:text-teal-400">{m.history[0].text}</a> : m.history[0].text}
                                        </span>
                                    )}
                                </span>
                                <span className="flex gap-1.5">
                                    <Button size="sm" onClick={() => run(() => resolveProposedDrug(m.id, true))} className="h-7 bg-teal-600 hover:bg-teal-500 text-white">
                                        <Check className="w-3.5 h-3.5 mr-1" />{t('accept')}
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => run(() => resolveProposedDrug(m.id, false))} className="h-7 text-gray-400">
                                        <X className="w-3.5 h-3.5 mr-1" />{t('reject')}
                                    </Button>
                                </span>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            <Card
                title={t('title')}
                icon={<FlaskConical className="w-5 h-5 text-teal-500" />}
                hint={t('hint')}
                actions={
                    <Button size="sm" variant="outline" onClick={() => openEdit()} className="border-gray-700 text-gray-200">
                        <Plus className="w-4 h-4 mr-1" />{t('add')}
                    </Button>
                }
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                                <th className="pb-2 pr-3 font-normal">{t('col.drug')}</th>
                                <th className="pb-2 pr-3 font-normal">{t('col.company')}</th>
                                <th className="pb-2 pr-3 font-normal hidden lg:table-cell">{t('col.approach')}</th>
                                <th className="pb-2 pr-3 font-normal">{t('col.indication')}</th>
                                <th className="pb-2 pr-3 font-normal">{t('col.phase')}</th>
                                <th className="pb-2 pr-3 font-normal">{t('col.readout')}</th>
                                <th className="pb-2 font-normal" />
                            </tr>
                        </thead>
                        <tbody>
                            {active.map((m) => {
                                const r = m.registry;
                                const open = expanded === m.id;
                                return (
                                    <React.Fragment key={m.id}>
                                        <tr className="border-b border-gray-800/60 align-top hover:bg-gray-900/40 cursor-pointer" onClick={() => setExpanded(open ? null : m.id)}>
                                            <td className="py-2.5 pr-3">
                                                <span className="text-gray-100">{m.drug}</span>
                                                {m.proposals.length > 0 && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-900/60 text-amber-300">{t('proposalCount', { n: m.proposals.length })}</span>}
                                            </td>
                                            <td className="py-2.5 pr-3 text-gray-300">
                                                {m.company}
                                                {m.symbol && (
                                                    <Link href={`/stocks/${m.symbol}`} onClick={(e) => e.stopPropagation()} className="ml-1.5 text-xs text-teal-400 hover:text-teal-300">
                                                        {m.symbol}
                                                    </Link>
                                                )}
                                                {!m.symbol && <span className="ml-1.5 text-xs text-gray-600">{t('private')}</span>}
                                            </td>
                                            <td className="py-2.5 pr-3 text-xs text-gray-400 hidden lg:table-cell max-w-56">{m.approach}</td>
                                            <td className="py-2.5 pr-3 text-xs text-gray-300">{m.indication}</td>
                                            <td className="py-2.5 pr-3">
                                                {r ? (
                                                    <>
                                                        <PhaseBar phase={r.maxPhase} />
                                                        <span className={`text-xs ${STATUS_CLASS[r.leadStatus ?? ''] ?? 'text-gray-500'}`}>
                                                            {r.leadStatus ? (t.has(`status.${r.leadStatus}`) ? t(`status.${r.leadStatus}`) : r.leadStatus) : '—'}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span className="text-xs text-gray-600">{t('notChecked')}</span>
                                                )}
                                            </td>
                                            <td className="py-2.5 pr-3 text-xs tabular-nums text-gray-300">{r?.nextReadout ?? '—'}</td>
                                            <td className="py-2.5 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                                                <button type="button" onClick={() => openEdit(m)} className="text-gray-500 hover:text-gray-300 mr-2" aria-label={t('edit')}>
                                                    <Pencil className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => window.confirm(t('confirmDelete', { drug: m.drug })) && run(() => deleteMilestone(m.id))}
                                                    className="text-gray-500 hover:text-red-400"
                                                    aria-label={t('delete')}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </td>
                                        </tr>
                                        {(open || m.proposals.length > 0) && (
                                            <tr className="border-b border-gray-800/60">
                                                <td colSpan={7} className="pb-3 pt-1 text-xs">
                                                    {m.proposals.map((p) => (
                                                        <div key={p.id} className="flex flex-wrap items-center gap-2 rounded bg-amber-950/30 border border-amber-900/40 px-2 py-1.5 mb-1.5">
                                                            <span className="text-amber-300">{t('aiProposal')}</span>
                                                            <span className="text-gray-200 flex-1">{p.text}</span>
                                                            {p.url && (
                                                                <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-teal-400">
                                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                                </a>
                                                            )}
                                                            <button type="button" onClick={() => run(() => resolveMilestoneProposal(m.id, p.id, true))} className="text-teal-400 hover:text-teal-300">{t('accept')}</button>
                                                            <button type="button" onClick={() => run(() => resolveMilestoneProposal(m.id, p.id, false))} className="text-gray-500 hover:text-gray-300">{t('ignore')}</button>
                                                        </div>
                                                    ))}
                                                    {open && (
                                                        <div className="grid md:grid-cols-2 gap-4 mt-1">
                                                            <div>
                                                                <h4 className="text-gray-500 mb-1">{t('registry')}</h4>
                                                                {r ? (
                                                                    <p className="text-gray-400 leading-relaxed">
                                                                        {t('registryLine', { n: r.trialCount, time: r.checkedAt ? formatClock(r.checkedAt, locale) : '—' })}
                                                                        <br />
                                                                        {r.nctIds.slice(0, 8).map((id) => (
                                                                            <a key={id} href={`https://clinicaltrials.gov/study/${id}`} target="_blank" rel="noopener noreferrer" className="mr-2 text-teal-500 hover:text-teal-400">
                                                                                {id}
                                                                            </a>
                                                                        ))}
                                                                    </p>
                                                                ) : (
                                                                    <p className="text-gray-600">{t('notChecked')}</p>
                                                                )}
                                                                <p className="text-gray-600 mt-1">{t('aliases')}：{m.aliases.join(', ')}</p>
                                                            </div>
                                                            <div>
                                                                <h4 className="text-gray-500 mb-1">{t('history')}</h4>
                                                                {m.history.length === 0 ? (
                                                                    <p className="text-gray-600">{t('noHistory')}</p>
                                                                ) : (
                                                                    <ul className="space-y-1">
                                                                        {m.history.map((h, i) => (
                                                                            <li key={i} className="text-gray-400">
                                                                                <span className="text-gray-600 mr-1.5">{formatClock(h.at, locale)}</span>
                                                                                {h.url ? <a href={h.url} target="_blank" rel="noopener noreferrer" className="hover:text-teal-400">{h.text}</a> : h.text}
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-gray-600 mt-3 leading-relaxed">{t('footnote')}</p>
            </Card>

            <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
                <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editing?.id ? t('edit') : t('add')}</DialogTitle>
                    </DialogHeader>
                    {editing && (
                        <div className="space-y-3">
                            {(
                                [
                                    ['drug', 'drug'],
                                    ['aliasesText', 'aliasesInput'],
                                    ['company', 'company'],
                                    ['symbol', 'symbol'],
                                    ['indication', 'indication'],
                                    ['approach', 'approach'],
                                ] as const
                            ).map(([field, label]) => (
                                <div key={field}>
                                    <Label className="text-gray-400">{t(`form.${label}`)}</Label>
                                    <Input value={editing[field]} onChange={(e) => setEditing({ ...editing, [field]: e.target.value })} className="bg-gray-950 border-gray-700" />
                                </div>
                            ))}
                            <p className="text-xs text-gray-500">{t('form.hint')}</p>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Button>
                        <Button onClick={save} disabled={saving || !editing?.drug.trim()} className="bg-teal-600 hover:bg-teal-500 text-white">
                            {t('save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
