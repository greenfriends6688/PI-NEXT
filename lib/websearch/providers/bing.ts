/**
 * fork:websearch —— Bing（**无凭证**，且**在中国大陆网络下可达**）。
 *
 * 为什么加这一档（2026-10-07 本机实测）：`html.duckduckgo.com` 在这台机器上 **20s 超时**
 * （国内不可达），公共 SearXNG 实例大多也超时；而 `cn.bing.com` 200 / 45KB / 6s 可达。
 * 中文查询与国内站点在 Bing 上的覆盖也更好 —— 这是「免 key 且真能用」的关键一档。
 *
 * 结果页是服务端渲染的静态 HTML：`<li class="b_algo"><h2><a href="…">标题</a></h2>
 * <div class="b_caption"><p>摘要</p></div></li>`，没有跳转包装，不需要真浏览器。
 */

import { formatScraperQuery, parseSearchQuery } from "../query";
import { WebSearchError, type WebSearchResult } from "../types";
import { fetchText, scraperHeaders } from "../fetch";
import { decodeHtmlText, looksLikeChallenge } from "./duckduckgo";

const HTML_ENDPOINT = "https://cn.bing.com/search";

/** 纯解析：按 `<li class="b_algo">` 分块取第一个 http(s) 链接与 `b_caption` 里的摘要。 */
export function parseBingHtml(html: string, limit: number): WebSearchResult[] {
  const blocks = [...html.matchAll(/<li\b[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => match[1]);
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const anchor = /<h2[^>]*>\s*<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
      ?? /<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    const url = anchor[1];
    const title = decodeHtmlText(anchor[2]);
    if (!title || seen.has(url)) continue;
    const snippet = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1]
      ?? /<div\b[^>]*class="[^"]*\bb_caption\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1];
    seen.add(url);
    results.push({
      title,
      url,
      ...(snippet ? { snippet: decodeHtmlText(snippet) } : {}),
      source: "bing",
    });
    if (results.length >= limit) break;
  }
  return results;
}

export interface BingOptions {
  limit: number;
  signal?: AbortSignal;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export async function searchBing(query: string, options: BingOptions): Promise<WebSearchResult[]> {
  const url = `${HTML_ENDPOINT}?q=${encodeURIComponent(formatScraperQuery(parseSearchQuery(query)))}&setlang=zh-hans`;
  const { status, text } = await fetchText(url, {
    headers: scraperHeaders({ referer: "https://cn.bing.com/" }),
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs: options.timeoutMs,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const results = parseBingHtml(text, options.limit);
  if (results.length > 0) return results;
  if (looksLikeChallenge(text)) throw new WebSearchError("bing", "answered with a bot challenge");
  throw new WebSearchError("bing", `no results parsed (HTTP ${status})`);
}
