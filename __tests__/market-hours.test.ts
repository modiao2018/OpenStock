import { describe, expect, it } from 'vitest';
import {
    CLOSED_QUOTE_TTL_S,
    isExtendedSession,
    isFetchStale,
    isRegularSession,
    lastSessionCloseMs,
    previousSessionCloseMs,
    LIVE_QUOTE_TTL_S,
    quoteTtlSeconds,
} from '@/lib/market-hours';

// 2026-09-11 is a Friday (EDT, UTC-4)
const FRI_NOON_ET = new Date('2026-09-11T16:00:00Z');       // 12:00 ET, in session
const FRI_CLOSE_ET = new Date('2026-09-11T20:00:00Z');      // 16:00 ET
const FRI_EVENING_ET = new Date('2026-09-11T23:30:00Z');    // 19:30 ET, after-hours
const FRI_NIGHT_ET = new Date('2026-09-12T02:00:00Z');      // 22:00 ET Friday
const SAT_ET = new Date('2026-09-12T18:00:00Z');            // Saturday 14:00 ET
const THU_CLOSE_ET = new Date('2026-09-10T20:00:00Z');      // Thursday 16:00 ET

describe('session clock', () => {
    it('regular session is weekday 09:30–16:00 ET', () => {
        expect(isRegularSession(FRI_NOON_ET)).toBe(true);
        expect(isRegularSession(FRI_CLOSE_ET)).toBe(false);
        expect(isRegularSession(new Date('2026-09-11T13:29:00Z'))).toBe(false); // 09:29 ET
        expect(isRegularSession(new Date('2026-09-11T13:30:00Z'))).toBe(true);
        expect(isRegularSession(SAT_ET)).toBe(false);
    });

    it('extended session covers pre-market through after-hours', () => {
        expect(isExtendedSession(FRI_EVENING_ET)).toBe(true);
        expect(isExtendedSession(FRI_NIGHT_ET)).toBe(false);
        expect(isExtendedSession(new Date('2026-09-11T07:59:00Z'))).toBe(false); // 03:59 ET
        expect(isExtendedSession(new Date('2026-09-11T08:00:00Z'))).toBe(true);
        expect(isExtendedSession(SAT_ET)).toBe(false);
    });

    it('quote TTL is short while quotes can move and long once they cannot', () => {
        expect(quoteTtlSeconds(FRI_NOON_ET)).toBe(LIVE_QUOTE_TTL_S);
        expect(quoteTtlSeconds(FRI_EVENING_ET)).toBe(LIVE_QUOTE_TTL_S);
        expect(quoteTtlSeconds(FRI_NIGHT_ET)).toBe(CLOSED_QUOTE_TTL_S);
        expect(quoteTtlSeconds(SAT_ET)).toBe(CLOSED_QUOTE_TTL_S);
    });
});

describe('lastSessionCloseMs', () => {
    it('is today 16:00 ET once the bell has rung', () => {
        expect(lastSessionCloseMs(FRI_NIGHT_ET)).toBe(FRI_CLOSE_ET.getTime());
        expect(lastSessionCloseMs(FRI_CLOSE_ET)).toBe(FRI_CLOSE_ET.getTime());
    });

    it('is the previous session before the bell and over the weekend', () => {
        expect(lastSessionCloseMs(FRI_NOON_ET)).toBe(THU_CLOSE_ET.getTime());
        expect(lastSessionCloseMs(SAT_ET)).toBe(FRI_CLOSE_ET.getTime());
        expect(lastSessionCloseMs(new Date('2026-09-14T12:00:00Z'))).toBe(FRI_CLOSE_ET.getTime()); // Monday 08:00 ET
    });

    it('handles standard time (EST) closes', () => {
        // 2026-12-15 is a Tuesday; 16:00 EST = 21:00Z
        expect(lastSessionCloseMs(new Date('2026-12-16T01:00:00Z'))).toBe(Date.parse('2026-12-15T21:00:00Z'));
    });
});

describe('isFetchStale', () => {
    const ms = (d: Date) => d.getTime();

    it('a never-fetched tile is stale', () => {
        expect(isFetchStale(undefined, 0, FRI_NIGHT_ET)).toBe(true);
        expect(isFetchStale(0, 0, FRI_NOON_ET)).toBe(true);
    });

    it('in session: stale after 10 minutes', () => {
        expect(isFetchStale(ms(FRI_NOON_ET) - 5 * 60_000, 0, FRI_NOON_ET)).toBe(false);
        expect(isFetchStale(ms(FRI_NOON_ET) - 12 * 60_000, 0, FRI_NOON_ET)).toBe(true);
        // after-hours still counts as live
        expect(isFetchStale(ms(FRI_EVENING_ET) - 12 * 60_000, 0, FRI_EVENING_ET)).toBe(true);
    });

    it('after the extended session: anything fetched before the last close is stale', () => {
        expect(isFetchStale(ms(FRI_CLOSE_ET) - 60_000, 0, FRI_NIGHT_ET)).toBe(true);
        expect(isFetchStale(ms(FRI_CLOSE_ET) + 60_000, 0, FRI_NIGHT_ET)).toBe(false);
        // a fetch hours ago is fine as long as it happened after the bell
        expect(isFetchStale(ms(FRI_CLOSE_ET) + 3 * 3600_000, 0, FRI_NIGHT_ET)).toBe(false);
    });

    it('over the weekend a Friday-evening fetch stays fresh, a Thursday one does not', () => {
        expect(isFetchStale(ms(FRI_EVENING_ET), 0, SAT_ET)).toBe(false);
        expect(isFetchStale(ms(THU_CLOSE_ET) + 3600_000, 0, SAT_ET)).toBe(true);
    });

    it('a quote two sessions behind is stale no matter when it was fetched', () => {
        // Saturday: latest close is Friday, Thursday's close is what a stale cache hands out
        expect(previousSessionCloseMs(SAT_ET)).toBe(THU_CLOSE_ET.getTime());
        expect(isFetchStale(ms(SAT_ET), THU_CLOSE_ET.getTime() / 1000, SAT_ET)).toBe(true);
        expect(isFetchStale(ms(SAT_ET), FRI_CLOSE_ET.getTime() / 1000, SAT_ET)).toBe(false);
        // Friday mid-session: Thursday's close is only one session back, fetch time decides
        expect(isFetchStale(ms(FRI_NOON_ET), THU_CLOSE_ET.getTime() / 1000, FRI_NOON_ET)).toBe(false);
    });

    it('before the open a fetch made after the previous close is still fresh', () => {
        const friPreOpen = new Date('2026-09-11T07:00:00Z'); // 03:00 ET, before pre-market
        expect(isFetchStale(ms(THU_CLOSE_ET) + 3600_000, 0, friPreOpen)).toBe(false);
        expect(isFetchStale(ms(THU_CLOSE_ET) - 3600_000, 0, friPreOpen)).toBe(true);
    });
});
