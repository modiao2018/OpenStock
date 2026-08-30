'use client';

import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import InputField from "@/components/forms/InputField";
import SelectField from "@/components/forms/SelectField";
import PasswordRequirements from "@/components/forms/PasswordRequirements";
import { buildPasswordValidation, INVESTMENT_GOALS, PREFERRED_INDUSTRIES, RISK_TOLERANCE_OPTIONS } from "@/lib/constants";
import { CountrySelectField } from "@/components/forms/CountrySelectField";
import FooterLink from "@/components/forms/FooterLink";
import { signUpWithEmail } from "@/lib/actions/auth.actions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import OpenDevSocietyBranding from "@/components/OpenDevSocietyBranding";
import React from "react";
import { useTranslations } from "next-intl";

const SignUp = () => {
    const router = useRouter()
    const t = useTranslations('auth.signUp');
    const tValidation = useTranslations('auth.passwordValidation');
    const tOptions = useTranslations('options');
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
        try {
            const result = await signUpWithEmail(data);
            if (result.success) {
                router.push('/');
                return;
            }
            toast.error(t('toastErrorTitle'), {
                description: result.error ?? t('toastErrorDescription'),
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
                    name="fullName"
                    label={t('fullNameLabel')}
                    placeholder={t('fullNamePlaceholder')}
                    register={register}
                    error={errors.fullName}
                    validation={{ required: t('fullNameRequired'), minLength: 2 }}
                />

                <InputField
                    name="email"
                    label={t('emailLabel')}
                    placeholder="opendevsociety@cc.cc"
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
                    validation={buildPasswordValidation({
                        required: tValidation('required'),
                        minLength: tValidation('minLength'),
                        pattern: tValidation('pattern'),
                    })}
                />
                <PasswordRequirements password={passwordValue ?? ''} />

                <CountrySelectField
                    name="country"
                    label={t('countryLabel')}
                    control={control}
                    error={errors.country}
                    required
                />

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

                <Button type="submit" disabled={isSubmitting} className="yellow-btn w-full mt-5">
                    {isSubmitting ? t('submitting') : t('submit')}
                </Button>

                <FooterLink text={t('footerText')} linkText={t('footerLink')} href="/sign-in" />

                <OpenDevSocietyBranding outerClassName="mt-10 flex justify-center" />
                <div className="mt-5 flex justify-center">
                    <a href="https://peerlist.io/ravixalgorithm/project/happystock" target="_blank" rel="noreferrer">
                        <img
                            src="https://peerlist.io/api/v1/projects/embed/PRJH8OED7MBL9MGB9HRMKAKLM66KNN?showUpvote=true&theme=light"
                            alt="HappyStock"
                            style={{ width: 'auto', height: '72px' }}
                        />
                    </a>
                </div>
            </form>
        </>
    )
}
export default SignUp;
