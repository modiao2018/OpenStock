// Master catalog for the customizable dashboard. Industries are the
// authoritative finnhubIndustry values (fetched 2026-08-30) and double as
// translation keys in the `sectors` namespace.

export interface CatalogStock {
    symbol: string;
    industry: string;
}

export const DASHBOARD_CATALOG: CatalogStock[] = [
    // Technology
    { symbol: 'AAPL', industry: 'Technology' },
    { symbol: 'MSFT', industry: 'Technology' },
    { symbol: 'ORCL', industry: 'Technology' },
    { symbol: 'CRM', industry: 'Technology' },
    { symbol: 'ADBE', industry: 'Technology' },
    { symbol: 'IBM', industry: 'Technology' },
    { symbol: 'NOW', industry: 'Technology' },
    { symbol: 'SHOP', industry: 'Technology' },
    { symbol: 'SNOW', industry: 'Technology' },
    { symbol: 'PLTR', industry: 'Technology' },
    { symbol: 'DDOG', industry: 'Technology' },
    { symbol: 'CRWD', industry: 'Technology' },
    { symbol: 'NET', industry: 'Technology' },
    // Semiconductors
    { symbol: 'NVDA', industry: 'Semiconductors' },
    { symbol: 'TSM', industry: 'Semiconductors' },
    { symbol: 'AVGO', industry: 'Semiconductors' },
    { symbol: 'AMD', industry: 'Semiconductors' },
    { symbol: 'QCOM', industry: 'Semiconductors' },
    { symbol: 'INTC', industry: 'Semiconductors' },
    { symbol: 'MU', industry: 'Semiconductors' },
    // Media
    { symbol: 'GOOGL', industry: 'Media' },
    { symbol: 'META', industry: 'Media' },
    { symbol: 'NFLX', industry: 'Media' },
    { symbol: 'DIS', industry: 'Media' },
    { symbol: 'SPOT', industry: 'Media' },
    { symbol: 'RBLX', industry: 'Media' },
    // Retail
    { symbol: 'AMZN', industry: 'Retail' },
    { symbol: 'WMT', industry: 'Retail' },
    { symbol: 'COST', industry: 'Retail' },
    { symbol: 'BABA', industry: 'Retail' },
    { symbol: 'PDD', industry: 'Retail' },
    { symbol: 'JD', industry: 'Retail' },
    { symbol: 'SE', industry: 'Retail' },
    // Automobiles
    { symbol: 'TSLA', industry: 'Automobiles' },
    { symbol: 'GM', industry: 'Automobiles' },
    { symbol: 'F', industry: 'Automobiles' },
    { symbol: 'NIO', industry: 'Automobiles' },
    { symbol: 'LI', industry: 'Automobiles' },
    { symbol: 'XPEV', industry: 'Automobiles' },
    // Financial Services
    { symbol: 'V', industry: 'Financial Services' },
    { symbol: 'MA', industry: 'Financial Services' },
    { symbol: 'AXP', industry: 'Financial Services' },
    { symbol: 'GS', industry: 'Financial Services' },
    { symbol: 'MS', industry: 'Financial Services' },
    { symbol: 'PYPL', industry: 'Financial Services' },
    { symbol: 'COIN', industry: 'Financial Services' },
    // Banking
    { symbol: 'JPM', industry: 'Banking' },
    { symbol: 'BAC', industry: 'Banking' },
    { symbol: 'WFC', industry: 'Banking' },
    { symbol: 'C', industry: 'Banking' },
    // Pharmaceuticals
    { symbol: 'LLY', industry: 'Pharmaceuticals' },
    { symbol: 'JNJ', industry: 'Pharmaceuticals' },
    { symbol: 'MRK', industry: 'Pharmaceuticals' },
    { symbol: 'PFE', industry: 'Pharmaceuticals' },
    // Health Care
    { symbol: 'UNH', industry: 'Health Care' },
    // Biotechnology
    { symbol: 'ABBV', industry: 'Biotechnology' },
    // Energy
    { symbol: 'XOM', industry: 'Energy' },
    { symbol: 'CVX', industry: 'Energy' },
    { symbol: 'COP', industry: 'Energy' },
    // Beverages
    { symbol: 'KO', industry: 'Beverages' },
    { symbol: 'PEP', industry: 'Beverages' },
    // Hotels, Restaurants & Leisure
    { symbol: 'MCD', industry: 'Hotels, Restaurants & Leisure' },
    { symbol: 'SBUX', industry: 'Hotels, Restaurants & Leisure' },
    { symbol: 'ABNB', industry: 'Hotels, Restaurants & Leisure' },
    { symbol: 'DASH', industry: 'Hotels, Restaurants & Leisure' },
    // Road & Rail
    { symbol: 'UBER', industry: 'Road & Rail' },
    // Logistics & Transportation
    { symbol: 'UPS', industry: 'Logistics & Transportation' },
    { symbol: 'FDX', industry: 'Logistics & Transportation' },
    // Aerospace & Defense
    { symbol: 'BA', industry: 'Aerospace & Defense' },
    { symbol: 'LMT', industry: 'Aerospace & Defense' },
    { symbol: 'RTX', industry: 'Aerospace & Defense' },
    // Telecommunication
    { symbol: 'T', industry: 'Telecommunication' },
    { symbol: 'VZ', industry: 'Telecommunication' },
    { symbol: 'TMUS', industry: 'Telecommunication' },
];

// The out-of-the-box selection users see before customizing
export const DEFAULT_DASHBOARD_SYMBOLS = [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'NFLX', 'ORCL', 'CRM',
    'ADBE', 'INTC', 'AMD', 'PYPL', 'UBER', 'SPOT', 'SHOP', 'SNOW', 'PLTR', 'COIN',
    'RBLX', 'DDOG', 'CRWD', 'NET', 'ABNB', 'DASH', 'BABA', 'JD', 'PDD', 'SE',
];

const CATALOG_SYMBOLS = new Set(DASHBOARD_CATALOG.map((s) => s.symbol));

// Catalog industries in listing order (as defined above)
export const CATALOG_INDUSTRIES: { industry: string; symbols: string[] }[] = (() => {
    const order: string[] = [];
    const map = new Map<string, string[]>();
    for (const { symbol, industry } of DASHBOARD_CATALOG) {
        if (!map.has(industry)) {
            map.set(industry, []);
            order.push(industry);
        }
        map.get(industry)!.push(symbol);
    }
    return order.map((industry) => ({ industry, symbols: map.get(industry)! }));
})();

export function sanitizeDashboardSymbols(symbols: unknown): string[] {
    if (!Array.isArray(symbols)) return [];
    return [...new Set(
        symbols
            .filter((s): s is string => typeof s === 'string')
            .map((s) => s.trim().toUpperCase())
            .filter((s) => CATALOG_SYMBOLS.has(s)),
    )];
}

// Selected symbols grouped by industry, keeping catalog order
export function groupSelection(symbols: string[]): { industry: string; symbols: string[] }[] {
    const selected = new Set(symbols);
    return CATALOG_INDUSTRIES
        .map(({ industry, symbols: all }) => ({
            industry,
            symbols: all.filter((s) => selected.has(s)),
        }))
        .filter((group) => group.symbols.length > 0);
}
