// Slide-puzzle captcha: pure geometry shared by the server renderer, the
// verifier and the client widget. No I/O here so it is unit-testable.

export const PUZZLE_WIDTH = 320;
export const PUZZLE_HEIGHT = 120;
// Square canvas the jigsaw piece is drawn in. The visible shape spans
// x 14..67 / y 1..54 of it (body 40px + an 8px tab on top and right).
export const PIECE_SIZE = 68;
export const PIECE_PATH = 'M14 14H28A8 8 0 1 1 40 14H54V28A8 8 0 1 1 54 40V54H14Z';
// How far (image px) the released piece may sit from the hole and still pass
export const PIECE_TOLERANCE = 6;

// Piece canvas origin range. x starts well right of the slider's rest position
// so the answer is never "don't move"; the whole canvas must stay inside the
// image because sharp's extract() refuses an out-of-bounds crop.
export const PIECE_MIN_X = 80;
export const PIECE_MAX_X = PUZZLE_WIDTH - PIECE_SIZE - 6;
export const PIECE_MIN_Y = 2;
export const PIECE_MAX_Y = PUZZLE_HEIGHT - PIECE_SIZE;

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type PiecePosition = { x: number; y: number };

export function pickPiecePosition(rand: () => number = Math.random): PiecePosition {
    const span = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
    return { x: span(PIECE_MIN_X, PIECE_MAX_X), y: span(PIECE_MIN_Y, PIECE_MAX_Y) };
}

export function isAligned(expectedX: number, actualX: unknown, tolerance = PIECE_TOLERANCE): boolean {
    if (typeof actualX !== 'number' || !Number.isFinite(actualX)) return false;
    return Math.abs(actualX - expectedX) <= tolerance;
}

export type TrailPoint = { t: number; x: number; y: number };

export const TRAIL_MIN_POINTS = 4;
export const TRAIL_MAX_POINTS = 600;
export const TRAIL_MIN_DURATION_MS = 100;
export const TRAIL_MAX_DURATION_MS = 120_000;

// Cheap liveness check on the drag trail. It is deliberately lenient for
// humans (a fast flick on a phone still passes) and only rejects the trivially
// synthetic: no samples, instantaneous, non-monotonic time, or a perfectly
// uniform stride in both axes. Real brute-force protection is the throttle.
export function assessTrail(trail: unknown): { ok: boolean; reason?: string } {
    if (!Array.isArray(trail)) return { ok: false, reason: 'missing' };
    if (trail.length < TRAIL_MIN_POINTS) return { ok: false, reason: 'too-few-points' };
    if (trail.length > TRAIL_MAX_POINTS) return { ok: false, reason: 'too-many-points' };

    const points: TrailPoint[] = [];
    for (const p of trail) {
        if (!p || typeof p !== 'object') return { ok: false, reason: 'malformed' };
        const { t, x, y } = p as Record<string, unknown>;
        if (![t, x, y].every((v) => typeof v === 'number' && Number.isFinite(v))) {
            return { ok: false, reason: 'malformed' };
        }
        points.push({ t: t as number, x: x as number, y: y as number });
    }

    for (let i = 1; i < points.length; i++) {
        if (points[i].t < points[i - 1].t) return { ok: false, reason: 'time-not-monotonic' };
    }

    const duration = points[points.length - 1].t - points[0].t;
    if (duration < TRAIL_MIN_DURATION_MS) return { ok: false, reason: 'too-fast' };
    if (duration > TRAIL_MAX_DURATION_MS) return { ok: false, reason: 'too-slow' };

    const dx = new Set<number>();
    const dy = new Set<number>();
    const dt = new Set<number>();
    for (let i = 1; i < points.length; i++) {
        dx.add(Math.round(points[i].x - points[i - 1].x));
        dy.add(Math.round(points[i].y - points[i - 1].y));
        dt.add(Math.round(points[i].t - points[i - 1].t));
    }
    if (dx.size === 1 && dy.size === 1 && dt.size === 1) return { ok: false, reason: 'uniform' };

    return { ok: true };
}
