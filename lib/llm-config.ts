/**
 * catalyst 功能的 LLM 配置解析：网页保存的配置（CatalystKv 的 llm_config 键）优先，
 * 回落到 .env（与主应用 ai-provider 一致）。返回含明文 Key 的完整配置，
 * 仅供服务端（server action / daemon）使用，绝不能传给客户端。
 */
import { connectToDatabase } from '@/database/mongoose';
import { CatalystKv } from '@/database/models/catalyst.model';
import { getProviderConfig, type LlmConfigName } from '@/lib/ai-provider';

export const LLM_KV_KEY = 'llm_config';

export interface ResolvedLlmConfig {
    provider: LlmConfigName;
    apiKey: string;
    baseUrl: string;
    model: string;
}

export async function resolveLlmConfig(): Promise<ResolvedLlmConfig | null> {
    await connectToDatabase();
    const doc = await CatalystKv.findOne({ key: LLM_KV_KEY }).lean();
    if (doc) {
        try {
            const cfg = JSON.parse(doc.value) as ResolvedLlmConfig;
            if (cfg.apiKey) return cfg;
        } catch {
            // 配置损坏则回落 env
        }
    }
    const env = getProviderConfig();
    if (!env.apiKey) return null;
    return { provider: env.name, apiKey: env.apiKey, baseUrl: env.baseUrl, model: env.model };
}
