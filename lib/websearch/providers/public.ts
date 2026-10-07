/**
 * fork:websearch —— `public`：并行问多个**无凭证**引擎，按共识合并去重。
 *
 * 照 `pi参考项目/MusePi-main/.../providers/public.ts` 的思路：单引擎被风控是常态，
 * 所以一次问两家、按「被几个引擎同时命中」排序 —— 共识高的排前面，其次保持各引擎自己的
 * 顺序（前一个引擎赢平局）。**不编造**：两家都没结果就是没结果。
 */

import type { WebSearchRecency, WebSearchResult } from "../types";
import { searchBing } from "./bing";
import { searchDuckDuckGo } from "./duckduckgo";
import { searchMojeek } from "./mojeek";

export interface PublicEngineOutcome {
  results: WebSearchResult[];
  failures: { provider: "bing" | "duckduckgo" | "mojeek"; message: string }[];
}

/** 纯合并：共识优先，其次按「第一次出现的引擎顺序」。 */
export function mergePublicResults(lists: readonly WebSearchResult[][], limit: number): WebSearchResult[] {
  const votes = new Map<string, { result: WebSearchResult; hits: number; order: number }>();
  let order = 0;
  for (const list of lists) {
    for (const result of list) {
      const existing = votes.get(result.url);
      if (existing) {
        existing.hits += 1;
        // 摘要取更长的那一份（另一家往往给得更全）。
        if ((result.snippet?.length ?? 0) > (existing.result.snippet?.length ?? 0)) existing.result = { ...existing.result, ...(result.snippet ? { snippet: result.snippet } : {}) };
        continue;
      }
      votes.set(result.url, { result, hits: 1, order: order++ });
    }
  }
  return [...votes.values()]
    .sort((a, b) => (b.hits - a.hits) || (a.order - b.order))
    .slice(0, limit)
    .map((entry) => ({ ...entry.result, source: "public" as const }));
}

export interface PublicOptions {
  limit: number;
  recency?: WebSearchRecency;
  signal?: AbortSignal;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export async function searchPublic(query: string, options: PublicOptions): Promise<PublicEngineOutcome> {
  const perEngine = Math.max(5, options.limit);
  /* **软截止**（照 MusePi `public.ts` 的口径）：单引擎被墙/超时是常态（实测国内 DDG 要 10.5s
     才失败），聚合不能等最慢的那家 —— 至少一家回来了就先出结果，慢的那些被丢弃。 */
  const engines = [
    { id: "bing" as const, run: () => searchBing(query, { limit: perEngine, ...(options.signal ? { signal: options.signal } : {}), timeoutMs: options.timeoutMs, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }) },
    { id: "duckduckgo" as const, run: () => searchDuckDuckGo(query, { limit: perEngine, ...(options.recency ? { recency: options.recency } : {}), ...(options.signal ? { signal: options.signal } : {}), timeoutMs: options.timeoutMs, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }) },
    { id: "mojeek" as const, run: () => searchMojeek(query, { limit: perEngine, ...(options.signal ? { signal: options.signal } : {}), timeoutMs: options.timeoutMs, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }) },
  ];
  const lists: WebSearchResult[][] = [];
  const failures: PublicEngineOutcome["failures"] = [];
  const softDeadlineMs = Math.max(2_000, options.timeoutMs - 8_000);
  await new Promise<void>((resolve) => {
    let pending = engines.length;
    const finish = () => { clearTimeout(soft); resolve(); };
    const soft = setTimeout(() => { if (lists.length > 0) finish(); }, softDeadlineMs);
    for (const engine of engines) {
      engine.run()
        .then((results) => { lists.push(results); })
        .catch((error: unknown) => { failures.push({ provider: engine.id, message: error instanceof Error ? error.message : String(error) }); })
        .finally(() => { pending -= 1; if (pending === 0) finish(); });
    }
  });
  return { results: mergePublicResults(lists, options.limit), failures };
}
