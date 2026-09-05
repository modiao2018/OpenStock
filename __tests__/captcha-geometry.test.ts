import { describe, expect, it } from 'vitest';
import {
    PIECE_MAX_X,
    PIECE_MAX_Y,
    PIECE_MIN_X,
    PIECE_MIN_Y,
    PIECE_SIZE,
    PIECE_TOLERANCE,
    PUZZLE_HEIGHT,
    PUZZLE_WIDTH,
    assessTrail,
    isAligned,
    pickPiecePosition,
} from '@/lib/captcha/geometry';

describe('pickPiecePosition', () => {
    it('keeps the piece canvas inside the image and away from the start', () => {
        for (const r of [0, 0.25, 0.5, 0.999]) {
            const { x, y } = pickPiecePosition(() => r);
            expect(x).toBeGreaterThanOrEqual(PIECE_MIN_X);
            expect(x).toBeLessThanOrEqual(PIECE_MAX_X);
            expect(x + PIECE_SIZE).toBeLessThanOrEqual(PUZZLE_WIDTH);
            expect(y).toBeGreaterThanOrEqual(PIECE_MIN_Y);
            expect(y).toBeLessThanOrEqual(PIECE_MAX_Y);
            // sharp extract() throws on any out-of-bounds crop
            expect(y + PIECE_SIZE).toBeLessThanOrEqual(PUZZLE_HEIGHT);
        }
    });

    it('never asks for a no-op drag', () => {
        expect(PIECE_MIN_X).toBeGreaterThan(PIECE_TOLERANCE * 4);
    });
});

describe('isAligned', () => {
    it('accepts within tolerance and rejects outside', () => {
        expect(isAligned(120, 120)).toBe(true);
        expect(isAligned(120, 120 + PIECE_TOLERANCE)).toBe(true);
        expect(isAligned(120, 120 - PIECE_TOLERANCE)).toBe(true);
        expect(isAligned(120, 120 + PIECE_TOLERANCE + 1)).toBe(false);
        expect(isAligned(120, 0)).toBe(false);
    });

    it('rejects garbage', () => {
        expect(isAligned(120, '120')).toBe(false);
        expect(isAligned(120, NaN)).toBe(false);
        expect(isAligned(120, undefined)).toBe(false);
    });

    it('cannot be swept in fewer guesses than the position space allows', () => {
        // With one attempt per challenge, a blind guess wins with probability
        // ≈ (2*tol+1) / span; keep that under 10%.
        const span = PIECE_MAX_X - PIECE_MIN_X + 1;
        expect((2 * PIECE_TOLERANCE + 1) / span).toBeLessThan(0.1);
    });
});

const humanTrail = () => {
    const pts = [];
    let x = 100;
    for (let i = 0; i < 25; i++) {
        x += 3 + Math.sin(i) * 2;
        pts.push({ t: i * 16 + (i % 3), x: Math.round(x), y: 300 + Math.round(Math.cos(i / 2) * 3) });
    }
    return pts;
};

describe('assessTrail', () => {
    it('passes a plausible human drag', () => {
        expect(assessTrail(humanTrail())).toEqual({ ok: true });
    });

    it('passes a sparse keyboard trail', () => {
        const pts = [{ t: 0, x: 0, y: 0 }, { t: 180, x: 2, y: 0 }, { t: 350, x: 4, y: 0 }, { t: 600, x: 16, y: 0 }];
        expect(assessTrail(pts)).toEqual({ ok: true });
    });

    it('rejects missing, tiny, or instantaneous trails', () => {
        expect(assessTrail(undefined).ok).toBe(false);
        expect(assessTrail([]).ok).toBe(false);
        expect(assessTrail([{ t: 0, x: 0, y: 0 }, { t: 1, x: 1, y: 0 }]).ok).toBe(false);
        const instant = Array.from({ length: 10 }, (_, i) => ({ t: 0, x: i * 10, y: 0 }));
        expect(assessTrail(instant)).toEqual({ ok: false, reason: 'too-fast' });
    });

    it('rejects perfectly uniform synthetic motion', () => {
        const robot = Array.from({ length: 20 }, (_, i) => ({ t: i * 20, x: i * 8, y: 100 }));
        expect(assessTrail(robot)).toEqual({ ok: false, reason: 'uniform' });
    });

    it('rejects non-monotonic time and malformed points', () => {
        const back = [{ t: 0, x: 0, y: 0 }, { t: 50, x: 5, y: 0 }, { t: 40, x: 9, y: 0 }, { t: 200, x: 30, y: 1 }];
        expect(assessTrail(back)).toEqual({ ok: false, reason: 'time-not-monotonic' });
        expect(assessTrail([{ t: 0, x: 0 }, { t: 1, x: 1, y: 1 }, { t: 2, x: 2, y: 2 }, { t: 300, x: 3, y: 3 }]).ok).toBe(false);
    });
});
