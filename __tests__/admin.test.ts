import { describe, expect, it } from 'vitest';
import { canSignIn, isAdminEmail, normalizeApprovalStatus, parseAdminEmails } from '@/lib/admin';

describe('parseAdminEmails', () => {
    it('splits on commas, semicolons and whitespace and lowercases', () => {
        expect(parseAdminEmails('A@x.com, b@y.com;c@z.com\nd@w.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.com', 'd@w.com']);
    });
    it('ignores empty and junk entries', () => {
        expect(parseAdminEmails('')).toEqual([]);
        expect(parseAdminEmails(undefined)).toEqual([]);
        expect(parseAdminEmails('nope, ,x@y.z')).toEqual(['x@y.z']);
    });
});

describe('isAdminEmail', () => {
    it('matches case-insensitively against the configured list', () => {
        expect(isAdminEmail('Admin@Example.com', 'admin@example.com')).toBe(true);
        expect(isAdminEmail('other@example.com', 'admin@example.com')).toBe(false);
    });
    it('is false when nothing is configured or no email given', () => {
        expect(isAdminEmail('admin@example.com', '')).toBe(false);
        expect(isAdminEmail(null, 'admin@example.com')).toBe(false);
    });
});

describe('approval status', () => {
    it('grandfathers accounts with no status', () => {
        expect(normalizeApprovalStatus(undefined)).toBe('approved');
        expect(normalizeApprovalStatus(null)).toBe('approved');
        expect(normalizeApprovalStatus('weird')).toBe('approved');
        expect(canSignIn(undefined)).toBe(true);
    });
    it('blocks pending and rejected', () => {
        expect(canSignIn('pending')).toBe(false);
        expect(canSignIn('rejected')).toBe(false);
        expect(canSignIn('approved')).toBe(true);
    });
});
