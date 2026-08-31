import HeatmapSection from "@/components/HeatmapSection";
import { getHeatmapSnapshot } from "@/lib/actions/heatmap.actions";
import { getDashboardSymbols } from "@/lib/actions/dashboard.actions";
import { getUserWatchlist } from "@/lib/actions/watchlist.actions";
import { DEFAULT_DASHBOARD_SYMBOLS } from "@/lib/dashboard-catalog";
import { getSession } from "@/lib/get-session";

const Home = async () => {
    const session = await getSession();
    const userId = session?.user?.id;

    const dashboardSymbols = userId ? await getDashboardSymbols(userId) : DEFAULT_DASHBOARD_SYMBOLS;
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
                    height={600}
                />
            </section>
        </div>
    )
}

export default Home;
