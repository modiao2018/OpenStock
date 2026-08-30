import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, resolveLocale } from './config';

export default getRequestConfig(async () => {
    const candidate = (await cookies()).get(LOCALE_COOKIE)?.value;
    const locale = resolveLocale(candidate);

    return {
        locale,
        messages: (await import(`../messages/${locale}.json`)).default,
    };
});
