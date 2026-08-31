/**
 * 市场新闻标题/摘要英译中，结果缓存在 Mongo（每篇只翻一次）。
 * 复用 catalyst 的 LLM 配置（resolveLlmConfig：网页保存的配置优先，回落 env）；
 * 未配置 LLM、调用失败或超时一律静默回退英文原文，绝不影响页面渲染。
 */
import { createHash } from 'node:crypto';
import { connectToDatabase } from '@/database/mongoose';
import { NewsTranslation } from '@/database/models/news-translation.model';
import { callAIProviderWithConfig } from '@/lib/ai-provider';
import { resolveLlmConfig } from '@/lib/llm-config';

const HEADLINE_MAX = 120;
const SUMMARY_MAX = 300;
// 超时先返回英文，翻译在后台继续写缓存，下个新闻刷新周期即出中文
const TRANSLATE_TIMEOUT_MS = 10_000;

// 文章 id 由 formatArticle 用 Date.now()+random 生成，不稳定，键只用 url+headline
export function newsCacheKey(article: { url: string; headline: string }): string {
    return createHash('sha256').update(`${article.url}|${article.headline}`).digest('hex');
}

export function buildTranslationPrompt(articles: { headline: string; summary: string }[]): string {
    const items = articles
        .map((a, i) => `[${i}] HEADLINE: ${a.headline}\n    SUMMARY: ${a.summary}`)
        .join('\n');
    return `把以下财经新闻的标题和摘要翻译成简体中文，风格与财经媒体一致。
保留股票代码、公司名等专有名词原文；摘要保持原有信息量，不要新增内容。
只输出 JSON 数组，不要任何其他文字，格式：
[{"i":0,"headline":"中文标题","summary":"中文摘要"}]

${items}`;
}

// 从模型回复中提取并校验 JSON 数组（容忍 ```json 围栏和前后废话）
export function parseTranslationReply(
    reply: string,
    count: number,
): { i: number; headline: string; summary: string }[] {
    const match = reply.match(/\[[\s\S]*\]/);
    if (!match) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(match[0]);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    const out: { i: number; headline: string; summary: string }[] = [];
    for (const item of parsed) {
        const i = Number((item as { i?: unknown })?.i);
        const headline = (item as { headline?: unknown })?.headline;
        const summary = (item as { summary?: unknown })?.summary;
        if (!Number.isInteger(i) || i < 0 || i >= count) continue;
        if (typeof headline !== 'string' || !headline.trim()) continue;
        if (typeof summary !== 'string' || !summary.trim()) continue;
        out.push({
            i,
            headline: headline.trim().slice(0, HEADLINE_MAX),
            summary: summary.trim().slice(0, SUMMARY_MAX),
        });
    }
    return out;
}

// 翻译缺失的文章并写入缓存，返回按缓存键索引的译文
async function translateAndCache(
    misses: { key: string; headline: string; summary: string }[],
): Promise<Map<string, { headline: string; summary: string }>> {
    const cfg = await resolveLlmConfig();
    if (!cfg) return new Map();
    const reply = await callAIProviderWithConfig(buildTranslationPrompt(misses), {
        name: cfg.provider,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
    });
    const parsed = parseTranslationReply(reply, misses.length);
    const translated = new Map<string, { headline: string; summary: string }>();
    for (const item of parsed) {
        translated.set(misses[item.i].key, { headline: item.headline, summary: item.summary });
    }
    if (translated.size > 0) {
        await NewsTranslation.bulkWrite(
            [...translated.entries()].map(([key, t]) => ({
                updateOne: {
                    filter: { key },
                    update: { $set: { lang: 'zh-CN', headline: t.headline, summary: t.summary } },
                    upsert: true,
                },
            })),
        );
    }
    return translated;
}

export async function localizeNews(articles: MarketNewsArticle[]): Promise<MarketNewsArticle[]> {
    if (!articles || articles.length === 0) return articles;
    try {
        await connectToDatabase();
        const keys = articles.map(newsCacheKey);
        const cached = await NewsTranslation.find({ key: { $in: keys } }).lean();
        const byKey = new Map(cached.map((doc) => [doc.key, doc]));

        const misses = articles
            .map((a, idx) => ({ key: keys[idx], headline: a.headline, summary: a.summary }))
            .filter((m) => !byKey.has(m.key));

        let fresh = new Map<string, { headline: string; summary: string }>();
        if (misses.length > 0) {
            const work = translateAndCache(misses).catch((e) => {
                console.error('News translation failed', e);
                return new Map<string, { headline: string; summary: string }>();
            });
            const raced = await Promise.race([
                work,
                new Promise<null>((resolve) => setTimeout(resolve, TRANSLATE_TIMEOUT_MS)),
            ]);
            // 超时：本次先出英文，work 继续在后台跑完并写缓存
            fresh = raced ?? new Map();
        }

        return articles.map((article, idx) => {
            const t = byKey.get(keys[idx]) ?? fresh.get(keys[idx]);
            return t ? { ...article, headline: t.headline, summary: t.summary } : article;
        });
    } catch (e) {
        console.error('localizeNews failed', e);
        return articles;
    }
}
