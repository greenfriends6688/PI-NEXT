/**
 * fork:websearch —— SearXNG（**无凭证**：端点本身不需要 key，token 只是自建实例可选的）。
 *
 * 走官方 Search API（`GET {endpoint}/search?q=…&format=json`，见
 * https://docs.searxng.org/dev/search_api.html）。参考项目里这一档的配置面是
 * `endpoint / token / basicUsername / basicPassword / categories / engines / language`
 * （MusePi `providers/searxng.ts`）；我们只做前三项 —— 后三项留给用户自己的实例默认值。
 */

import { formatScraperQuery, parseSearchQuery } from "../query";
import { WebSearchError, type WebSearchResult } from "../types";
import { assertEndpointAllowed, fetchText, type EndpointPolicy } from "../fetch";

interface SearxngPayload {
  results?: { title?: unknown; url?: unknown; content?: unknown; publishedDate?: unknown }[];
  answers?: unknown[];
}

/** 纯解析：SearXNG 的 JSON → 统一结果（`content` 就是摘要）。 */
export function parseSearxngPayload(payload: unknown, limit: number): WebSearchResult[] {
  const root = (payload ?? {}) as SearxngPayload;
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const entry of root.results ?? []) {
    const url = typeof entry?.url === "string" ? entry.url : "";
    const title = typeof entry?.title === "string" ? entry.title.trim() : "";
    if (!url || !title || seen.has(url)) continue;
    const snippet = typeof entry.content === "string" ? entry.content.trim() : "";
    const published = typeof entry.publishedDate === "string" ? entry.publishedDate : "";
    seen.add(url);
    results.push({
      title,
      url,
      ...(snippet ? { snippet } : {}),
      ...(published ? { publishedDate: published } : {}),
      source: "searxng",
    });
    if (results.length >= limit) break;
  }
  return results;
}

export interface SearxngOptions {
  endpoint: string;
  limit: number;
  token?: string;
  language?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  policy: EndpointPolicy;
  fetchImpl?: typeof fetch;
}

export async function searchSearxng(query: string, options: SearxngOptions): Promise<WebSearchResult[]> {
  const base = assertEndpointAllowed(options.endpoint, "searxng", options.policy);
  const url = new URL("search", base.href.endsWith("/") ? base.href : `${base.href}/`);
  url.searchParams.set("q", formatScraperQuery(parseSearchQuery(query)));
  url.searchParams.set("format", "json");
  if (options.language) url.searchParams.set("language", options.language);

  const headers: Record<string, string> = { accept: "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  const { status, text } = await fetchText(url.href, {
    headers,
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs: options.timeoutMs,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  if (status < 200 || status >= 300) {
    throw new WebSearchError("searxng", `HTTP ${status} from the instance`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new WebSearchError(
      "searxng",
      "did not return JSON — most public instances disable the JSON API; enable it in settings.yml (search.formats)",
    );
  }
  const results = parseSearxngPayload(payload, options.limit);
  if (results.length === 0) throw new WebSearchError("searxng", "returned no results");
  return results;
}
