/**
 * fork:websearch —— 候选链：解析「用哪一档 → 失败换谁」，并把每次失败如实带回去。
 *
 * 照 `pi参考项目/MusePi-main/.../web/search/provider.ts` 的口径：候选链由设置推导
 * （主 provider → 可选回退到聚合），**每档独立硬超时**，失败逐个记录而不是整体失败 ——
 * 单引擎被风控是常态，把「谁被风控、谁超时」写进返回值比返回一个空数组有用得多。
 */

import { readWebSearchSettings, webSearchProviderReady, type WebSearchSettings } from "../websearch-settings";
import { parseSearchQuery, matchesQueryConstraints } from "./query";
import { searchBing } from "./providers/bing";
import { searchDuckDuckGo } from "./providers/duckduckgo";
import { searchMojeek } from "./providers/mojeek";
import { searchSearxng } from "./providers/searxng";
import { searchPublic } from "./providers/public";
import {
  WEB_SEARCH_DEFAULT_RESULTS,
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_PROVIDERS,
  WebSearchError,
  type WebSearchFailure,
  type WebSearchProviderId,
  type WebSearchRecency,
  type WebSearchResponse,
  type WebSearchResult,
} from "./types";

export interface SearchWebOptions {
  provider?: WebSearchProviderId;
  count?: number;
  recency?: WebSearchRecency;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  settings?: WebSearchSettings;
}

/** 候选链：显式选的一档（不回退）或「主 provider → 聚合」。 */
export function resolveProviderChain(settings: WebSearchSettings, explicit?: WebSearchProviderId): WebSearchProviderId[] {
  if (explicit) return [explicit];
  const chain: WebSearchProviderId[] = [settings.provider];
  if (settings.fallbackToPublic && settings.provider !== "public") chain.push("public");
  return chain;
}

function clampCount(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : WEB_SEARCH_DEFAULT_RESULTS;
  return Math.min(WEB_SEARCH_MAX_RESULTS, Math.max(1, n));
}

async function runProvider(
  provider: WebSearchProviderId,
  query: string,
  options: { count: number; recency?: WebSearchRecency; signal?: AbortSignal; fetchImpl?: typeof fetch; settings: WebSearchSettings },
): Promise<WebSearchResult[]> {
  // 聚合要 fan-out，多给 10 秒窗口。
  const timeoutMs = (options.settings.timeoutSeconds + (provider === "public" ? 10 : 0)) * 1000;
  const common = {
    limit: options.count,
    ...(options.recency ? { recency: options.recency } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
  if (provider === "searxng") {
    if (!options.settings.searxngEndpoint) {
      throw new WebSearchError("searxng", "no SearXNG endpoint configured (Settings → Web search)");
    }
    return searchSearxng(query, {
      ...common,
      endpoint: options.settings.searxngEndpoint,
      ...(options.settings.searxngToken ? { token: options.settings.searxngToken } : {}),
      ...(options.settings.searxngLanguage ? { language: options.settings.searxngLanguage } : {}),
      policy: { allowPrivate: options.settings.allowPrivateEndpoint },
    });
  }
  if (provider === "bing") return searchBing(query, common);
  if (provider === "duckduckgo") return searchDuckDuckGo(query, common);
  if (provider === "mojeek") return searchMojeek(query, common);
  return (await searchPublic(query, common)).results;
}

/**
 * 跑一次搜索。返回**第一个给出结果的档**的结果；所有失败过的档都进 `failures`
 * （含「被风控」「超时」「端点没配」这类具体原因）。
 */
export async function searchWeb(query: string, options: SearchWebOptions = {}): Promise<WebSearchResponse> {
  const startedAt = Date.now();
  const settings = options.settings ?? readWebSearchSettings();
  const parsed = parseSearchQuery(query);
  const count = clampCount(options.count);
  const chain = resolveProviderChain(settings, options.provider);
  const failures: WebSearchFailure[] = [];

  for (const provider of chain) {
    if (!webSearchProviderReady(settings, provider)) {
      failures.push({ provider, message: "not configured" });
      continue;
    }
    try {
      const raw = await runProvider(provider, query, { count, ...(options.recency ? { recency: options.recency } : {}), ...(options.signal ? { signal: options.signal } : {}), ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), settings });
      // 结果页不认 `site:` / `filetype:` 时本地再筛一遍（只筛不补）。
      const results = raw.filter((result) => matchesQueryConstraints(result.url, parsed));
      if (results.length === 0) {
        failures.push({
          provider,
          message: raw.length > 0
            ? "returned results, but none matched site:/filetype: constraints"
            : "returned no results",
        });
        continue;
      }
      return { provider, results, failures, durationMs: Date.now() - startedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ provider, message });
      // 调用方主动取消：不再试下一档。
      if (options.signal?.aborted) break;
    }
  }
  return { provider: chain[chain.length - 1] ?? settings.provider, results: [], failures, durationMs: Date.now() - startedAt };
}

/** 一句人话的失败摘要（工具与设置页共用）。 */
export function describeSearchFailures(failures: readonly WebSearchFailure[]): string {
  return failures
    .map((failure) => `${WEB_SEARCH_PROVIDERS[failure.provider]?.label ?? failure.provider}: ${failure.message}`)
    .join(" · ");
}
