import { describe, expect, it } from 'vitest';
import {
    anchorDate,
    describeWindow,
    inferPrecision,
    parseGuidanceReply,
    parseLegacyNote,
    windowOf,
} from '../catalyst-monitor/src/guidance-dates';

describe('windowOf / anchorDate', () => {
    it('keeps exact dates as a single-day window', () => {
        expect(windowOf('2027-03-10', 'day')).toEqual({ start: '2027-03-10', end: '2027-03-10' });
        expect(anchorDate('2027-03-10', 'day')).toBe('2027-03-10');
    });

    it('expands month / quarter / half / year to the full period', () => {
        expect(windowOf('2026-02-15', 'month')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
        expect(windowOf('2028-02-15', 'month').end).toBe('2028-02-29'); // leap year
        expect(windowOf('2026-11-15', 'quarter')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
        // The NTLA case: the old prompt hard-coded H2 as 10-15; the window is Jul–Dec
        expect(windowOf('2026-10-15', 'half')).toEqual({ start: '2026-07-01', end: '2026-12-31' });
        expect(windowOf('2027-04-15', 'half')).toEqual({ start: '2027-01-01', end: '2027-06-30' });
        expect(windowOf('2026-11-15', 'year')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    });

    it('anchors on the window end so the entry outlives the whole period', () => {
        expect(anchorDate('2026-10-15', 'half')).toBe('2026-12-31');
        expect(anchorDate('2026-08-03', 'quarter')).toBe('2026-09-30');
    });
});

describe('describeWindow', () => {
    it('renders periods in the reader locale and passes exact dates through', () => {
        expect(describeWindow('2026-12-31', 'half', 'zh-CN')).toBe('2026 下半年');
        expect(describeWindow('2026-12-31', 'half', 'en')).toBe('H2 2026');
        expect(describeWindow('2026-09-30', 'quarter', 'en')).toBe('2026 Q3');
        expect(describeWindow('2026-02-28', 'month', 'zh')).toBe('2026年2月');
        expect(describeWindow('2026-02-28', 'month', 'en')).toBe('Feb 2026');
        expect(describeWindow('2026-12-31', 'year', 'zh')).toBe('2026 年内');
        expect(describeWindow('2027-03-10', 'day', 'zh')).toBe('2027-03-10');
    });
});

describe('inferPrecision', () => {
    it('recognises the period wordings companies actually use', () => {
        expect(inferPrecision('second half of 2026')).toBe('half');
        expect(inferPrecision('first half of 2027')).toBe('half');
        expect(inferPrecision('2H26')).toBe('half');
        expect(inferPrecision("1H'27")).toBe('half');
        expect(inferPrecision('H1 2027')).toBe('half');
        expect(inferPrecision('2027年上半年')).toBe('half');
        expect(inferPrecision('fourth quarter of 2026')).toBe('quarter');
        expect(inferPrecision('Q4 2026')).toBe('quarter');
        expect(inferPrecision("4Q'26")).toBe('quarter');
        expect(inferPrecision('2026年第四季度')).toBe('quarter');
        expect(inferPrecision('later this year')).toBe('year');
        expect(inferPrecision('by year-end 2026')).toBe('year');
        expect(inferPrecision('mid-2027')).toBe('year');
        expect(inferPrecision('2026年内')).toBe('year');
        expect(inferPrecision('in 2027')).toBe('year');
        expect(inferPrecision('December 2026')).toBe('month');
        expect(inferPrecision('early December')).toBe('month');
        expect(inferPrecision('2026年12月')).toBe('month');
        expect(inferPrecision('2026-12')).toBe('month');
    });

    it('treats explicit days and unknown text as exact so precise dates are never downgraded', () => {
        expect(inferPrecision('March 10, 2027')).toBe('day');
        expect(inferPrecision('2027-03-10')).toBe('day');
        expect(inferPrecision('10 March 2027')).toBe('day');
        expect(inferPrecision('2027年3月10日')).toBe('day');
        expect(inferPrecision('')).toBe('day');
        expect(inferPrecision(undefined)).toBe('day');
        expect(inferPrecision('at the ASH annual meeting')).toBe('day');
    });
});

describe('parseLegacyNote', () => {
    it('pulls the original wording out of the pre-precision note format', () => {
        expect(parseLegacyNote('AI 从公告中抽取（原文: second half of 2026）')).toBe('second half of 2026');
        expect(parseLegacyNote('手动添加')).toBeNull();
        expect(parseLegacyNote(undefined)).toBeNull();
    });
});

describe('parseGuidanceReply', () => {
    const today = '2026-09-09';

    it('normalises each item to its window end and keeps supersede ids', () => {
        const reply = `\`\`\`json
{"catalysts": [
  {"title": "nex-z MAGNITUDE-2 完成入组", "dateText": "second half of 2026", "isoDate": "2026-10-15", "precision": "half", "kind": "other"},
  {"title": "lonvo-z PDUFA", "dateText": "March 10, 2027", "isoDate": "2027-03-10", "precision": "day", "kind": "pdufa"}
], "supersedes": ["64f1a2b3c4d5e6f7a8b9c0d1", "not-an-id", "64f1a2b3c4d5e6f7a8b9c0d1"]}
\`\`\``;
        const out = parseGuidanceReply(reply, today);
        expect(out.catalysts).toEqual([
            { title: 'nex-z MAGNITUDE-2 完成入组', date: '2026-12-31', precision: 'half', kind: 'other', dateText: 'second half of 2026' },
            { title: 'lonvo-z PDUFA', date: '2027-03-10', precision: 'day', kind: 'pdufa', dateText: 'March 10, 2027' },
        ]);
        expect(out.supersedes).toEqual(['64f1a2b3c4d5e6f7a8b9c0d1']);
    });

    it('infers precision from dateText when the model omits it', () => {
        const out = parseGuidanceReply(
            '{"catalysts":[{"title":"x","dateText":"Q4 2026","isoDate":"2026-11-15","kind":"data-readout"}]}',
            today
        );
        expect(out.catalysts[0]).toMatchObject({ precision: 'quarter', date: '2026-12-31' });
    });

    it('keeps a period whose end is still ahead even if the model picked a day already behind us', () => {
        const out = parseGuidanceReply(
            '{"catalysts":[{"title":"x","dateText":"2H 2026","isoDate":"2026-08-01","precision":"half","kind":"other"}]}',
            today
        );
        expect(out.catalysts[0]?.date).toBe('2026-12-31');
    });

    it('drops past exact dates, malformed dates, unknown kinds fall back to other, caps at 3', () => {
        const items = [
            { title: 'past', dateText: 'Aug 1, 2026', isoDate: '2026-08-01', precision: 'day', kind: 'pdufa' },
            { title: 'bad', dateText: '?', isoDate: 'soon', precision: 'day', kind: 'pdufa' },
            { title: 'a', dateText: 'Oct 1, 2026', isoDate: '2026-10-01', precision: 'day', kind: 'weird' },
            { title: 'b', dateText: 'Oct 2, 2026', isoDate: '2026-10-02', precision: 'day', kind: 'earnings' },
            { title: 'c', dateText: 'Oct 3, 2026', isoDate: '2026-10-03', precision: 'day', kind: 'earnings' },
            { title: 'd', dateText: 'Oct 4, 2026', isoDate: '2026-10-04', precision: 'day', kind: 'earnings' },
        ];
        const out = parseGuidanceReply(JSON.stringify({ catalysts: items }), today);
        expect(out.catalysts.map((c) => c.title)).toEqual(['a', 'b', 'c']);
        expect(out.catalysts[0]?.kind).toBe('other');
    });

    it('still accepts the legacy bare-array format', () => {
        const out = parseGuidanceReply('[{"title":"x","dateText":"March 10, 2027","isoDate":"2027-03-10","kind":"pdufa"}]', today);
        expect(out.catalysts).toHaveLength(1);
        expect(out.supersedes).toEqual([]);
    });

    it('returns nothing for garbage', () => {
        expect(parseGuidanceReply('抱歉，没有找到。', today)).toEqual({ catalysts: [], supersedes: [] });
        expect(parseGuidanceReply('{"catalysts": oops', today)).toEqual({ catalysts: [], supersedes: [] });
    });
});
