import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isCurrentUserAdmin, listUsersForReview } from '@/lib/actions/admin.actions';
import UserReviewTable from '@/components/admin/UserReviewTable';

export default async function AdminUsersPage() {
    // Non-admins get a 404, not a hint that the page exists
    if (!(await isCurrentUserAdmin())) notFound();

    const t = await getTranslations('admin.users');
    const users = await listUsersForReview();
    const pending = users.filter((u) => u.status === 'pending').length;

    return (
        <div className="min-h-screen bg-black text-gray-100 p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                        {t('title')}
                    </h1>
                    <p className="text-gray-500 mt-1">{t('subtitle')}</p>
                </div>
                <span
                    className={`text-xs px-2 py-1 rounded-full ${
                        pending > 0 ? 'bg-amber-900/50 text-amber-300' : 'bg-teal-900/60 text-teal-300'
                    }`}
                >
                    ● {pending > 0 ? t('pendingCount', { n: pending }) : t('noPending')}
                </span>
            </div>

            <UserReviewTable users={users} />
        </div>
    );
}
