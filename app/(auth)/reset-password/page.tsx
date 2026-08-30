import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';

import ResetPasswordForm from './ResetPasswordForm';

const ResetPasswordPage = async () => {
    const t = await getTranslations('auth.resetPassword');

    return (
        <Suspense fallback={<div className="text-sm text-gray-400">{t('loading')}</div>}>
            <ResetPasswordForm />
        </Suspense>
    );
};

export default ResetPasswordPage;
