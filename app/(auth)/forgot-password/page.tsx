'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import InputField from '@/components/forms/InputField';
import FooterLink from '@/components/forms/FooterLink';
import SlideCaptcha from '@/components/forms/SlideCaptcha';
import { requestPasswordResetEmail } from '@/lib/actions/auth.actions';
import { describeAuthFailure } from '@/lib/auth-messages';

type ForgotPasswordFormData = {
    email: string;
};

const ForgotPasswordPage = () => {
    const t = useTranslations('auth.forgotPassword');
    const tCaptcha = useTranslations('auth.captcha');
    const [captchaToken, setCaptchaToken] = useState<string | null>(null);
    const [captchaKey, setCaptchaKey] = useState(0);
    const [captchaError, setCaptchaError] = useState<string | undefined>();
    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<ForgotPasswordFormData>({
        defaultValues: {
            email: '',
        },
        mode: 'onBlur',
    });

    const onSubmit = async (data: ForgotPasswordFormData) => {
        if (!captchaToken) {
            setCaptchaError(tCaptcha('required'));
            return;
        }
        try {
            const result = await requestPasswordResetEmail({ ...data, captchaToken });

            if (result.success) {
                toast.success(t('successToast'));
                return;
            }

            toast.error(t('toastErrorTitle'), {
                description: describeAuthFailure(result, t, 'toastErrorGeneric'),
            });
        } catch (error) {
            toast.error(t('toastErrorTitle'), {
                description: error instanceof Error ? error.message : t('toastErrorGeneric'),
            });
        }
        // tokens are single-use: every request, sent or not, needs a fresh slide
        setCaptchaToken(null);
        setCaptchaKey((k) => k + 1);
    };

    return (
        <>
            <h1 className="form-title">{t('title')}</h1>
            <p className="form-subtitle">{t('subtitle')}</p>

            <form onSubmit={handleSubmit(onSubmit)} className="form-body" noValidate>
                <InputField
                    name="email"
                    label={t('emailLabel')}
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="email"
                    register={register}
                    error={errors.email}
                    validation={{
                        required: t('emailRequired'),
                        pattern: {
                            value: /^[\w-.]+@([\w-]+\.)+[\w-]{2,}$/,
                            message: t('emailInvalid'),
                        },
                    }}
                />

                <SlideCaptcha
                    key={captchaKey}
                    error={captchaError}
                    onChange={(token) => {
                        setCaptchaToken(token);
                        if (token) setCaptchaError(undefined);
                    }}
                />

                <Button type="submit" disabled={isSubmitting} className="primary-btn w-full">
                    {isSubmitting ? t('submitting') : t('submit')}
                </Button>

                <FooterLink text={t('footerText')} linkText={t('footerLink')} href="/sign-in" />
            </form>
        </>
    );
};

export default ForgotPasswordPage;
