// Wall-clock formatting for the web UI. The user reads Beijing time; the web
// container runs in UTC and server components have no browser timezone, so
// every timestamp must name the zone explicitly — otherwise "09/04 10:32" on
// the signals page was UTC while the daemon logs and Bark pushes said 18:32.

export const DISPLAY_TZ = 'Asia/Shanghai';

type Input = string | number | Date | null | undefined;

const toDate = (v: Input): Date | null => {
    if (v === null || v === undefined || v === '') return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

/** "09/04 18:32" style month-day clock in Beijing time */
export function formatClock(v: Input, locale: string): string {
    const d = toDate(v);
    if (!d) return '—';
    return d.toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DISPLAY_TZ });
}

/** "18:32" time-only in Beijing time */
export function formatTimeOfDay(v: Input, locale: string): string {
    const d = toDate(v);
    if (!d) return '—';
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DISPLAY_TZ });
}
