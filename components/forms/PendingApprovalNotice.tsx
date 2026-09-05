'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Hourglass } from 'lucide-react';

// Shown in place of the sign-up form once the account exists but is waiting
// for a reviewer. There is nothing the person can do here except leave.
const PendingApprovalNotice = ({ email }: { email: string }) => {
    const t = useTranslations('auth.pending');
    return (
        <div className="flex flex-col items-center text-center">
            <span className="mb-5 flex size-14 items-center justify-center rounded-full bg-teal-400/10 text-teal-400">
                <Hourglass className="size-6" />
            </span>
            <h1 className="form-title">{t('title')}</h1>
            <p className="form-subtitle max-w-[34ch]">{t('body', { email })}</p>
            <p className="mt-4 text-[13px] leading-relaxed text-gray-500 max-w-[36ch]">{t('hint')}</p>
            <div className="form-footer mt-8 w-full">
                <Link href="/sign-in" className="footer-link text-sm">
                    {t('backToSignIn')}
                </Link>
            </div>
        </div>
    );
};

export default PendingApprovalNotice;
