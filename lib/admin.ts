// Who may review sign-ups, and what an account's approval state allows.
// Pure functions only: safe to import from client components and tests.

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export const parseAdminEmails = (raw: string | undefined): string[] =>
    (raw ?? '')
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@'));

export const isAdminEmail = (email: string | null | undefined, raw = process.env.ADMIN_EMAILS): boolean =>
    !!email && parseAdminEmails(raw).includes(email.trim().toLowerCase());

// Accounts created before approval existed carry no status at all; they are
// grandfathered in rather than locked out by a deploy.
export const normalizeApprovalStatus = (value: unknown): ApprovalStatus =>
    value === 'pending' || value === 'rejected' ? value : 'approved';

export const canSignIn = (value: unknown): boolean => normalizeApprovalStatus(value) === 'approved';
