import HeatmapSection from "@/components/HeatmapSection";
import { getHeatmapData } from "@/lib/actions/heatmap.actions";
import { getDashboardSymbols } from "@/lib/actions/dashboard.actions";
import { getUserWatchlist } from "@/lib/actions/watchlist.actions";
import { DEFAULT_DASHBOARD_SYMBOLS } from "@/lib/dashboard-catalog";
import { auth } from "@/lib/better-auth/auth";
import { headers } from "next/headers";

const Home = async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    const userId = session?.user?.id;

    const dashboardSymbols = userId ? await getDashboardSymbols(userId) : DEFAULT_DASHBOARD_SYMBOLS;
    const [heatmapData, watchlistItems] = await Promise.all([
        getHeatmapData(dashboardSymbols),
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
