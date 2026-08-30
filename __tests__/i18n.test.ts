import { describe, expect, it } from 'vitest';
import { defaultLocale, resolveLocale, toTradingViewLocale } from '@/i18n/config';
import zhCN from '@/messages/zh-CN.json';
import en from '@/messages/en.json';

describe('resolveLocale', () => {
    it('returns supported locales as-is', () => {
        expect(resolveLocale('zh-CN')).toBe('zh-CN');
        expect(resolveLocale('en')).toBe('en');
    });

    it('falls back to the default locale for missing or unknown values', () => {
        expect(resolveLocale(undefined)).toBe(defaultLocale);
        expect(resolveLocale('')).toBe(defaultLocale);
        expect(resolveLocale('fr')).toBe(defaultLocale);
        expect(resolveLocale('zh')).toBe(defaultLocale);
    });
});

describe('toTradingViewLocale', () => {
    it('maps zh-CN to TradingView underscore form', () => {
        expect(toTradingViewLocale('zh-CN')).toBe('zh_CN');
    });

    it('maps everything else to en', () => {
        expect(toTradingViewLocale('en')).toBe('en');
        expect(toTradingViewLocale('fr')).toBe('en');
    });
});

// Both catalogs must expose exactly the same key tree, otherwise one locale
// would render raw keys at runtime.
describe('message catalogs', () => {
    const collectKeys = (obj: Record<string, unknown>, prefix = ''): string[] =>
        Object.entries(obj).flatMap(([key, value]) =>
            value && typeof value === 'object' && !Array.isArray(value)
                ? collectKeys(value as Record<string, unknown>, `${prefix}${key}.`)
                : [`${prefix}${key}`]
        );

    it('zh-CN and en have identical key sets', () => {
        const zhKeys = collectKeys(zhCN).sort();
        const enKeys = collectKeys(en).sort();
        expect(zhKeys).toEqual(enKeys);
    });
});
