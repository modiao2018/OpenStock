import { betterAuth } from "better-auth";
import {mongodbAdapter} from "better-auth/adapters/mongodb";
import {connectToDatabase} from "@/database/mongoose";
import {nextCookies} from "better-auth/next-js";
import { sendPasswordResetEmail } from "@/lib/nodemailer/reset-password";


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
        emailAndPassword: {
            enabled: true,
            disableSignUp: false,
            requireEmailVerification: false,
            minPasswordLength: 8,
            maxPasswordLength: 128,
            autoSignIn: true,
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
