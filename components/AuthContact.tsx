'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

const CONTACT_EMAIL = 'lxutong2026@gmail.com';

const AuthContact = () => {
    const t = useTranslations('auth.layout');
    return (
        <p className="mt-10 text-center text-sm text-gray-500">
            {t('contact')}
            <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="ml-1 text-gray-400 hover:text-teal-400 transition-colors"
            >
                {CONTACT_EMAIL}
            </a>
        </p>
    );
};

export default AuthContact;
