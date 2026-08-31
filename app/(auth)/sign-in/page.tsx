'use client';

import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import InputField from '@/components/forms/InputField';
import FooterLink from '@/components/forms/FooterLink';
import { signInWithEmail } from "@/lib/actions/auth.actions";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthContact from "@/components/AuthContact";
import React from "react";
import { useTranslations } from "next-intl";

const SignIn = () => {
    const router = useRouter()
    const t = useTranslations('auth.signIn');
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
        try {
            const result = await signInWithEmail(data);
            if (result.success) {
                router.push('/');
                return;
            }
            toast.error(t('toastErrorTitle'), {
                description: result.error ?? t('toastErrorInvalid'),
            });
        } catch (e) {
            console.error(e);
            toast.error(t('toastErrorTitle'), {
                description: e instanceof Error ? e.message : t('toastErrorGeneric')
            })
        }
    }

    return (
        <>
            <h1 className="form-title">{t('title')}</h1>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <InputField
                    name="email"
                    label={t('emailLabel')}
                    placeholder="you@example.com"
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
                    register={register}
                    error={errors.password}
                    validation={{ required: t('passwordRequired'), minLength: 8 }}
                />

                <div className="flex justify-end">
                    <Link href="/forgot-password" className="footer-link text-sm">
                        {t('forgotPassword')}
                    </Link>
                </div>

                <Button type="submit" disabled={isSubmitting} className="yellow-btn w-full mt-5">
                    {isSubmitting ? t('submitting') : t('submit')}
                </Button>

                <FooterLink text={t('footerText')} linkText={t('footerLink')} href="/sign-up" />
                <AuthContact />
            </form>
        </>
    );
};
export default SignIn;
