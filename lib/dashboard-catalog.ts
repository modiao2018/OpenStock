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

// Per-user edits layered over the master catalog: stocks the user searched
// for and added (industry comes from the Finnhub profile at add time, the
// same field the heatmap groups by) and catalog stocks they removed from the
// picker. Storing the delta instead of a full copy keeps future catalog
// additions visible to everyone.
export interface DashboardCustomStock extends CatalogStock {
    name: string;
}

export interface DashboardCatalogEdits {
    added: DashboardCustomStock[];
    removed: string[];
}

export const EMPTY_CATALOG_EDITS: DashboardCatalogEdits = { added: [], removed: [] };

// Industry shown for a profile that carries none (ETFs, some ADRs)
export const UNKNOWN_INDUSTRY = 'Other';

// Mirrors normalizeHeatmapSymbols' pattern: anything else can never render
const SYMBOL_PATTERN = /^[A-Z0-9.\-]{1,12}$/;
const MAX_CUSTOM_STOCKS = 200;
const MAX_INDUSTRY_LENGTH = 64;
const MAX_NAME_LENGTH = 120;

function cleanSymbol(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const symbol = value.trim().toUpperCase();
    return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export function cleanIndustry(value: unknown): string {
    const industry = typeof value === 'string' ? value.trim().slice(0, MAX_INDUSTRY_LENGTH) : '';
    return industry || UNKNOWN_INDUSTRY;
}

/** Untrusted edits (client payload or Mongo doc) → well-formed, de-duplicated edits */
export function sanitizeCatalogEdits(raw: unknown): DashboardCatalogEdits {
    const input = (raw && typeof raw === 'object' ? raw : {}) as { added?: unknown; removed?: unknown };
    const added: DashboardCustomStock[] = [];
    const seen = new Set<string>();
    if (Array.isArray(input.added)) {
        for (const entry of input.added) {
            if (!entry || typeof entry !== 'object') continue;
            const { symbol: rawSymbol, industry, name } = entry as Record<string, unknown>;
            const symbol = cleanSymbol(rawSymbol);
            if (!symbol || seen.has(symbol)) continue;
            seen.add(symbol);
            added.push({
                symbol,
                industry: cleanIndustry(industry),
                name: typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : '',
            });
            if (added.length >= MAX_CUSTOM_STOCKS) break;
        }
    }
    const removed = Array.isArray(input.removed)
        ? [...new Set(input.removed.map(cleanSymbol).filter((s): s is string => s !== null && !seen.has(s)))]
        : [];
    return { added, removed };
}

/**
 * The catalog a user actually picks from: master minus removals, plus their
 * own additions. An added symbol that is also in the master catalog (say the
 * user removed AAPL and later searched for it again) replaces the master
 * entry rather than appearing twice.
 */
export function buildCatalog(edits: DashboardCatalogEdits = EMPTY_CATALOG_EDITS): CatalogStock[] {
    const removed = new Set(edits.removed);
    const added = new Map(edits.added.map((s) => [s.symbol, s]));
    const base = DASHBOARD_CATALOG
        .filter((s) => !removed.has(s.symbol))
        .map((s) => added.get(s.symbol) ?? s);
    const baseSymbols = new Set(base.map((s) => s.symbol));
    return [...base, ...edits.added.filter((s) => !baseSymbols.has(s.symbol))];
}

// Master industries in listing order; user-created industries sort after them
const MASTER_INDUSTRY_RANK = new Map<string, number>();
for (const { industry } of DASHBOARD_CATALOG) {
    if (!MASTER_INDUSTRY_RANK.has(industry)) MASTER_INDUSTRY_RANK.set(industry, MASTER_INDUSTRY_RANK.size);
}

/**
 * Catalog grouped by industry: master industries in their listing order
 * (whatever stocks they hold now, so moving a stock never reshuffles the
 * groups), then user-created industries in first-seen order.
 */
export function groupCatalog(catalog: CatalogStock[]): { industry: string; symbols: string[] }[] {
    const order: string[] = [];
    const map = new Map<string, string[]>();
    for (const { symbol, industry } of catalog) {
        if (!map.has(industry)) {
            map.set(industry, []);
            order.push(industry);
        }
        map.get(industry)!.push(symbol);
    }
    const rank = (industry: string) =>
        MASTER_INDUSTRY_RANK.get(industry) ?? MASTER_INDUSTRY_RANK.size + order.indexOf(industry);
    return order
        .sort((a, b) => rank(a) - rank(b))
        .map((industry) => ({ industry, symbols: map.get(industry)! }));
}

// Master catalog industries in listing order (as defined above)
export const CATALOG_INDUSTRIES = groupCatalog(DASHBOARD_CATALOG);

/** Selection restricted to what `catalog` offers, upper-cased and de-duplicated */
export function sanitizeDashboardSymbols(symbols: unknown, catalog: CatalogStock[] = DASHBOARD_CATALOG): string[] {
    if (!Array.isArray(symbols)) return [];
    const offered = new Set(catalog.map((s) => s.symbol));
    return [...new Set(
        symbols
            .map(cleanSymbol)
            .filter((s): s is string => s !== null && offered.has(s)),
    )];
}

// Selected symbols grouped by industry, keeping catalog order
export function groupSelection(symbols: string[], catalog: CatalogStock[] = DASHBOARD_CATALOG): { industry: string; symbols: string[] }[] {
    const selected = new Set(symbols);
    return groupCatalog(catalog)
        .map(({ industry, symbols: all }) => ({
            industry,
            symbols: all.filter((s) => selected.has(s)),
        }))
        .filter((group) => group.symbols.length > 0);
}

const MASTER_INDUSTRY = new Map(DASHBOARD_CATALOG.map((s) => [s.symbol, s.industry]));

/**
 * Edits with `symbol` filed under `industry`. Moving a master stock records
 * an override in `added` (buildCatalog lets it replace the master entry);
 * moving it back to its master industry drops the override again so the
 * stored edits stay minimal. A user-added stock keeps its name.
 */
export function setStockIndustry(edits: DashboardCatalogEdits, symbol: string, industry: string): DashboardCatalogEdits {
    const target = cleanIndustry(industry);
    const others = edits.added.filter((s) => s.symbol !== symbol);
    if (MASTER_INDUSTRY.get(symbol) === target) return { ...edits, added: others };
    const existing = edits.added.find((s) => s.symbol === symbol);
    return { ...edits, added: [...others, { symbol, industry: target, name: existing?.name ?? '' }] };
}

/**
 * Heatmap tiles carry the industry from the Finnhub profile; a stock the
 * user filed elsewhere in the picker is regrouped to match, otherwise the
 * dialog and the heatmap would disagree about where it lives.
 */
export function applyIndustryOverrides<T extends { symbol: string; industry: string }>(items: T[], edits: DashboardCatalogEdits): T[] {
    if (edits.added.length === 0) return items;
    const overrides = new Map(edits.added.map((s) => [s.symbol, s.industry]));
    return items.map((item) => {
        const industry = overrides.get(item.symbol);
        return industry && industry !== item.industry ? { ...item, industry } : item;
    });
}
