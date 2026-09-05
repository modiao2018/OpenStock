'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setUserApproval, type ReviewableUser } from '@/lib/actions/admin.actions';
import type { ApprovalStatus } from '@/lib/admin';
import { formatClock } from '@/lib/format-time';
import { cn } from '@/lib/utils';

const STATUS_CLS: Record<ApprovalStatus, string> = {
    pending: 'bg-amber-900/50 text-amber-300',
    approved: 'bg-teal-900/60 text-teal-300',
    rejected: 'bg-red-900/50 text-red-300',
};

type Filter = 'pending' | 'all';

export default function UserReviewTable({ users }: { users: ReviewableUser[] }) {
    const t = useTranslations('admin.users');
    const locale = useLocale();
    const router = useRouter();
    const [filter, setFilter] = useState<Filter>(users.some((u) => u.status === 'pending') ? 'pending' : 'all');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [, startTransition] = useTransition();

    const rows = filter === 'pending' ? users.filter((u) => u.status === 'pending') : users;

    const review = (user: ReviewableUser, status: 'approved' | 'rejected') => {
        if (status === 'rejected' && !confirm(t('confirmReject', { email: user.email }))) return;
        setBusyId(user.id);
        startTransition(async () => {
            const res = await setUserApproval(user.id, status);
            setBusyId(null);
            if (res.ok) {
                toast.success(t(status === 'approved' ? 'approvedToast' : 'rejectedToast', { email: user.email }));
                router.refresh();
            } else {
                toast.error(t(`error.${res.error}`));
            }
        });
    };

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                {(['pending', 'all'] as Filter[]).map((f) => (
                    <button
                        key={f}
                        type="button"
                        onClick={() => setFilter(f)}
                        className={cn(
                            'rounded-full px-3 py-1 text-sm transition-colors',
                            filter === f ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300',
                        )}
                    >
                        {t(`filter.${f}`)}
                    </button>
                ))}
            </div>

            {rows.length === 0 ? (
                <div className="text-center py-12 bg-gray-900/50 rounded-lg border border-gray-800">
                    <p className="text-gray-500">{t(filter === 'pending' ? 'emptyPending' : 'emptyAll')}</p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-md shadow-xl">
                    <table className="w-full text-left text-sm border-collapse">
                        <thead className="bg-white/5 text-gray-400 font-medium border-b border-white/10">
                            <tr>
                                <th className="px-6 py-4 font-semibold tracking-wide">{t('headers.user')}</th>
                                <th className="px-6 py-4 font-semibold tracking-wide">{t('headers.registered')}</th>
                                <th className="px-6 py-4 font-semibold tracking-wide">{t('headers.status')}</th>
                                <th className="px-6 py-4 font-semibold tracking-wide text-right">{t('headers.actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                            {rows.map((u) => {
                                const busy = busyId === u.id;
                                return (
                                    <tr key={u.id} className="hover:bg-white/[0.03] transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 font-medium text-white">
                                                {u.name || '—'}
                                                {u.isAdmin && (
                                                    <span title={t('adminBadge')} className="text-teal-400">
                                                        <ShieldCheck className="size-4" />
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-500">{u.email}</div>
                                        </td>
                                        <td className="px-6 py-4 text-gray-400 tabular-nums">{formatClock(u.createdAt, locale)}</td>
                                        <td className="px-6 py-4">
                                            <span className={`text-xs px-2 py-1 rounded-full ${STATUS_CLS[u.status]}`}>
                                                {t(`status.${u.status}`)}
                                            </span>
                                            {u.status === 'approved' && u.approvedAt && (
                                                <span className="ml-2 text-xs text-gray-600 tabular-nums">{formatClock(u.approvedAt, locale)}</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex justify-end gap-2">
                                                {u.status !== 'approved' && (
                                                    <Button
                                                        size="sm"
                                                        disabled={busy}
                                                        onClick={() => review(u, 'approved')}
                                                        className="bg-teal-500 text-gray-900 hover:bg-teal-400"
                                                    >
                                                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                                                        {t('approve')}
                                                    </Button>
                                                )}
                                                {u.status !== 'rejected' && !u.isAdmin && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={busy}
                                                        onClick={() => review(u, 'rejected')}
                                                        className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                                                    >
                                                        <X className="size-4" />
                                                        {t('reject')}
                                                    </Button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
