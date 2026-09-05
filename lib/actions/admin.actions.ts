'use server';

import { headers } from 'next/headers';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/database/mongoose';
import { auth } from '@/lib/better-auth/auth';
import { isAdminEmail, normalizeApprovalStatus, type ApprovalStatus } from '@/lib/admin';
import { sendWelcomeEvent } from '@/lib/actions/auth.actions';

export type ReviewableUser = {
    id: string;
    name: string;
    email: string;
    status: ApprovalStatus;
    createdAt: string;
    approvedAt: string | null;
    isAdmin: boolean;
};

// Throws unless the caller is signed in as one of ADMIN_EMAILS
async function requireAdmin() {
    const session = await auth.api.getSession({ headers: await headers() });
    const email = session?.user?.email;
    if (!isAdminEmail(email)) throw new Error('forbidden');
    return { email: email as string, userId: session!.user.id };
}

export async function isCurrentUserAdmin(): Promise<boolean> {
    try {
        await requireAdmin();
        return true;
    } catch {
        return false;
    }
}

export async function listUsersForReview(): Promise<ReviewableUser[]> {
    await requireAdmin();
    const mongoose = await connectToDatabase();
    const db = mongoose.connection.db;
    if (!db) throw new Error('No DB connection');

    const docs = await db
        .collection('user')
        .find({}, { projection: { name: 1, email: 1, approvalStatus: 1, approvedAt: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .limit(500)
        .toArray();

    return docs.map((d) => ({
        id: d._id.toString(),
        name: d.name ?? '',
        email: d.email ?? '',
        status: normalizeApprovalStatus(d.approvalStatus),
        createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : '',
        approvedAt: d.approvedAt ? new Date(d.approvedAt).toISOString() : null,
        isAdmin: isAdminEmail(d.email),
    }));
}

export type ReviewResult = { ok: true } | { ok: false; error: 'forbidden' | 'notFound' | 'self' | 'generic' };

export async function setUserApproval(userId: string, status: 'approved' | 'rejected'): Promise<ReviewResult> {
    let reviewer: { email: string; userId: string };
    try {
        reviewer = await requireAdmin();
    } catch {
        return { ok: false, error: 'forbidden' };
    }
    if (!ObjectId.isValid(userId)) return { ok: false, error: 'notFound' };
    if (userId === reviewer.userId && status === 'rejected') return { ok: false, error: 'self' };

    try {
        const mongoose = await connectToDatabase();
        const db = mongoose.connection.db;
        if (!db) throw new Error('No DB connection');
        const _id = new ObjectId(userId);

        const target = await db.collection('user').findOne(
            { _id },
            { projection: { email: 1, name: 1, approvalStatus: 1, profile: 1 } },
        );
        if (!target) return { ok: false, error: 'notFound' };
        // Another reviewer cannot be locked out through this screen
        if (status === 'rejected' && isAdminEmail(target.email)) return { ok: false, error: 'self' };

        await db.collection('user').updateOne(
            { _id },
            {
                $set: {
                    approvalStatus: status,
                    approvedAt: status === 'approved' ? new Date() : null,
                    reviewedBy: reviewer.email,
                    reviewedAt: new Date(),
                    updatedAt: new Date(),
                },
            },
        );

        // A rejected account loses any session it might still hold
        if (status === 'rejected') {
            await db.collection('session').deleteMany({ $or: [{ userId: _id }, { userId }] });
        }
        // The welcome email was held back at sign-up; send it now that they can
        // get in. Not awaited: a slow or unconfigured Inngest must not stall the click.
        if (status === 'approved' && normalizeApprovalStatus(target.approvalStatus) === 'pending' && target.email) {
            void sendWelcomeEvent({ email: target.email, name: target.name ?? '', ...(target.profile ?? {}) });
        }
        return { ok: true };
    } catch (e) {
        console.error('setUserApproval failed', e);
        return { ok: false, error: 'generic' };
    }
}
