/**
 * fork:websearch —— Mojeek（**无凭证**，独立索引）。
 *
 * 参考项目把它放在聚合链的最后一位做「打破平局」的独立来源
 * （`MusePi .../providers/public.ts` 的 `PUBLIC_ENGINE_IDS`）。它的结果页是干净的静态 HTML：
 * `<ul class="results-standard"><li><h2><a href="…">标题</a></h2><p class="s">摘要</p>…`，
 * 比 Startpage/Ecosia 好抓得多，所以第一期只上它 + DuckDuckGo 两档。
 */

import { formatScraperQuery, parseSearchQuery } from "../query";
import { WebSearchError, type WebSearchResult } from "../types";
import { fetchText, scraperHeaders } from "../fetch";
import { decodeHtmlText, looksLikeChallenge } from "./duckduckgo";

const HTML_ENDPOINT = "https://www.mojeek.com/search";

export function parseMojeekHtml(html: string, limit: number): WebSearchResult[] {
  const blocks = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => match[1]);
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const anchor = /<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    const url = anchor[1];
    const title = decodeHtmlText(anchor[2]);
    if (!title || seen.has(url)) continue;
    const snippet = /<p\b[^>]*class="[^"]*\bs\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1];
    seen.add(url);
    results.push({
      title,
      url,
      ...(snippet ? { snippet: decodeHtmlText(snippet) } : {}),
      source: "mojeek",
    });
    if (results.length >= limit) break;
  }
  return results;
}

export interface MojeekOptions {
  limit: number;
  signal?: AbortSignal;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export async function searchMojeek(query: string, options: MojeekOptions): Promise<WebSearchResult[]> {
  const url = `${HTML_ENDPOINT}?q=${encodeURIComponent(formatScraperQuery(parseSearchQuery(query)))}`;
  const { status, text } = await fetchText(url, {
    headers: scraperHeaders({ referer: "https://www.mojeek.com/" }),
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs: options.timeoutMs,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const results = parseMojeekHtml(text, options.limit);
  if (results.length > 0) return results;
  if (looksLikeChallenge(text)) throw new WebSearchError("mojeek", "answered with a bot challenge");
  throw new WebSearchError("mojeek", `no results parsed (HTTP ${status})`);
}
