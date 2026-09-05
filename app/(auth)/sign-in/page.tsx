'use client';

import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import InputField from '@/components/forms/InputField';
import FooterLink from '@/components/forms/FooterLink';
import SlideCaptcha from '@/components/forms/SlideCaptcha';
import { signInWithEmail } from "@/lib/actions/auth.actions";
import { describeAuthFailure } from "@/lib/auth-messages";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { useTranslations } from "next-intl";

const SignIn = () => {
    const router = useRouter()
    const t = useTranslations('auth.signIn');
    const tCaptcha = useTranslations('auth.captcha');
    const tValidation = useTranslations('auth.passwordValidation');
    const [captchaToken, setCaptchaToken] = useState<string | null>(null);
    const [captchaKey, setCaptchaKey] = useState(0);
    const [captchaError, setCaptchaError] = useState<string | undefined>();
    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<SignInFormData>({
        defaultValues: {
            email: '',
            password: '',
        },
        mode: 'onBlur',
    });

    const onSubmit = async (data: SignInFormData) => {
        if (!captchaToken) {
            setCaptchaError(tCaptcha('required'));
            return;
        }
        try {
            const result = await signInWithEmail({ ...data, captchaToken });
            if (result.success) {
                router.push('/');
                return;
            }
            toast.error(t('toastErrorTitle'), {
                description: describeAuthFailure(result, t, 'toastErrorGeneric'),
            });
        } catch (e) {
            console.error(e);
            toast.error(t('toastErrorTitle'), {
                description: e instanceof Error ? e.message : t('toastErrorGeneric')
            })
        }
        // tokens are single-use: a failed attempt needs a fresh slide
        setCaptchaToken(null);
        setCaptchaKey((k) => k + 1);
    }

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
                            message: t('emailInvalid')
                        }
                    }}
                />

                <InputField
                    name="password"
                    label={t('passwordLabel')}
                    placeholder={t('passwordPlaceholder')}
                    type="password"
                    autoComplete="current-password"
                    register={register}
                    error={errors.password}
                    validation={{
                        required: t('passwordRequired'),
                        minLength: { value: 8, message: tValidation('minLength') },
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

                <div className="form-links">
                    <Link href="/forgot-password" className="footer-link text-sm">
                        {t('forgotPassword')}
                    </Link>
                </div>

                <FooterLink text={t('footerText')} linkText={t('footerLink')} href="/sign-up" />
            </form>
        </>
    );
};
export default SignIn;
