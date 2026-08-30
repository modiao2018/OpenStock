'use client';

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import FooterLink from '@/components/forms/FooterLink';
import InputField from '@/components/forms/InputField';
import PasswordRequirements from '@/components/forms/PasswordRequirements';
import OpenDevSocietyBranding from '@/components/OpenDevSocietyBranding';
import { Button } from '@/components/ui/button';
import { resetPasswordWithToken } from '@/lib/actions/auth.actions';
import { buildPasswordValidation } from '@/lib/constants';

type ResetPasswordFormData = {
    newPassword: string;
    confirmPassword: string;
};

const ResetPasswordForm = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token') ?? '';
    const error = searchParams.get('error');
    const t = useTranslations('auth.resetPassword');
    const tValidation = useTranslations('auth.passwordValidation');

    const {
        register,
        watch,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<ResetPasswordFormData>({
        defaultValues: {
            newPassword: '',
            confirmPassword: '',
        },
        mode: 'onBlur',
    });

    const newPassword = watch('newPassword');

    useEffect(() => {
        if (error === 'INVALID_TOKEN') {
            toast.error(t('invalidToken'));
        }
    }, [error, t]);

    const onSubmit = async (data: ResetPasswordFormData) => {
        if (!token) {
            toast.error(t('invalidToken'));
            return;
        }

        try {
            const result = await resetPasswordWithToken({
                token,
                newPassword: data.newPassword,
            });

            if (result.success) {
                toast.success(t('successToast'));
                router.push('/sign-in');
                return;
            }

            toast.error(t('toastErrorTitle'), {
                description: result.error ?? t('toastErrorGeneric'),
            });
        } catch (error) {
            toast.error(t('toastErrorTitle'), {
                description: error instanceof Error ? error.message : t('toastErrorGeneric'),
            });
        }
    };

    return (
        <>
            <h1 className="form-title">{t('title')}</h1>
            <p className="text-sm text-gray-400 mb-6">
                {t('subtitle')}
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <InputField
                    name="newPassword"
                    label={t('newPasswordLabel')}
                    placeholder={t('newPasswordPlaceholder')}
                    type="password"
                    register={register}
                    error={errors.newPassword}
                    validation={buildPasswordValidation({
                        required: tValidation('required'),
                        minLength: tValidation('minLength'),
                        pattern: tValidation('pattern'),
                    })}
                />
                <PasswordRequirements password={newPassword ?? ''} />

                <InputField
                    name="confirmPassword"
                    label={t('confirmPasswordLabel')}
                    placeholder={t('confirmPasswordPlaceholder')}
                    type="password"
                    register={register}
                    error={errors.confirmPassword}
                    validation={{
                        required: t('confirmPasswordRequired'),
                        validate: (value: string) =>
                            value === newPassword || t('passwordsMismatch'),
                    }}
                />

                <Button type="submit" disabled={isSubmitting} className="yellow-btn w-full mt-5">
                    {isSubmitting ? t('submitting') : t('submit')}
                </Button>

                <FooterLink text={t('footerText')} linkText={t('footerLink')} href="/forgot-password" />
                <OpenDevSocietyBranding outerClassName="mt-10 flex justify-center" />
            </form>
        </>
    );
};

export default ResetPasswordForm;
