'use client';

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Check, Globe } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { locales, type Locale } from "@/i18n/config";
import { setUserLocale } from "@/lib/actions/locale.actions";

// Language names are shown in their own language on purpose — never translated
const LOCALE_LABELS: Record<Locale, string> = {
    'zh-CN': '简体中文',
    'en': 'English',
};

export const useLocaleSwitch = () => {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const currentLocale = useLocale();

    const switchLocale = (locale: Locale) => {
        if (locale === currentLocale) return;
        startTransition(async () => {
            await setUserLocale(locale);
            router.refresh();
        });
    };

    return { currentLocale, switchLocale, isPending };
};

// Menu items for embedding inside an existing DropdownMenuContent (e.g. UserDropdown)
export const LanguageSwitcherItems = () => {
    const { currentLocale, switchLocale } = useLocaleSwitch();

    return (
        <>
            {locales.map((locale) => (
                <DropdownMenuItem
                    key={locale}
                    onClick={() => switchLocale(locale)}
                    className="text-gray-100 text-md font-medium focus:bg-transparent focus:text-teal-500 transition-colors cursor-pointer"
                >
                    <Check className={`h-4 w-4 mr-2 ${locale === currentLocale ? '' : 'invisible'}`} />
                    {LOCALE_LABELS[locale]}
                </DropdownMenuItem>
            ))}
        </>
    );
};

// Standalone globe-icon switcher (e.g. on auth pages)
const LanguageSwitcher = () => {
    const { currentLocale, switchLocale } = useLocaleSwitch();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2 text-gray-400 hover:text-teal-500">
                    <Globe className="h-4 w-4" />
                    {LOCALE_LABELS[currentLocale as Locale] ?? currentLocale}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="text-gray-400 bg-gray-800">
                <LanguageSwitcherItems />
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export default LanguageSwitcher;
