// US equity session clock. Pure and timezone-explicit: the web container runs
// in UTC and browsers run wherever the user is, so everything is derived from
// the America/New_York wall clock. Weekday-only — NYSE holidays are not
// modelled, so a holiday counts as a session that never printed and the
// staleness check may flag Friday's close on a Monday-holiday evening.

const ET = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

interface EtWall {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    weekday: number;
}

function etWall(d: Date): EtWall {
    const p = Object.fromEntries(ET.formatToParts(d).map((x) => [x.type, x.value]));
    return {
        year: +p.year,
        month: +p.month,
        day: +p.day,
        hour: +p.hour % 24,
        minute: +p.minute,
        weekday: WEEKDAYS[p.weekday] ?? 0,
    };
}

const isWeekday = (weekday: number) => weekday >= 1 && weekday <= 5;

const REGULAR_OPEN = 9 * 60 + 30;
const REGULAR_CLOSE = 16 * 60;
const EXTENDED_OPEN = 4 * 60;
const EXTENDED_CLOSE = 20 * 60;

/** Mon–Fri 09:30–16:00 ET */
export function isRegularSession(now: Date = new Date()): boolean {
    const w = etWall(now);
    const m = w.hour * 60 + w.minute;
    return isWeekday(w.weekday) && m >= REGULAR_OPEN && m < REGULAR_CLOSE;
}

/** Mon–Fri 04:00–20:00 ET: pre-market through after-hours, when quotes can still move */
export function isExtendedSession(now: Date = new Date()): boolean {
    const w = etWall(now);
    const m = w.hour * 60 + w.minute;
    return isWeekday(w.weekday) && m >= EXTENDED_OPEN && m < EXTENDED_CLOSE;
}

export const LIVE_QUOTE_TTL_S = 60;
export const CLOSED_QUOTE_TTL_S = 30 * 60;

// Quotes freeze once after-hours ends, so re-fetching every poll outside the
// extended session burned Finnhub's 60/min budget for nothing and starved the
// symbols further down the list (they stayed on the previous day's close for
// hours). A 30-minute memo lets one sweep cover every page for the night.
export function quoteTtlSeconds(now: Date = new Date()): number {
    return isExtendedSession(now) ? LIVE_QUOTE_TTL_S : CLOSED_QUOTE_TTL_S;
}

/** Epoch ms of 16:00 ET on the given ET calendar day */
function etCloseMs(year: number, month: number, day: number): number {
    const naive = Date.UTC(year, month - 1, day, 16, 0, 0);
    // ET wall clock at that instant tells us the zone offset (EDT 4h, EST 5h)
    const w = etWall(new Date(naive));
    const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
    return naive + (naive - wallAsUtc);
}

/** Most recent weekday 16:00 ET at or before `now` (holidays not excluded) */
export function lastSessionCloseMs(now: Date = new Date()): number {
    const nowMs = now.getTime();
    let cursor = nowMs;
    for (let i = 0; i < 7; i++) {
        const w = etWall(new Date(cursor));
        if (isWeekday(w.weekday)) {
            const close = etCloseMs(w.year, w.month, w.day);
            if (close <= nowMs) return close;
        }
        cursor -= 24 * 3600_000;
    }
    return nowMs;
}

export const LIVE_STALE_MS = 10 * 60_000;

/** The weekday close before the latest one (two sessions back) */
export function previousSessionCloseMs(now: Date = new Date()): number {
    return lastSessionCloseMs(new Date(lastSessionCloseMs(now) - 1));
}

/**
 * True when a tile should be refreshed: fetched more than 10 minutes ago
 * during the extended session, fetched before the latest close outside it
 * (so it cannot contain that close), or — whatever the fetch time says —
 * carrying a last-trade time from two sessions back. The last rule caught
 * a cache layer handing out Thursday's close on Saturday as a fresh fetch.
 * Keyed on fetch time first because thinly traded names legitimately go
 * long stretches without a print.
 */
export function isFetchStale(fetchedAtMs: number | undefined, quoteTimeSec = 0, now: Date = new Date()): boolean {
    if (quoteTimeSec > 0 && quoteTimeSec * 1000 <= previousSessionCloseMs(now)) return true;
    const t = fetchedAtMs ?? 0;
    if (isExtendedSession(now)) return now.getTime() - t > LIVE_STALE_MS;
    return t < lastSessionCloseMs(now);
}
