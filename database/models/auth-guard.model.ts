import { Schema, model, models, type Document, type Model } from 'mongoose';

// Sliding-window counters behind the auth throttle (see lib/auth-throttle.ts).
// `key` is e.g. "signin:email:<email>" or "signin:ip:<ip>"; docs expire on
// their own once nothing has hit them for a while.
export interface IAuthThrottle extends Document {
    key: string;
    count: number;
    windowStart: Date;
    lockedUntil: Date | null;
    strikes: number;
    expiresAt: Date;
}

const AuthThrottleSchema = new Schema<IAuthThrottle>(
    {
        key: { type: String, required: true, unique: true },
        count: { type: Number, required: true, default: 0 },
        windowStart: { type: Date, required: true },
        lockedUntil: { type: Date, default: null },
        strikes: { type: Number, required: true, default: 0 },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: false, versionKey: false },
);
AuthThrottleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type CaptchaStatus = 'pending' | 'solved' | 'consumed' | 'failed';

// One slide-puzzle challenge. The answer (`x`) never leaves the server; once
// solved the doc carries a single-use `token` the sign-in/up action consumes.
export interface ICaptchaChallenge extends Document {
    _id: string;
    x: number;
    y: number;
    status: CaptchaStatus;
    token: string | null;
    ip: string;
    expiresAt: Date;
    createdAt: Date;
}

const CaptchaChallengeSchema = new Schema<ICaptchaChallenge>(
    {
        _id: { type: String, required: true },
        x: { type: Number, required: true },
        y: { type: Number, required: true },
        status: { type: String, required: true, default: 'pending' },
        token: { type: String, default: null },
        ip: { type: String, default: '' },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
CaptchaChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthThrottle: Model<IAuthThrottle> =
    (models?.AuthThrottle as Model<IAuthThrottle>) || model<IAuthThrottle>('AuthThrottle', AuthThrottleSchema);
export const CaptchaChallenge: Model<ICaptchaChallenge> =
    (models?.CaptchaChallenge as Model<ICaptchaChallenge>) ||
    model<ICaptchaChallenge>('CaptchaChallenge', CaptchaChallengeSchema);
