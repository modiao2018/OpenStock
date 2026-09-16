import HeatmapSection from "@/components/HeatmapSection";
import { getHeatmapSnapshot } from "@/lib/actions/heatmap.actions";
import { getDashboardConfig } from "@/lib/actions/dashboard.actions";
import { getUserWatchlist } from "@/lib/actions/watchlist.actions";
import { DEFAULT_DASHBOARD_SYMBOLS, EMPTY_CATALOG_EDITS } from "@/lib/dashboard-catalog";
import { getSession } from "@/lib/get-session";

const Home = async () => {
    const session = await getSession();
    const userId = session?.user?.id;

    const dashboard = userId
        ? await getDashboardConfig(userId)
        : { symbols: DEFAULT_DASHBOARD_SYMBOLS, edits: EMPTY_CATALOG_EDITS };
    const dashboardSymbols = dashboard.symbols;
    // SSR serves the last-known snapshot (Mongo only, no Finnhub fan-out);
    // HeatmapSection refreshes live data right after mount
    const [heatmapData, watchlistItems] = await Promise.all([
        getHeatmapSnapshot(dashboardSymbols),
        userId ? getUserWatchlist(userId) : Promise.resolve([]),
    ]);
    const watchlistSymbols: string[] = watchlistItems.map((item: { symbol: string }) => item.symbol);

    return (
        <div className="flex min-h-screen home-wrapper">
            {/* Row 1: the heatmap owns the full width */}
            <section className="w-full">
                <HeatmapSection
                    initialData={heatmapData}
                    watchlistSymbols={watchlistSymbols}
                    configuredSymbols={dashboardSymbols}
                    catalogEdits={dashboard.edits}
                    height={600}
                />
            </section>
        </div>
    )
}

export default Home;
