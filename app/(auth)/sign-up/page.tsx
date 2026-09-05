'use client';

import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import InputField from "@/components/forms/InputField";
import SelectField from "@/components/forms/SelectField";
import PasswordRequirements from "@/components/forms/PasswordRequirements";
import SlideCaptcha from "@/components/forms/SlideCaptcha";
import { buildPasswordValidation, INVESTMENT_GOALS, PREFERRED_INDUSTRIES, RISK_TOLERANCE_OPTIONS } from "@/lib/constants";
import { CountrySelectField } from "@/components/forms/CountrySelectField";
import FooterLink from "@/components/forms/FooterLink";
import { signUpWithEmail } from "@/lib/actions/auth.actions";
import { describeAuthFailure } from "@/lib/auth-messages";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import React, { useState } from "react";
import { useTranslations } from "next-intl";
import PendingApprovalNotice from "@/components/forms/PendingApprovalNotice";

const SignUp = () => {
    const router = useRouter()
    const t = useTranslations('auth.signUp');
    const tValidation = useTranslations('auth.passwordValidation');
    const tOptions = useTranslations('options');
    const tCaptcha = useTranslations('auth.captcha');
    const [captchaToken, setCaptchaToken] = useState<string | null>(null);
    const [captchaKey, setCaptchaKey] = useState(0);
    const [captchaError, setCaptchaError] = useState<string | undefined>();
    const [pendingEmail, setPendingEmail] = useState<string | null>(null);
    const {
        register,
        handleSubmit,
        control,
        watch,
        formState: { errors, isSubmitting },
    } = useForm<SignUpFormData>({
        defaultValues: {
            fullName: '',
            email: '',
            password: '',
            country: 'IN',
            investmentGoals: 'Growth',
            riskTolerance: 'Medium',
            preferredIndustry: 'Technology'
        },
        mode: 'onBlur'
    },);

    const passwordValue = watch('password');

    // `value` is persisted to the DB and must stay in English; only the label is localized
    const localizeOptions = (
        options: { value: string; label: string }[],
        group: 'investmentGoals' | 'riskTolerance' | 'preferredIndustries',
    ) => options.map((option) => ({ ...option, label: tOptions(`${group}.${option.value}`) }));

    const onSubmit = async (data: SignUpFormData) => {
        if (!captchaToken) {
            setCaptchaError(tCaptcha('required'));
            return;
        }
        try {
            const result = await signUpWithEmail({ ...data, captchaToken });
            if (result.success) {
                if ('pendingApproval' in result) {
                    // no session was issued; show the "we'll review" screen in place of the form
                    setPendingEmail(data.email);
                    return;
                }
                router.push('/');
                return;
            }
            toast.error(t('toastErrorTitle'), {
                description: describeAuthFailure(result, t, 'toastErrorDescription'),
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

    if (pendingEmail) return <PendingApprovalNotice email={pendingEmail} />;

    return (
        <>
            <h1 className="form-title">{t('title')}</h1>
            <p className="form-subtitle">{t('subtitle')}</p>

            <form onSubmit={handleSubmit(onSubmit)} className="form-body" noValidate>
                <InputField
                    name="fullName"
                    label={t('fullNameLabel')}
                    placeholder={t('fullNamePlaceholder')}
                    autoComplete="name"
                    register={register}
                    error={errors.fullName}
                    validation={{ required: t('fullNameRequired'), minLength: 2 }}
                />

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

                <div>
                    <InputField
                        name="password"
                        label={t('passwordLabel')}
                        placeholder={t('passwordPlaceholder')}
                        type="password"
                        autoComplete="new-password"
                        register={register}
                        error={errors.password}
                        validation={buildPasswordValidation({
                            required: tValidation('required'),
                            minLength: tValidation('minLength'),
                            pattern: tValidation('pattern'),
                        })}
                    />
                    <PasswordRequirements password={passwordValue ?? ''} />
                </div>

                <h2 className="form-group-title">{t('profileSection')}</h2>

                <CountrySelectField
                    name="country"
                    label={t('countryLabel')}
                    control={control}
                    error={errors.country}
                    required
                />

                <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                        name="investmentGoals"
                        label={t('investmentGoalsLabel')}
                        placeholder={t('investmentGoalsPlaceholder')}
                        options={localizeOptions(INVESTMENT_GOALS, 'investmentGoals')}
                        control={control}
                        error={errors.investmentGoals}
                        required
                        requiredMessage={t('investmentGoalsRequired')}
                    />

                    <SelectField
                        name="riskTolerance"
                        label={t('riskToleranceLabel')}
                        placeholder={t('riskTolerancePlaceholder')}
                        options={localizeOptions(RISK_TOLERANCE_OPTIONS, 'riskTolerance')}
                        control={control}
                        error={errors.riskTolerance}
                        required
                        requiredMessage={t('riskToleranceRequired')}
                    />
                </div>

                <SelectField
                    name="preferredIndustry"
                    label={t('preferredIndustryLabel')}
                    placeholder={t('preferredIndustryPlaceholder')}
                    options={localizeOptions(PREFERRED_INDUSTRIES, 'preferredIndustries')}
                    control={control}
                    error={errors.preferredIndustry}
                    required
                    requiredMessage={t('preferredIndustryRequired')}
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
    )
}
export default SignUp;
