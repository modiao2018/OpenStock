import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import {mongodbAdapter} from "better-auth/adapters/mongodb";
import {connectToDatabase} from "@/database/mongoose";
import {nextCookies} from "better-auth/next-js";
import { sendPasswordResetEmail } from "@/lib/nodemailer/reset-password";
import { isAdminEmail, normalizeApprovalStatus } from "@/lib/admin";

// Sign-in is refused with these codes until a reviewer approves the account
export const AUTH_ERROR_PENDING = 'ACCOUNT_PENDING_APPROVAL';
export const AUTH_ERROR_REJECTED = 'ACCOUNT_REJECTED';

let authInstance: ReturnType<typeof betterAuth> | null = null;


export const getAuth = async () => {
    if(authInstance) {
        return authInstance;
    }

    const mongoose = await connectToDatabase();
    const db = mongoose.connection;
    const database = db.db;

    if (!db || !database) {
        throw new Error("MongoDB connection not found!");
    }

    authInstance = betterAuth({
        database: mongodbAdapter(database),
       secret: process.env.BETTER_AUTH_SECRET,
        baseURL: process.env.BETTER_AUTH_URL,
        user: {
            additionalFields: {
                // set by the create hook below, never by the sign-up body
                approvalStatus: { type: 'string', required: false, input: false },
                approvedAt: { type: 'date', required: false, input: false },
            },
        },
        emailAndPassword: {
            enabled: true,
            disableSignUp: false,
            requireEmailVerification: false,
            minPasswordLength: 8,
            maxPasswordLength: 128,
            // New accounts wait for manual review; nobody gets a session at sign-up
            autoSignIn: false,
            sendResetPassword: async ({ user, url }) => {
                void sendPasswordResetEmail({
                    email: user.email,
                    name: user.name,
                    resetUrl: url,
                }).catch((error) => {
                    console.error('Failed to queue password reset email:', error);
                });
            },
        },
        databaseHooks: {
            user: {
                create: {
                    // Reviewers themselves are approved on the spot so the first
                    // admin can get in; everyone else starts pending.
                    before: async (user) => ({
                        data: {
                            ...user,
                            approvalStatus: isAdminEmail(user.email) ? 'approved' : 'pending',
                            approvedAt: isAdminEmail(user.email) ? new Date() : null,
                        },
                    }),
                },
            },
            session: {
                create: {
                    // Every session (sign-in, and any future auto sign-in path)
                    // passes through here, so an unapproved account can never
                    // hold a cookie no matter which endpoint issued it.
                    before: async (session, ctx) => {
                        const user = await ctx?.context.internalAdapter.findUserById(session.userId);
                        const status = normalizeApprovalStatus((user as { approvalStatus?: unknown } | null)?.approvalStatus);
                        if (status === 'pending') {
                            throw new APIError('FORBIDDEN', { code: AUTH_ERROR_PENDING, message: 'Account is awaiting approval' });
                        }
                        if (status === 'rejected') {
                            throw new APIError('FORBIDDEN', { code: AUTH_ERROR_REJECTED, message: 'Account was not approved' });
                        }
                    },
                },
            },
        },
        plugins: [nextCookies()],

    });

    return authInstance;
}

// 不能在模块顶层 `await getAuth()`：那会在 import 时就连 MongoDB，
// 使得没有数据库的环境（Docker 镜像构建里的 next build）直接失败。
// 惰性代理：首次调用 auth.api.* 时才真正初始化连接。
type AuthApi = Awaited<ReturnType<typeof getAuth>>["api"];

export const auth = {
    api: new Proxy({} as AuthApi, {
        get(_target, prop) {
            return async (...args: unknown[]) => {
                const instance = await getAuth();
                const method = instance.api[prop as keyof AuthApi] as (...a: unknown[]) => unknown;
                return method.apply(instance.api, args);
            };
        },
    }),
};
