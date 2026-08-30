export const locales = ['zh-CN', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'zh-CN';
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export function resolveLocale(candidate: string | undefined): Locale {
    return locales.includes(candidate as Locale) ? (candidate as Locale) : defaultLocale;
}

// TradingView widgets use underscore locales (e.g. zh_CN), not BCP 47
export function toTradingViewLocale(locale: string): string {
    return locale === 'zh-CN' ? 'zh_CN' : 'en';
}
