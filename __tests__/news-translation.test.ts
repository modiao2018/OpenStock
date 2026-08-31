import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock everything localizeNews touches before importing it
vi.mock("@/database/mongoose", () => ({
    connectToDatabase: vi.fn(async () => undefined),
}));

const findMock = vi.fn();
const bulkWriteMock = vi.fn(async (..._args: any[]) => undefined);
vi.mock("@/database/models/news-translation.model", () => ({
    NewsTranslation: {
        find: (...args: any[]) => ({ lean: async () => findMock(...args) }),
        bulkWrite: (...args: any[]) => bulkWriteMock(...args),
    },
}));

const resolveLlmConfigMock = vi.fn();
vi.mock("@/lib/llm-config", () => ({
    resolveLlmConfig: (...args: unknown[]) => resolveLlmConfigMock(...args),
}));

const callAIMock = vi.fn();
vi.mock("@/lib/ai-provider", () => ({
    callAIProviderWithConfig: (...args: unknown[]) => callAIMock(...args),
}));

import { localizeNews, newsCacheKey, parseTranslationReply } from "@/lib/news-translation";

const CFG = { provider: "gemini", apiKey: "k", baseUrl: "b", model: "m" };

const article = (n: number): MarketNewsArticle => ({
    id: n,
    headline: `Headline ${n}`,
    summary: `Summary ${n}`,
    source: "Benzinga",
    url: `https://example.com/${n}`,
    datetime: 1700000000 + n,
    category: "company",
    related: "AAPL",
});

beforeEach(() => {
    findMock.mockReset().mockResolvedValue([]);
    bulkWriteMock.mockClear();
    resolveLlmConfigMock.mockReset().mockResolvedValue(CFG);
    callAIMock.mockReset();
});

// ── newsCacheKey ───────────────────────────────────────────────────

describe("newsCacheKey", () => {
    it("is stable for the same url+headline and ignores the unstable id", () => {
        const a = { ...article(1), id: 111 };
        const b = { ...article(1), id: 999, datetime: 123 };
        expect(newsCacheKey(a)).toBe(newsCacheKey(b));
        expect(newsCacheKey(a)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("differs when url or headline differs", () => {
        expect(newsCacheKey(article(1))).not.toBe(newsCacheKey(article(2)));
        expect(newsCacheKey({ url: "u", headline: "h1" })).not.toBe(
            newsCacheKey({ url: "u", headline: "h2" }),
        );
    });
});

// ── parseTranslationReply ──────────────────────────────────────────

describe("parseTranslationReply", () => {
    it("parses a plain JSON array", () => {
        const out = parseTranslationReply(
            '[{"i":0,"headline":"中文标题","summary":"中文摘要"}]',
            1,
        );
        expect(out).toEqual([{ i: 0, headline: "中文标题", summary: "中文摘要" }]);
    });

    it("tolerates ```json fences and surrounding prose", () => {
        const reply = '好的，翻译如下：\n```json\n[{"i":0,"headline":"标题","summary":"摘要"}]\n```\n完毕';
        expect(parseTranslationReply(reply, 1)).toHaveLength(1);
    });

    it("drops out-of-range indexes and empty strings", () => {
        const reply = JSON.stringify([
            { i: 5, headline: "越界", summary: "x" },
            { i: -1, headline: "负数", summary: "x" },
            { i: 0, headline: "", summary: "x" },
            { i: 0, headline: "好的", summary: "  " },
            { i: 1, headline: "有效", summary: "有效摘要" },
        ]);
        expect(parseTranslationReply(reply, 2)).toEqual([
            { i: 1, headline: "有效", summary: "有效摘要" },
        ]);
    });

    it("returns [] for non-array JSON or no JSON at all", () => {
        expect(parseTranslationReply('{"i":0}', 1)).toEqual([]);
        expect(parseTranslationReply("sorry, cannot translate", 1)).toEqual([]);
        expect(parseTranslationReply("[not valid json", 1)).toEqual([]);
    });

    it("truncates overlong headline/summary", () => {
        const out = parseTranslationReply(
            JSON.stringify([{ i: 0, headline: "长".repeat(500), summary: "摘".repeat(500) }]),
            1,
        );
        expect(out[0].headline.length).toBeLessThanOrEqual(120);
        expect(out[0].summary.length).toBeLessThanOrEqual(300);
    });
});

// ── localizeNews ───────────────────────────────────────────────────

describe("localizeNews", () => {
    it("returns cached translations without calling the LLM", async () => {
        const a = article(1);
        findMock.mockResolvedValue([
            { key: newsCacheKey(a), headline: "缓存标题", summary: "缓存摘要" },
        ]);
        const out = await localizeNews([a]);
        expect(out[0].headline).toBe("缓存标题");
        expect(out[0].summary).toBe("缓存摘要");
        expect(callAIMock).not.toHaveBeenCalled();
    });

    it("translates misses via the LLM and upserts the cache", async () => {
        const a = article(1);
        callAIMock.mockResolvedValue('[{"i":0,"headline":"新标题","summary":"新摘要"}]');
        const out = await localizeNews([a]);
        expect(out[0].headline).toBe("新标题");
        expect(bulkWriteMock).toHaveBeenCalledTimes(1);
        // Non-translated fields untouched
        expect(out[0].url).toBe(a.url);
        expect(out[0].datetime).toBe(a.datetime);
    });

    it("falls back to English when no LLM is configured", async () => {
        resolveLlmConfigMock.mockResolvedValue(null);
        const a = article(1);
        const out = await localizeNews([a]);
        expect(out[0].headline).toBe(a.headline);
        expect(callAIMock).not.toHaveBeenCalled();
    });

    it("falls back to English when the LLM call fails", async () => {
        callAIMock.mockRejectedValue(new Error("boom"));
        const a = article(1);
        const out = await localizeNews([a]);
        expect(out[0].headline).toBe(a.headline);
    });

    it("falls back to English when the LLM is slower than the timeout", async () => {
        vi.useFakeTimers();
        try {
            callAIMock.mockImplementation(
                () => new Promise((resolve) => setTimeout(() => resolve("[]"), 60_000)),
            );
            const a = article(1);
            const pending = localizeNews([a]);
            await vi.advanceTimersByTimeAsync(11_000);
            const out = await pending;
            expect(out[0].headline).toBe(a.headline);
        } finally {
            vi.useRealTimers();
        }
    });

    it("returns input as-is for empty arrays and on DB errors", async () => {
        expect(await localizeNews([])).toEqual([]);
        findMock.mockRejectedValue(new Error("db down"));
        const a = article(1);
        const out = await localizeNews([a]);
        expect(out[0].headline).toBe(a.headline);
    });
});
