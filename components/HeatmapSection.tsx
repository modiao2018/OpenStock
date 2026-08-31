'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Maximize2, Minimize2, Settings2, SlidersHorizontal } from 'lucide-react';
import DashboardConfigDialog from '@/components/DashboardConfigDialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import StockHeatmap from '@/components/StockHeatmap';
import { getHeatmapData, type HeatmapStock } from '@/lib/actions/heatmap.actions';

type HeatmapSource = 'popular' | 'watchlist';

interface HeatmapPrefs {
    source: HeatmapSource;
    grouped: boolean;
    legend: boolean;
    showChips: boolean;
    showZoom: boolean;
}

const PREFS_KEY = 'heatmap-prefs';
const DEFAULT_PREFS: HeatmapPrefs = { source: 'popular', grouped: true, legend: true, showChips: true, showZoom: true };

function loadPrefs(): HeatmapPrefs {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (!raw) return DEFAULT_PREFS;
        const parsed = JSON.parse(raw);
        return {
            source: parsed.source === 'watchlist' ? 'watchlist' : 'popular',
            grouped: parsed.grouped !== false,
            legend: parsed.legend !== false,
            showChips: parsed.showChips !== false,
            showZoom: parsed.showZoom !== false,
        };
    } catch {
        return DEFAULT_PREFS;
    }
}

interface HeatmapSectionProps {
    initialData: HeatmapStock[];
    watchlistSymbols: string[];
    // The user's saved dashboard selection (drives the config dialog)
    configuredSymbols: string[];
    height?: number;
}

const HeatmapSection = ({ initialData, watchlistSymbols, configuredSymbols, height = 600 }: HeatmapSectionProps) => {
    const t = useTranslations('heatmap');
    const tHome = useTranslations('home');
    const tSectors = useTranslations('sectors');

    const [prefs, setPrefs] = useState<HeatmapPrefs>(DEFAULT_PREFS);
    const [popularData, setPopularData] = useState<HeatmapStock[]>(initialData);
    const [watchlistData, setWatchlistData] = useState<HeatmapStock[] | null>(null);
    const [sector, setSector] = useState<string | null>(null);
    const [configOpen, setConfigOpen] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [viewportHeight, setViewportHeight] = useState(0);

    // Fullscreen: track viewport height, lock body scroll, exit on Esc
    useEffect(() => {
        if (!isFullscreen) return;
        const update = () => setViewportHeight(window.innerHeight);
        update();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsFullscreen(false);
        };
        window.addEventListener('resize', update);
        window.addEventListener('keydown', onKey);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = previousOverflow;
        };
    }, [isFullscreen]);

    useEffect(() => {
        setPrefs(loadPrefs());
    }, []);

    // Keep the active source fresh: refetch on mount (the SSR payload can be a
    // stale cache hit), then poll every minute while the tab is visible
    useEffect(() => {
        const usingWatchlist = prefs.source === 'watchlist';
        if (usingWatchlist && watchlistSymbols.length === 0) return;
        const symbols = usingWatchlist ? watchlistSymbols : configuredSymbols;
        let cancelled = false;
        const refresh = async () => {
            if (document.hidden) return;
            const data = await getHeatmapData(symbols);
            if (cancelled || data.length === 0) return;
            if (usingWatchlist) setWatchlistData(data);
            else setPopularData(data);
        };
        refresh();
        const id = setInterval(refresh, 60_000);
        // Catch up right away when the user comes back to the tab
        const onVisible = () => { if (!document.hidden) refresh(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            cancelled = true;
            clearInterval(id);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [prefs.source, watchlistSymbols, configuredSymbols]);

    const updatePrefs = (patch: Partial<HeatmapPrefs>) => {
        setPrefs((current) => {
            const next = { ...current, ...patch };
            try {
                localStorage.setItem(PREFS_KEY, JSON.stringify(next));
            } catch {
                // localStorage unavailable (private mode etc.) — prefs just won't persist
            }
            return next;
        });
    };

    const usingWatchlist = prefs.source === 'watchlist';
    const data = usingWatchlist ? (watchlistData ?? []) : popularData;

    // Popular sectors of the active dataset, biggest total market cap first
    const industries = useMemo(() => {
        const totals = new Map<string, number>();
        for (const stock of data) {
            const key = stock.industry || 'Other';
            totals.set(key, (totals.get(key) ?? 0) + stock.marketCap);
        }
        return [...totals.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([key]) => key);
    }, [data]);

    // A sector picked under one data source may not exist in the other
    const activeSector = sector && industries.includes(sector) ? sector : null;
    const visibleData = activeSector
        ? data.filter((stock) => (stock.industry || 'Other') === activeSector)
        : data;

    const sectorLabel = (industry: string) =>
        tSectors.has(industry) ? tSectors(industry) : industry;

    const chipClass = (active: boolean) =>
        `rounded-full border px-3 py-1 text-xs transition-colors cursor-pointer ${
            active
                ? 'border-teal-500 bg-teal-500/10 text-teal-400'
                : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
        }`;

    const menuItemClass = 'text-gray-100 text-sm focus:bg-transparent focus:text-teal-500 transition-colors cursor-pointer';
    const checkClass = (active: boolean) => `h-4 w-4 mr-2 ${active ? '' : 'invisible'}`;

    // Reserve room for the header row and sector chips in fullscreen
    const effectiveHeight = isFullscreen ? Math.max(viewportHeight - 160, 400) : height;

    return (
        <div className={isFullscreen ? 'fixed inset-0 z-[9999] overflow-y-auto bg-black p-4 md:p-6' : undefined}>
            <div className="mb-5 flex items-center justify-between">
                <h3 className="font-semibold text-2xl text-gray-100">{tHome('stockHeatmap')}</h3>
                <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-gray-400 hover:text-teal-500"
                    title={isFullscreen ? t('exitFullscreen') : t('fullscreen')}
                    aria-label={isFullscreen ? t('exitFullscreen') : t('fullscreen')}
                    onClick={() => setIsFullscreen((v) => !v)}
                >
                    {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-gray-400 hover:text-teal-500">
                            <SlidersHorizontal className="h-4 w-4 mr-1.5" />
                            {t('settings')}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="text-gray-400 bg-gray-800" align="end">
                        <DropdownMenuLabel className="text-xs text-gray-500">{t('sourceLabel')}</DropdownMenuLabel>
                        <DropdownMenuItem className={menuItemClass} onClick={() => updatePrefs({ source: 'popular' })}>
                            <Check className={checkClass(!usingWatchlist)} />
                            {t('sourcePopular')}
                        </DropdownMenuItem>
                        <DropdownMenuItem className={menuItemClass} onClick={() => updatePrefs({ source: 'watchlist' })}>
                            <Check className={checkClass(usingWatchlist)} />
                            {t('sourceWatchlist')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-gray-600" />
                        <DropdownMenuItem className={menuItemClass} onClick={() => updatePrefs({ grouped: !prefs.grouped })}>
                            <Check className={checkClass(prefs.grouped)} />
                            {t('groupBySector')}
                        </DropdownMenuItem>
                        <DropdownMenuItem className={menuItemClass} onClick={() => updatePrefs({ legend: !prefs.legend })}>
                            <Check className={checkClass(prefs.legend)} />
                            {t('showLegend')}
                        </DropdownMenuItem>
                        <DropdownMenuItem className={menuItemClass} onClick={() => updatePrefs({ showChips: !prefs.showChips })}>
                            <Check className={checkClass(prefs.showChips)} />
                            {t('showSectorChips')}
                        </DropdownMenuItem>
                        <DropdownMenuItem className={menuItemClass} onClick={() => updatePrefs({ showZoom: !prefs.showZoom })}>
                            <Check className={checkClass(prefs.showZoom)} />
                            {t('showZoomControls')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-gray-600" />
                        <DropdownMenuItem className={menuItemClass} onClick={() => setConfigOpen(true)}>
                            <Settings2 className="h-4 w-4 mr-2" />
                            {t('configureDashboard')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                </div>
            </div>

            {prefs.showChips && industries.length > 1 && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <button type="button" className={chipClass(activeSector === null)} onClick={() => setSector(null)}>
                        {t('allSectors')}
                    </button>
                    {industries.map((industry) => (
                        <button
                            key={industry}
                            type="button"
                            className={chipClass(activeSector === industry)}
                            onClick={() => setSector(activeSector === industry ? null : industry)}
                        >
                            {sectorLabel(industry)}
                        </button>
                    ))}
                </div>
            )}

            {usingWatchlist && watchlistSymbols.length === 0 ? (
                <div className="flex items-center justify-center rounded-xl border border-gray-800 bg-gray-950/40 text-gray-500" style={{ height: effectiveHeight }}>
                    {t('watchlistEmpty')}
                </div>
            ) : usingWatchlist && watchlistData === null ? (
                <div className="flex items-center justify-center rounded-xl border border-gray-800 bg-gray-950/40" style={{ height: effectiveHeight }}>
                    <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                </div>
            ) : (
                <StockHeatmap
                    data={visibleData}
                    height={effectiveHeight}
                    grouped={prefs.grouped}
                    showLegend={prefs.legend}
                    showZoomControls={prefs.showZoom}
                />
            )}

            <DashboardConfigDialog open={configOpen} onOpenChange={setConfigOpen} currentSymbols={configuredSymbols} />
        </div>
    );
};

export default HeatmapSection;
