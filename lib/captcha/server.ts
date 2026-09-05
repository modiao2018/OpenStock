// Server side of the slide-puzzle captcha: issue a challenge, judge a
// solution, and hand out a single-use token the auth actions consume.
// Only ever imported from server actions.
import { randomBytes, randomUUID } from 'crypto';
import { connectToDatabase } from '@/database/mongoose';
import { CaptchaChallenge } from '@/database/models/auth-guard.model';
import { CHALLENGE_TTL_MS, assessTrail, isAligned, pickPiecePosition } from './geometry';
import { renderPuzzle } from './render';

export type CaptchaChallengePayload = {
    id: string;
    background: string;
    piece: string;
    // piece canvas y (the client places it at the right height; x is the secret)
    y: number;
};

export async function issueChallenge(ip: string): Promise<CaptchaChallengePayload> {
    await connectToDatabase();
    const position = pickPiecePosition();
    const rendered = await renderPuzzle(position);
    const id = randomUUID();
    await CaptchaChallenge.create({
        _id: id,
        x: position.x,
        y: position.y,
        status: 'pending',
        ip,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });
    return { id, background: rendered.background, piece: rendered.piece, y: position.y };
}

export type SolveResult = { ok: true; token: string } | { ok: false; reason: 'expired' | 'mismatch' | 'trail' };

// One attempt per challenge: a miss burns it and the client must ask for a
// new puzzle, so the answer cannot be swept by retrying x = 80..246.
export async function judgeChallenge(id: string, x: unknown, trail: unknown): Promise<SolveResult> {
    await connectToDatabase();
    const now = new Date();
    const token = randomBytes(24).toString('base64url');

    // Atomically claim the challenge so parallel guesses cannot each get a verdict
    const doc = await CaptchaChallenge.findOneAndUpdate(
        { _id: id, status: 'pending', expiresAt: { $gt: now } },
        { $set: { status: 'failed' } },
        { new: false },
    ).lean();
    if (!doc) return { ok: false, reason: 'expired' };

    const liveness = assessTrail(trail);
    if (!liveness.ok) return { ok: false, reason: 'trail' };
    if (!isAligned(doc.x, x)) return { ok: false, reason: 'mismatch' };

    await CaptchaChallenge.updateOne(
        { _id: id, status: 'failed' },
        { $set: { status: 'solved', token, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) } },
    );
    return { ok: true, token };
}

// Burn a solved token. Returns false when it is missing, unknown, stale or reused.
export async function consumeCaptchaToken(token: unknown): Promise<boolean> {
    if (typeof token !== 'string' || token.length < 16) return false;
    await connectToDatabase();
    const res = await CaptchaChallenge.updateOne(
        { token, status: 'solved', expiresAt: { $gt: new Date() } },
        { $set: { status: 'consumed' } },
    );
    return res.modifiedCount === 1;
}
