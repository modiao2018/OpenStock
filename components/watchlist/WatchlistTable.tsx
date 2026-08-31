"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUp, ArrowDown, Bell } from "lucide-react";
import CreateAlertModal from "./CreateAlertModal";
import WatchlistButton from "@/components/WatchlistButton";
import { formatCurrency, formatNumber, isRedUpLocale } from "@/lib/utils";
import { removeFromWatchlist } from "@/lib/actions/watchlist.actions";
import { useLocale, useTranslations } from "next-intl";

const TABLE_HEADER_KEYS = ["company", "symbol", "price", "change", "marketCap", "actions"] as const;

interface WatchlistTableProps {
    data: any[];
    userId: string;
    onRefresh?: () => void;
}

export default function WatchlistTable({ data, userId, onRefresh }: WatchlistTableProps) {
    const t = useTranslations("watchlist.table");
    const redUp = isRedUpLocale(useLocale());
    const [stocks, setStocks] = useState(data);

    useEffect(() => {
        // Initial set if prop changes
        setStocks(data);
    }, [data]);

    // Symbols kept in a ref so the polling interval survives state updates
    const stocksRef = useRef(stocks);
    useEffect(() => {
        stocksRef.current = stocks;
    }, [stocks]);

    useEffect(() => {
        // Poll for price updates every 30 seconds (quotes only — profiles are static)
        const interval = setInterval(async () => {
            try {
                const symbols = (stocksRef.current || []).map((s: any) => s.symbol);
                if (symbols.length === 0) return;

                // Dynamic import to avoid server-action issues if directly imported in client component sometimes
                const { getWatchlistQuotes } = await import('@/lib/actions/finnhub.actions');
                const updatedData = await getWatchlistQuotes(symbols);

                if (updatedData && updatedData.length > 0) {
                    setStocks(current => {
                        const map = new Map(updatedData.map(item => [item.symbol, item]));
                        return current.map(existing => {
                            const fresh = map.get(existing.symbol);
                            if (fresh) {
                                // ?? keeps the last known value when a fetch fails (rate limit etc.)
                                return {
                                    ...existing,
                                    price: fresh.price ?? existing.price,
                                    change: fresh.change ?? existing.change,
                                    changePercent: fresh.changePercent ?? existing.changePercent,
                                };
                            }
                            return existing;
                        });
                    });
                }
            } catch (err) {
                console.error("Failed to poll watchlist prices", err);
            }
        }, 30000);

        return () => clearInterval(interval);
    }, []);

    if (!stocks || stocks.length === 0) {
        return (
            <div className="text-center py-12 bg-gray-900/50 rounded-lg border border-gray-800">
                <h3 className="text-xl font-medium text-gray-300 mb-2">{t("emptyTitle")}</h3>
                <p className="text-gray-500 mb-6">{t("emptyDescription")}</p>
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-md shadow-xl">
            <table className="w-full text-left text-sm border-collapse">
                <thead className="bg-white/5 text-gray-400 font-medium border-b border-white/10">
                    <tr>
                        {TABLE_HEADER_KEYS.map((key) => (
                            <th
                                key={key}
                                className={`px-6 py-4 font-semibold tracking-wide${key === "actions" ? " text-right" : ""}`}
                            >
                                {t(`headers.${key}`)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                    {stocks.map((stock: any) => {
                        const isPositive = (stock.change ?? 0) >= 0;
                        return (
                            <tr key={stock.symbol} className="hover:bg-white/5 transition-colors group">
                                <td className="px-6 py-4">
                                    <div className="flex items-center space-x-4">
                                        {stock.logo ? (
                                            <div className="w-10 h-10 relative rounded-full overflow-hidden bg-white/10 shadow-sm border border-white/5">
                                                <Image
                                                    src={stock.logo}
                                                    alt={stock.symbol}
                                                    fill
                                                    className="object-contain p-1.5"
                                                />
                                            </div>
                                        ) : (
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center text-xs font-bold text-white shadow-sm border border-white/5">
                                                {stock.symbol[0]}
                                            </div>
                                        )}
                                        <div className="flex flex-col">
                                            <span className="font-semibold text-white text-base">{stock.name}</span>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 font-medium text-gray-300">
                                    <span className="bg-white/5 px-2.5 py-1 rounded-md text-xs font-mono border border-white/10">
                                        {stock.symbol}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-white font-medium text-base tracking-tight">
                                    {formatCurrency(stock.price)}
                                </td>
                                <td className={`px-6 py-4 font-medium`}>
                                    <div className={`flex items-center w-fit px-2 py-1 rounded-md ${(redUp ? !isPositive : isPositive) ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                                        {isPositive ? <ArrowUp className="w-3.5 h-3.5 mr-1.5" /> : <ArrowDown className="w-3.5 h-3.5 mr-1.5" />}
                                        {stock.changePercent != null ? `${Math.abs(stock.changePercent).toFixed(2)}%` : '—'}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-gray-400 font-medium">
                                    {formatNumber(stock.marketCap)}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end space-x-3 opacity-80 group-hover:opacity-100 transition-opacity">
                                        <CreateAlertModal
                                            userId={userId}
                                            symbol={stock.symbol}
                                            currentPrice={stock.price ?? 0}
                                            onAlertCreated={onRefresh}
                                        >
                                            <button className="p-2.5 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-all border border-transparent hover:border-white/10" title={t("addAlert")}>
                                                <Bell className="w-4.5 h-4.5" />
                                            </button>
                                        </CreateAlertModal>

                                        <div className="transform scale-95 hover:scale-100 transition-transform">
                                            <WatchlistButton
                                                symbol={stock.symbol}
                                                company={stock.name}
                                                isInWatchlist={true}
                                                type="icon"
                                                showTrashIcon={false}
                                                onWatchlistChange={async (sym, added) => {
                                                    if (!added) {
                                                        await removeFromWatchlist(userId, sym);
                                                        // Update local list faster than full page refresh if you want
                                                        setStocks((curr: any[]) => curr.filter((s: any) => s.symbol !== sym));
                                                        if (onRefresh) onRefresh();
                                                    }
                                                }}
                                            />
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
