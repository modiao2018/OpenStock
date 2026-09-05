// Server-side puzzle renderer. Builds a procedural dark "market" scene as
// SVG, rasterises it with sharp, cuts the jigsaw piece out of it and paints
// the hole into the background. Images are returned as data URLs so the
// client needs no extra route and each challenge is a one-off.
import sharp from 'sharp';
import {
    PIECE_PATH,
    PIECE_SIZE,
    PUZZLE_HEIGHT,
    PUZZLE_WIDTH,
    pickPiecePosition,
    type PiecePosition,
} from './geometry';

type Palette = { ground: [string, string]; accents: [string, string, string] };

// All palettes stay inside the product's own colour world (teal on near-black
// plus the dashboard's blue/violet/ember signal colours).
const PALETTES: Palette[] = [
    { ground: ['#08191d', '#04101a'], accents: ['#0FEDBE', '#5862FF', '#14b8a6'] },
    { ground: ['#140f2a', '#08101c'], accents: ['#D13BFF', '#5862FF', '#0FEDBE'] },
    { ground: ['#1c0f12', '#0d0a14'], accents: ['#FF8243', '#FF495B', '#FDD458'] },
    { ground: ['#061428', '#031018'], accents: ['#38bdf8', '#0FEDBE', '#5862FF'] },
    { ground: ['#0f1a12', '#05100c'], accents: ['#0FEDBE', '#FDD458', '#089981'] },
];

const fmt = (n: number) => Math.round(n * 10) / 10;

export function buildSceneSvg(rand: () => number = Math.random): string {
    const W = PUZZLE_WIDTH;
    const H = PUZZLE_HEIGHT;
    const palette = PALETTES[Math.floor(rand() * PALETTES.length)];
    const [g0, g1] = palette.ground;
    const [a0, a1, a2] = palette.accents;

    const blobs = Array.from({ length: 4 }, (_, i) => {
        const color = palette.accents[i % 3];
        return `<circle cx="${fmt(rand() * W)}" cy="${fmt(rand() * H)}" r="${fmt(34 + rand() * 40)}" fill="${color}" opacity="${fmt(0.35 + rand() * 0.3)}"/>`;
    }).join('');

    // Random-walk price line across the full width with an area fill under it
    const steps = 14;
    let y = H * 0.4 + rand() * H * 0.35;
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
        y = Math.min(H - 16, Math.max(18, y + (rand() - 0.5) * 40));
        pts.push([fmt((W / steps) * i), fmt(y)]);
    }
    const line = pts.map(([x, py], i) => `${i === 0 ? 'M' : 'L'}${x} ${py}`).join(' ');
    const area = `${line} L${W} ${H} L0 ${H} Z`;

    const grid = [] as string[];
    for (let x = 32; x < W; x += 32) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`);
    for (let gy = 32; gy < H; gy += 32) grid.push(`<line x1="0" y1="${gy}" x2="${W}" y2="${gy}"/>`);

    // A few candles so the scene is not only a line; positions/heights random
    const candles = Array.from({ length: 6 }, () => {
        const cx = fmt(20 + rand() * (W - 40));
        const top = fmt(20 + rand() * (H - 60));
        const h = fmt(10 + rand() * 26);
        const up = rand() > 0.5;
        const color = up ? a0 : a1;
        return `<rect x="${fmt(cx - 3)}" y="${top}" width="6" height="${h}" rx="1.5" fill="${color}" opacity="0.55"/><line x1="${cx}" y1="${fmt(top - 8)}" x2="${cx}" y2="${fmt(top + h + 8)}" stroke="${color}" stroke-width="1.5" opacity="0.55"/>`;
    }).join('');

    const seed = Math.floor(rand() * 1000);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="ground" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${g0}"/><stop offset="1" stop-color="${g1}"/></linearGradient>
  <linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a2}" stop-opacity="0.38"/><stop offset="1" stop-color="${a2}" stop-opacity="0"/></linearGradient>
  <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="20"/></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#ground)"/>
<g filter="url(#blur)">${blobs}</g>
<g stroke="#ffffff" stroke-opacity="0.07" stroke-width="1">${grid.join('')}</g>
<path d="${area}" fill="url(#area)"/>
${candles}
<path d="${line}" fill="none" stroke="${a2}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.12"/>
</svg>`;
}

const pieceSvg = (inner: string) =>
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PIECE_SIZE}" height="${PIECE_SIZE}" viewBox="0 0 ${PIECE_SIZE} ${PIECE_SIZE}">${inner}</svg>`);

const PIECE_MASK = pieceSvg(`<path d="${PIECE_PATH}" fill="#fff"/>`);
const PIECE_EDGE = pieceSvg(
    `<path d="${PIECE_PATH}" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="1.5" stroke-linejoin="round"/>`,
);
const HOLE = pieceSvg(
    `<path d="${PIECE_PATH}" fill="#000" fill-opacity="0.62" stroke="#ffffff" stroke-opacity="0.4" stroke-width="1.5" stroke-linejoin="round"/>`,
);

export type RenderedPuzzle = PiecePosition & {
    // data: URLs, ready for <img src>
    background: string;
    piece: string;
};

const toDataUrl = (buf: Buffer, mime: string) => `data:${mime};base64,${buf.toString('base64')}`;

export async function renderPuzzle(
    position: PiecePosition = pickPiecePosition(),
    rand: () => number = Math.random,
): Promise<RenderedPuzzle> {
    const scene = await sharp(Buffer.from(buildSceneSvg(rand))).ensureAlpha().png().toBuffer();

    const [piece, background] = await Promise.all([
        sharp(scene)
            .extract({ left: position.x, top: position.y, width: PIECE_SIZE, height: PIECE_SIZE })
            .composite([
                { input: PIECE_MASK, blend: 'dest-in' },
                { input: PIECE_EDGE, blend: 'over' },
            ])
            .webp({ quality: 92, alphaQuality: 100 })
            .toBuffer(),
        sharp(scene)
            .composite([{ input: HOLE, left: position.x, top: position.y }])
            .webp({ quality: 80 })
            .toBuffer(),
    ]);

    return {
        ...position,
        background: toDataUrl(background, 'image/webp'),
        piece: toDataUrl(piece, 'image/webp'),
    };
}
