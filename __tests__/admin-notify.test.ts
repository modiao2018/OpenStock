import { describe, expect, it } from 'vitest';
import { buildPendingSignUpPush } from '@/lib/admin-notify';

describe('buildPendingSignUpPush', () => {
    it('names the applicant, deep-links the review page, and is not critical', () => {
        const msg = buildPendingSignUpPush({ name: '张三', email: 'z@x.com', reviewUrl: 'https://h.example/admin/users' });
        expect(msg.title).toContain('张三');
        expect(msg.body).toContain('z@x.com');
        expect(msg.url).toBe('https://h.example/admin/users');
        expect(msg.urgent).toBe(false);
    });
    it('falls back to the email when the name is blank', () => {
        const msg = buildPendingSignUpPush({ name: '', email: 'z@x.com', reviewUrl: 'u' });
        expect(msg.title).toContain('z@x.com');
        expect(msg.body.startsWith('z@x.com')).toBe(true);
    });
});
