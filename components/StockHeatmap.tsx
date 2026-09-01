'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { formatMarketCapValue, isRedUpLocale } from '@/lib/utils';
import type { HeatmapStock } from '@/lib/actions/heatmap.actions';

// Intensity ramps, weakest → strongest; both poles validated against the dark
// surface (contrast >= 3:1, CVD ΔE 11.1). The signed % label on every tile is
// the color-independent secondary encoding.
const RED_RAMP = ['#5a2a30', '#8b2e38', '#c0303c', '#f23645'];
const GREEN_RAMP = ['#1c4a40', '#0f6b58', '#0a856d', '#089981'];
const NEUTRAL = '#434651';

// |change%| thresholds for ramp steps 0-3
const STEPS = [0.1, 1, 2, 3];

const SECTOR_HEADER = 20;
const SECTOR_GAP = 3;

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.4;
// Mouse travel below this is a click on a tile, above it a pan
const DRAG_THRESHOLD = 5;

function rampIndex(abs: number): number {
    if (abs >= STEPS[3]) return 3;
    if (abs >= STEPS[2]) return 2;
    if (abs >= STEPS[1]) return 1;
    return 0;
}

// Legend-filter bucket: sign + intensity step, e.g. 'down-3', 'neutral', 'up-0'
function bucketOf(changePercent: number): string {
    const abs = Math.abs(changePercent);
    if (abs < STEPS[0]) return 'neutral';
    return `${changePercent > 0 ? 'up' : 'down'}-${rampIndex(abs)}`;
}

function tileColor(changePercent: number, redUp: boolean): string {
    const abs = Math.abs(changePercent);
    if (abs < STEPS[0]) return NEUTRAL;
    const up = changePercent > 0;
    const ramp = up === redUp ? RED_RAMP : GREEN_RAMP;
    return ramp[rampIndex(abs)];
}

// Human-readable range for a bucket, used as the legend cell tooltip
function bucketRangeLabel(key: string): string {
    if (key === 'neutral') return `-${STEPS[0]}% ~ +${STEPS[0]}%`;
    const [dir, idxStr] = key.split('-');
    const idx = Number(idxStr);
    const sign = dir === 'up' ? '+' : '-';
    if (idx === 3) return dir === 'up' ? `≥ +${STEPS[3]}%` : `≤ -${STEPS[3]}%`;
    return `${sign}${STEPS[idx]}% ~ ${sign}${STEPS[idx + 1]}%`;
}

interface Rect<T> {
    x: number;
    y: number;
    w: number;
    h: number;
    data: T;
}

// Squarified treemap (Bruls et al.): lays out value-proportional rectangles
// while keeping aspect ratios close to 1. Items should be sorted by value desc.
function squarify<T>(input: { value: number; data: T }[], width: number, height: number): Rect<T>[] {
    const total = input.reduce((sum, item) => sum + item.value, 0);
    if (total <= 0 || width <= 0 || height <= 0) return [];

    const scale = (width * height) / total;
    let items = input.map((item) => ({ data: item.data, area: item.value * scale }));
    const rects: Rect<T>[] = [];
    let x = 0, y = 0, w = width, h = height;

    const worst = (row: { area: number }[], side: number) => {
        const sum = row.reduce((s, r) => s + r.area, 0);
        const max = Math.max(...row.map((r) => r.area));
        const min = Math.min(...row.map((r) => r.area));
        const s2 = sum * sum;
        return Math.max((side * side * max) / s2, s2 / (side * side * min));
    };

    const layoutRow = (row: { data: T; area: number }[]) => {
        const sum = row.reduce((s, r) => s + r.area, 0);
        if (w >= h) {
            const rowWidth = sum / h;
            let ry = y;
            for (const r of row) {
                const rh = r.area / rowWidth;
                rects.push({ x, y: ry, w: rowWidth, h: rh, data: r.data });
                ry += rh;
            }
            x += rowWidth;
            w -= rowWidth;
        } else {
            const rowHeight = sum / w;
            let rx = x;
            for (const r of row) {
                const rw = r.area / rowHeight;
                rects.push({ x: rx, y, w: rw, h: rowHeight, data: r.data });
                rx += rw;
            }
            y += rowHeight;
            h -= rowHeight;
        }
    };

    let row: { data: T; area: number }[] = [];
    while (items.length > 0) {
        const side = Math.min(w, h);
        const next = items[0];
        if (row.length === 0 || worst([...row, next], side) <= worst(row, side)) {
            row.push(next);
            items = items.slice(1);
        } else {
            layoutRow(row);
            row = [];
        }
    }
    if (row.length > 0) layoutRow(row);
    return rects;
}

interface SectorBlock {
    industry: string;
    rect: Rect<string>;
    hasHeader: boolean;
    tiles: Rect<HeatmapStock>[];
}

// Two-level layout: sectors sized by total market cap, stocks squarified
// inside each sector below its header strip
function layoutGrouped(data: HeatmapStock[], width: number, height: number): SectorBlock[] {
    const groups = new Map<string, HeatmapStock[]>();
    for (const stock of data) {
        const key = stock.industry || 'Other';
        const list = groups.get(key);
        if (list) list.push(stock);
        else groups.set(key, [stock]);
    }

    const sectors = [...groups.entries()]
        .map(([industry, stocks]) => ({
            industry,
            stocks,
            total: stocks.reduce((sum, s) => sum + s.marketCap, 0),
        }))
        .sort((a, b) => b.total - a.total);

    const sectorRects = squarify(
        sectors.map((s) => ({ value: s.total, data: s.industry })),
        width,
        height,
    );

    return sectorRects.map((rect, i) => {
        const { stocks } = sectors[i];
        const innerX = rect.x + SECTOR_GAP;
        const innerW = rect.w - SECTOR_GAP * 2;
        const hasHeader = rect.h > 56 && rect.w > 64;
        const innerY = rect.y + (hasHeader ? SECTOR_HEADER : SECTOR_GAP);
        const innerH = rect.h - (hasHeader ? SECTOR_HEADER : SECTOR_GAP) - SECTOR_GAP;
        const tiles = squarify(
            stocks.map((s) => ({ value: s.marketCap, data: s })),
            Math.max(innerW, 0),
            Math.max(innerH, 0),
        ).map((t) => ({ ...t, x: t.x + innerX, y: t.y + innerY }));
        return { industry: sectors[i].industry, rect, hasHeader, tiles };
    });
}

interface TooltipState {
    stock: HeatmapStock;
    left: number;
    top: number;
}

interface StockHeatmapProps {
    data: HeatmapStock[];
    height?: number;
    grouped?: boolean;
    showLegend?: boolean;
    // Hides the +/-/reset button stack; wheel zoom and drag-pan keep working
    showZoomControls?: boolean;
}

const StockHeatmap = ({ data, height = 600, grouped = false, showLegend = true, showZoomControls = true }: StockHeatmapProps) => {
    const t = useTranslations('heatmap');
    const tSectors = useTranslations('sectors');
    const locale = useLocale();
    const redUp = isRedUpLocale(locale);
    const router = useRouter();

    const containerRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);

    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    // Legend buckets toggled off; matching tiles are removed from the layout
    const [hiddenBuckets, setHiddenBuckets] = useState<Set<string>>(new Set());
    const dragState = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
    // Mirrors the state the native (non-passive) wheel listener needs
    const wheelStateRef = useRef({ zoom: 1, offset: { x: 0, y: 0 }, width: 0, mapHeight: 0 });

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            setWidth(entries[0].contentRect.width);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const legendHeight = 36;
    const mapHeight = height - (showLegend ? legendHeight : 0);
    const layoutW = width * zoom;
    const layoutH = mapHeight * zoom;

    const clampOffset = (o: { x: number; y: number }, z: number) => ({
        x: Math.min(Math.max(o.x, 0), Math.max(width * z - width, 0)),
        y: Math.min(Math.max(o.y, 0), Math.max(mapHeight * z - mapHeight, 0)),
    });

    const applyZoom = (nextZoomRaw: number) => {
        const nextZoom = Math.min(Math.max(nextZoomRaw, MIN_ZOOM), MAX_ZOOM);
        setOffset((current) => {
            if (nextZoom === MIN_ZOOM) return { x: 0, y: 0 };
            // Keep the viewport center fixed while zooming
            const cx = current.x + width / 2;
            const cy = current.y + mapHeight / 2;
            return clampOffset(
                { x: (cx * nextZoom) / zoom - width / 2, y: (cy * nextZoom) / zoom - mapHeight / 2 },
                nextZoom,
            );
        });
        setZoom(nextZoom);
        setTooltip(null);
    };

    // Re-clamp when the layout basis changes (resize, legend toggle, data swap)
    useEffect(() => {
        setOffset((current) => clampOffset(current, zoom));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [width, mapHeight, data]);

    wheelStateRef.current = { zoom, offset, width, mapHeight };

    // Wheel zoom anchored at the cursor. Native non-passive listener because
    // React's onWheel can't reliably preventDefault page scrolling.
    useEffect(() => {
        const el = viewportRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const { zoom: z, offset: o, width: w, mapHeight: mh } = wheelStateRef.current;
            const nextZoom = Math.min(Math.max(z * Math.exp(-e.deltaY * 0.0018), MIN_ZOOM), MAX_ZOOM);
            if (nextZoom === z) return;
            const bounds = el.getBoundingClientRect();
            const px = e.clientX - bounds.left;
            const py = e.clientY - bounds.top;
            setTooltip(null);
            if (nextZoom === MIN_ZOOM) {
                setOffset({ x: 0, y: 0 });
            } else {
                setOffset({
                    x: Math.min(Math.max(((o.x + px) * nextZoom) / z - px, 0), Math.max(w * nextZoom - w, 0)),
                    y: Math.min(Math.max(((o.y + py) * nextZoom) / z - py, 0), Math.max(mh * nextZoom - mh, 0)),
                });
            }
            setZoom(nextZoom);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
        // Re-attach when the empty-state placeholder swaps for the real viewport
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [!data || data.length === 0]);

    const onMouseDown = (e: React.MouseEvent) => {
        if (zoom <= MIN_ZOOM) return;
        dragState.current = { startX: e.clientX, startY: e.clientY, offsetX: offset.x, offsetY: offset.y, moved: false };
        const onMove = (ev: MouseEvent) => {
            const drag = dragState.current;
            if (!drag) return;
            const dx = ev.clientX - drag.startX;
            const dy = ev.clientY - drag.startY;
            if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) drag.moved = true;
            if (drag.moved) {
                setTooltip(null);
                setOffset(clampOffset({ x: drag.offsetX - dx, y: drag.offsetY - dy }, zoom));
            }
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            // Cleared on the next tick so the click-capture handler still sees it
            setTimeout(() => { dragState.current = null; }, 0);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const suppressClickAfterDrag = (e: React.MouseEvent) => {
        if (dragState.current?.moved) {
            e.stopPropagation();
            e.preventDefault();
        }
    };

    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center rounded-xl border border-gray-800 bg-gray-950/40 text-gray-500" style={{ height }}>
                {t('noData')}
            </div>
        );
    }

    const sectorLabel = (industry: string) =>
        tSectors.has(industry) ? tSectors(industry) : industry;

    // Hidden buckets are removed before layout so the remaining tiles refill the map
    const visibleData = hiddenBuckets.size > 0
        ? data.filter((s) => !hiddenBuckets.has(bucketOf(s.changePercent)))
        : data;

    const sectorBlocks: SectorBlock[] = width > 0 && grouped ? layoutGrouped(visibleData, layoutW, layoutH) : [];
    const flatTiles: Rect<HeatmapStock>[] = width > 0 && !grouped
        ? squarify(visibleData.map((s) => ({ value: s.marketCap, data: s })), layoutW, layoutH)
        : [];

    const formatPercent = (dp: number) => `${dp > 0 ? '+' : ''}${dp.toFixed(2)}%`;

    // Matches w-[240px] on the tooltip card; height is an estimate of the tallest card
    const TOOLTIP_W = 240;
    const TOOLTIP_H = 220;

    const handleMove = (e: React.MouseEvent, stock: HeatmapStock) => {
        if (dragState.current?.moved) return;
        const bounds = containerRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const x = e.clientX - bounds.left;
        const y = e.clientY - bounds.top;
        // Flip above the cursor near the bottom edge, then clamp inside the container
        const top = y + 14 + TOOLTIP_H > height ? y - TOOLTIP_H - 10 : y + 14;
        setTooltip({
            stock,
            left: Math.max(0, Math.min(x + 12, width - TOOLTIP_W - 8)),
            top: Math.max(0, Math.min(top, height - TOOLTIP_H)),
        });
    };

    const renderTile = ({ x, y, w, h, data: stock }: Rect<HeatmapStock>) => {
        const showSymbol = w > 44 && h > 26;
        const showPercent = w > 58 && h > 44;
        const large = w > 120 && h > 80;
        return (
            <button
                key={stock.symbol}
                type="button"
                aria-label={`${stock.name} ${formatPercent(stock.changePercent)}`}
                className="absolute overflow-hidden rounded-[3px] text-white transition-[filter,opacity] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 cursor-pointer"
                style={{
                    left: x + 1,
                    top: y + 1,
                    width: Math.max(w - 2, 0),
                    height: Math.max(h - 2, 0),
                    backgroundColor: tileColor(stock.changePercent, redUp),
                }}
                onClick={() => router.push(`/stocks/${stock.symbol}`)}
                onMouseMove={(e) => handleMove(e, stock)}
                onMouseLeave={() => setTooltip(null)}
            >
                {showSymbol && (
                    <span className="flex h-full flex-col items-center justify-center leading-tight">
                        <span className={`font-semibold ${large ? 'text-xl' : 'text-xs'}`}>{stock.symbol}</span>
                        {showPercent && (
                            <span className={large ? 'text-base' : 'text-[10px]'}>{formatPercent(stock.changePercent)}</span>
                        )}
                    </span>
                )}
            </button>
        );
    };

    const zoomButtonClass = 'flex h-8 w-8 items-center justify-center rounded-md border border-gray-700 bg-gray-900/90 text-gray-300 hover:text-teal-400 hover:border-gray-500 transition-colors cursor-pointer';

    // Legend swatches run loss → neutral → gain, using the same ramps as the
    // tiles. Each cell is a clickable filter bucket.
    const downRamp = redUp ? GREEN_RAMP : RED_RAMP;
    const upRamp = redUp ? RED_RAMP : GREEN_RAMP;
    const legendCells = [
        ...[...downRamp].reverse().map((color, i) => ({ color, label: i === 0 ? '-3%' : '', key: `down-${3 - i}` })),
        { color: NEUTRAL, label: '0%', key: 'neutral' },
        ...upRamp.map((color, i) => ({ color, label: i === 3 ? '+3%' : '', key: `up-${i}` })),
    ];

    const toggleBucket = (key: string) => {
        setHiddenBuckets((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
        setTooltip(null);
    };

    return (
        <div ref={containerRef} className="relative w-full select-none" style={{ height }} onMouseLeave={() => setTooltip(null)}>
            <div
                ref={viewportRef}
                className={`relative overflow-hidden ${zoom > MIN_ZOOM ? 'cursor-grab active:cursor-grabbing' : ''}`}
                style={{ height: mapHeight }}
                onMouseDown={onMouseDown}
                onClickCapture={suppressClickAfterDrag}
            >
                <div
                    className="absolute inset-0"
                    style={{ transform: `translate(${-offset.x}px, ${-offset.y}px)` }}
                >
                    {grouped
                        ? sectorBlocks.map((block) => (
                            <div key={block.industry}>
                                <div
                                    className="absolute rounded-[4px] border border-gray-800 bg-gray-900/20"
                                    style={{ left: block.rect.x, top: block.rect.y, width: block.rect.w, height: block.rect.h }}
                                />
                                {block.hasHeader && (
                                    <span
                                        className="absolute overflow-hidden text-ellipsis whitespace-nowrap px-2 text-[11px] font-medium leading-5 text-gray-400"
                                        style={{ left: block.rect.x + 2, top: block.rect.y, width: block.rect.w - 4, height: SECTOR_HEADER }}
                                    >
                                        {sectorLabel(block.industry)}
                                    </span>
                                )}
                                {block.tiles.map(renderTile)}
                            </div>
                        ))
                        : flatTiles.map(renderTile)}
                </div>

                {showZoomControls && (
                    <div className="absolute right-2 top-2 z-10 flex flex-col gap-1.5">
                        <button type="button" className={zoomButtonClass} title={t('zoomIn')} aria-label={t('zoomIn')}
                            onClick={() => applyZoom(zoom * ZOOM_STEP)} disabled={zoom >= MAX_ZOOM}>
                            <Plus className="h-4 w-4" />
                        </button>
                        <button type="button" className={zoomButtonClass} title={t('zoomOut')} aria-label={t('zoomOut')}
                            onClick={() => applyZoom(zoom / ZOOM_STEP)} disabled={zoom <= MIN_ZOOM}>
                            <Minus className="h-4 w-4" />
                        </button>
                        {zoom > MIN_ZOOM && (
                            <button type="button" className={zoomButtonClass} title={t('zoomReset')} aria-label={t('zoomReset')}
                                onClick={() => applyZoom(MIN_ZOOM)}>
                                <RotateCcw className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {showLegend && (
                <div className="absolute bottom-0 left-0 flex items-center gap-2" style={{ height: legendHeight }}>
                    {legendCells.map((cell) => {
                        const hidden = hiddenBuckets.has(cell.key);
                        return (
                            <span key={cell.key} className="flex items-center gap-1 text-xs text-gray-400">
                                <button
                                    type="button"
                                    title={bucketRangeLabel(cell.key)}
                                    aria-label={bucketRangeLabel(cell.key)}
                                    aria-pressed={hidden}
                                    className={`h-4 w-7 cursor-pointer rounded-[3px] transition-all hover:brightness-125 ${
                                        hidden ? 'opacity-25 ring-1 ring-inset ring-white/30' : ''
                                    }`}
                                    style={{ backgroundColor: cell.color }}
                                    onClick={() => toggleBucket(cell.key)}
                                />
                                {cell.label}
                            </span>
                        );
                    })}
                    {hiddenBuckets.size > 0 && (
                        <button
                            type="button"
                            className="ml-1 text-xs text-gray-500 hover:text-teal-400 cursor-pointer"
                            onClick={() => setHiddenBuckets(new Set())}
                        >
                            {t('clearFilter')}
                        </button>
                    )}
                </div>
            )}

            {tooltip && (() => {
                const s = tooltip.stock;
                const changeColor = Math.abs(s.changePercent) < STEPS[0]
                    ? '#9ca3af'
                    : (s.changePercent > 0) === redUp ? RED_RAMP[3] : GREEN_RAMP[3];
                const detailRows: [string, string][] = [
                    [t('open'), s.open > 0 ? `$${s.open.toFixed(2)}` : '—'],
                    [t('prevClose'), s.prevClose > 0 ? `$${s.prevClose.toFixed(2)}` : '—'],
                    [t('dayRange'), s.low > 0 && s.high > 0 ? `$${s.low.toFixed(2)} – $${s.high.toFixed(2)}` : '—'],
                    [t('marketCap'), formatMarketCapValue(s.marketCap)],
                    [t('quoteTime'), s.quoteTime > 0
                        ? new Date(s.quoteTime * 1000).toLocaleString(locale, {
                            month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })
                        : '—'],
                ];
                return (
                    <div
                        className="pointer-events-none absolute z-20 w-[240px] rounded-lg border border-gray-700 bg-gray-900/95 p-3 text-sm shadow-xl"
                        style={{ left: tooltip.left, top: tooltip.top }}
                    >
                        <p className="font-semibold text-gray-100">
                            {s.symbol}
                            {s.industry && (
                                <span className="ml-2 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-normal text-gray-400">
                                    {sectorLabel(s.industry)}
                                </span>
                            )}
                        </p>
                        <p className="truncate text-xs text-gray-500">{s.name}</p>
                        <p className="mt-1.5 text-lg font-semibold text-gray-100">
                            ${s.price.toFixed(2)}
                            <span className="ml-2 text-sm font-medium" style={{ color: changeColor }}>
                                {s.change > 0 ? '+' : ''}{s.change.toFixed(2)} ({formatPercent(s.changePercent)})
                            </span>
                        </p>
                        <div className="mt-2 space-y-1 border-t border-gray-800 pt-2">
                            {detailRows.map(([label, value]) => (
                                <div key={label} className="flex items-center justify-between text-xs">
                                    <span className="text-gray-500">{label}</span>
                                    <span className="text-gray-300">{value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

export default StockHeatmap;
