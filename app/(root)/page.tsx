import TradingViewWidget from "@/components/TradingViewWidget";
import HeatmapSection from "@/components/HeatmapSection";
import { TOP_STORIES_WIDGET_CONFIG } from "@/lib/constants";
import { getHeatmapData } from "@/lib/actions/heatmap.actions";
import { getDashboardSymbols } from "@/lib/actions/dashboard.actions";
import { getUserWatchlist } from "@/lib/actions/watchlist.actions";
import { DEFAULT_DASHBOARD_SYMBOLS } from "@/lib/dashboard-catalog";
import { auth } from "@/lib/better-auth/auth";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { toTradingViewLocale } from "@/i18n/config";

const Home = async () => {
    const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;
    const locale = await getLocale();
    const tvLocale = toTradingViewLocale(locale);

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
            <section className="w-full">
                <TradingViewWidget
                    scriptUrl={`${scriptUrl}timeline.js`}
                    config={{ ...TOP_STORIES_WIDGET_CONFIG, locale: tvLocale }}
                    height={500}
                />
            </section>
        </div>
    )
}

export default Home;
