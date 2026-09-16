import { describe, expect, it } from 'vitest';
import {
    applyIndustryOverrides,
    buildCatalog,
    CATALOG_INDUSTRIES,
    DASHBOARD_CATALOG,
    EMPTY_CATALOG_EDITS,
    groupCatalog,
    groupSelection,
    sanitizeCatalogEdits,
    sanitizeDashboardSymbols,
    setStockIndustry,
    UNKNOWN_INDUSTRY,
} from '@/lib/dashboard-catalog';

describe('sanitizeCatalogEdits', () => {
    it('returns empty edits for anything that is not an object', () => {
        expect(sanitizeCatalogEdits(undefined)).toEqual(EMPTY_CATALOG_EDITS);
        expect(sanitizeCatalogEdits(null)).toEqual(EMPTY_CATALOG_EDITS);
        expect(sanitizeCatalogEdits('x')).toEqual(EMPTY_CATALOG_EDITS);
    });

    it('normalises symbols, trims industries and drops malformed entries', () => {
        const edits = sanitizeCatalogEdits({
            added: [
                { symbol: ' arm ', industry: ' Semiconductors ', name: 'Arm Holdings' },
                { symbol: 'arm', industry: 'dup' },
                { symbol: 'bad symbol!', industry: 'x' },
                { symbol: 'SPY', industry: '' },
                'nope',
                null,
            ],
            removed: ['aapl', 'AAPL', 'ARM', 42, 'not valid'],
        });
        expect(edits.added).toEqual([
            { symbol: 'ARM', industry: 'Semiconductors', name: 'Arm Holdings' },
            { symbol: 'SPY', industry: UNKNOWN_INDUSTRY, name: '' },
        ]);
        // A symbol cannot be both added and removed; the addition wins
        expect(edits.removed).toEqual(['AAPL']);
    });
});

describe('buildCatalog', () => {
    it('is the master catalog without edits', () => {
        expect(buildCatalog()).toEqual(DASHBOARD_CATALOG);
        expect(buildCatalog(EMPTY_CATALOG_EDITS)).toEqual(DASHBOARD_CATALOG);
    });

    it('drops removed master stocks and appends additions', () => {
        const catalog = buildCatalog({
            added: [{ symbol: 'ARM', industry: 'Semiconductors', name: 'Arm' }],
            removed: ['AAPL', 'INTC'],
        });
        const symbols = catalog.map((s) => s.symbol);
        expect(symbols).not.toContain('AAPL');
        expect(symbols).not.toContain('INTC');
        expect(symbols[symbols.length - 1]).toBe('ARM');
        expect(catalog).toHaveLength(DASHBOARD_CATALOG.length - 1);
    });

    it('lets an addition override the master entry instead of duplicating it', () => {
        const catalog = buildCatalog({
            added: [{ symbol: 'AAPL', industry: 'Retail', name: 'Apple' }],
            removed: [],
        });
        const apple = catalog.filter((s) => s.symbol === 'AAPL');
        expect(apple).toEqual([{ symbol: 'AAPL', industry: 'Retail', name: 'Apple' }]);
        expect(catalog).toHaveLength(DASHBOARD_CATALOG.length);
    });
});

describe('groupCatalog', () => {
    it('keeps master industries first and appends new ones in first-seen order', () => {
        const groups = groupCatalog(buildCatalog({
            added: [
                { symbol: 'ARM', industry: 'Semiconductors', name: '' },
                { symbol: 'PLUG', industry: 'Electrical Equipment', name: '' },
                { symbol: 'ENPH', industry: 'Electrical Equipment', name: '' },
            ],
            removed: ['UNH'],
        }));
        const industries = groups.map((g) => g.industry);
        expect(industries.slice(0, 2)).toEqual(['Technology', 'Semiconductors']);
        expect(industries).not.toContain('Health Care');
        expect(industries[industries.length - 1]).toBe('Electrical Equipment');
        expect(groups.find((g) => g.industry === 'Semiconductors')?.symbols).toContain('ARM');
        expect(groups.find((g) => g.industry === 'Electrical Equipment')?.symbols).toEqual(['PLUG', 'ENPH']);
    });

    it('keeps master industry order when a stock moves into an earlier-listed group', () => {
        // Moving AAPL (first catalog entry) into Retail must not pull Retail to the top
        const groups = groupCatalog(buildCatalog(setStockIndustry(EMPTY_CATALOG_EDITS, 'AAPL', 'Retail')));
        expect(groups.map((g) => g.industry).slice(0, 4)).toEqual(['Technology', 'Semiconductors', 'Media', 'Retail']);
        expect(groups.find((g) => g.industry === 'Retail')?.symbols[0]).toBe('AAPL');
        // A new industry created from the first entry still sorts after every master one
        const custom = groupCatalog(buildCatalog(setStockIndustry(EMPTY_CATALOG_EDITS, 'AAPL', 'AI Chips')));
        expect(custom[custom.length - 1]).toEqual({ industry: 'AI Chips', symbols: ['AAPL'] });
    });

    it('CATALOG_INDUSTRIES is the grouped master catalog', () => {
        expect(CATALOG_INDUSTRIES).toEqual(groupCatalog(DASHBOARD_CATALOG));
    });
});

describe('sanitizeDashboardSymbols', () => {
    it('keeps only symbols the catalog offers', () => {
        expect(sanitizeDashboardSymbols(['aapl', 'AAPL', 'ARM', 'nope', 3])).toEqual(['AAPL']);
        expect(sanitizeDashboardSymbols('AAPL')).toEqual([]);
    });

    it('accepts user additions and rejects removed master stocks against the user catalog', () => {
        const catalog = buildCatalog({
            added: [{ symbol: 'ARM', industry: 'Semiconductors', name: '' }],
            removed: ['AAPL'],
        });
        expect(sanitizeDashboardSymbols(['AAPL', 'ARM', 'NVDA'], catalog)).toEqual(['ARM', 'NVDA']);
    });
});

describe('groupSelection', () => {
    it('groups a selection by industry and skips empty industries', () => {
        const catalog = buildCatalog({
            added: [{ symbol: 'ARM', industry: 'Semiconductors', name: '' }],
            removed: [],
        });
        expect(groupSelection(['ARM', 'NVDA', 'XOM'], catalog)).toEqual([
            { industry: 'Semiconductors', symbols: ['NVDA', 'ARM'] },
            { industry: 'Energy', symbols: ['XOM'] },
        ]);
    });
});

describe('setStockIndustry', () => {
    it('records a master stock moved elsewhere as an override and drops it when moved back', () => {
        const moved = setStockIndustry(EMPTY_CATALOG_EDITS, 'AAPL', 'Retail');
        expect(moved.added).toEqual([{ symbol: 'AAPL', industry: 'Retail', name: '' }]);
        expect(buildCatalog(moved).find((s) => s.symbol === 'AAPL')?.industry).toBe('Retail');
        expect(groupCatalog(buildCatalog(moved)).find((g) => g.industry === 'Technology')?.symbols).not.toContain('AAPL');

        const back = setStockIndustry(moved, 'AAPL', 'Technology');
        expect(back).toEqual(EMPTY_CATALOG_EDITS);
    });

    it('keeps the name of a user-added stock and normalises the industry', () => {
        const edits = { added: [{ symbol: 'ARM', industry: 'Semiconductors', name: 'Arm' }], removed: ['INTC'] };
        const moved = setStockIndustry(edits, 'ARM', '  Chips  ');
        expect(moved).toEqual({ added: [{ symbol: 'ARM', industry: 'Chips', name: 'Arm' }], removed: ['INTC'] });
        expect(setStockIndustry(edits, 'ARM', '   ').added[0].industry).toBe(UNKNOWN_INDUSTRY);
    });
});

describe('applyIndustryOverrides', () => {
    const tiles = [
        { symbol: 'AAPL', industry: 'Technology', price: 1 },
        { symbol: 'NVDA', industry: 'Semiconductors', price: 2 },
    ];

    it('returns the same array when there are no overrides', () => {
        expect(applyIndustryOverrides(tiles, EMPTY_CATALOG_EDITS)).toBe(tiles);
    });

    it('regroups only the overridden symbols and keeps the other fields', () => {
        const out = applyIndustryOverrides(tiles, { added: [{ symbol: 'AAPL', industry: 'Retail', name: '' }], removed: [] });
        expect(out[0]).toEqual({ symbol: 'AAPL', industry: 'Retail', price: 1 });
        expect(out[1]).toBe(tiles[1]);
    });
});
