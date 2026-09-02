import { recordSourceCall } from '@/lib/source-calls';
import { inferSourceByHost } from '@/lib/sources-registry';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 带重试的 fetch：网络错误 / 429 / 5xx 按退避重试，其余状态原样返回。
 * SEC 与 ClinicalTrials 偶发限流，不重试会白丢一轮采集。
 * 每次逻辑调用（含重试）的最终结果与总耗时记入资源统计（/status 页）；
 * source 缺省按 host 推断，rss 等动态源由调用方显式指定。
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: { retries?: number; timeoutMs?: number; backoffMs?: number; source?: string } = {}
): Promise<Response> {
  const { retries = 2, timeoutMs = 20_000, backoffMs = 1500 } = opts;
  const source = opts.source ?? inferSourceByHost(url) ?? '';
  const start = Date.now();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(backoffMs * (attempt + 1));
        continue;
      }
      void recordSourceCall(source, res.ok, Date.now() - start, res.ok ? undefined : `HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(backoffMs * (attempt + 1));
    }
  }
  void recordSourceCall(source, false, Date.now() - start, lastErr);
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
