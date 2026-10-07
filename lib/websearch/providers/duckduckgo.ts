/**
 * fork:websearch —— DuckDuckGo（**无凭证**）。
 *
 * 照抄 `pi参考项目/MusePi-main/packages/coding-agent/src/web/search/providers/duckduckgo.ts`
 * 的结论：用无 JS 的 `https://html.duckduckgo.com/html/`（POST 一个表单），**不要**用
 * `api.duckduckgo.com`（Instant Answer API 只对维基/计算类问题有内容，绝大多数查询是空的）。
 *
 * 两个坑都在这份实现里：
 *   · 出站链接是 `//duckduckgo.com/l/?uddg=<encoded>` 的跳转包装 → 必须还原真实 URL；
 *   · 被风控时它可能回 **202**（或 200 但正文是挑战页）→ 判失败并如实说，**不是空结果**。
 *
 * 解析与网络分开：`parseDuckDuckGoHtml()` 是纯函数，单测直接喂 HTML。
 */

import { formatScraperQuery, parseSearchQuery } from "../query";
import { WebSearchError, type WebSearchRecency, type WebSearchResult } from "../types";
import { fetchText, scraperHeaders } from "../fetch";

const HTML_ENDPOINT = "https://html.duckduckgo.com/html/";

const RECENCY_TO_DF: Record<WebSearchRecency, string> = { day: "d", week: "w", month: "m", year: "y" };

/** 去标签 + 解实体（结果页把查询词包在 `<b>` 里）。
 *  块级标签换空格、行内标签直接删 —— 否则 `badlogic/<b>pi</b>` 会变成 `badlogic/ pi`。 */
export function decodeHtmlText(value: string): string {
  return value
    .replace(/<\/?(?:br|p|div|li|ul|ol|h[1-6]|tr|td|table)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** `//duckduckgo.com/l/?uddg=<encoded>` → 真实目标 URL。 */
export function unwrapResultUrl(href: string): string | undefined {
  const trimmed = href.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed) && !/^https?:\/\/(?:[a-z0-9-]+\.)?duckduckgo\.com\/l\//i.test(trimmed)) {
    return trimmed;
  }
  const withProtocol = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  try {
    const url = new URL(withProtocol, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    if (target) return target;
    return /^https?:\/\//i.test(url.href) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** 正文看起来像风控挑战页 / 验证码页。 */
export function looksLikeChallenge(html: string): boolean {
  const probe = html.slice(0, 4000).toLowerCase();
  return /anomaly-modal|challenge-form|are you a robot|you are a robot|verify you are|unusual traffic|captcha|robot check/.test(probe);
}

/** 纯解析：按出现顺序配对 `result__a`（标题/链接）与随后的 `result__snippet`。 */
export function parseDuckDuckGoHtml(html: string, limit: number): WebSearchResult[] {
  const anchors = [...html.matchAll(/<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ index: match.index ?? 0, href: match[1], title: decodeHtmlText(match[2]) }));
  const snippets = [...html.matchAll(/<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ index: match.index ?? 0, text: decodeHtmlText(match[1]) }));
  const timestamps = [...html.matchAll(/<span\b[^>]*class="[^"]*result__timestamp[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => ({ index: match.index ?? 0, text: decodeHtmlText(match[1]) }));

  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const [position, anchor] of anchors.entries()) {
    const url = unwrapResultUrl(anchor.href);
    if (!url || seen.has(url) || !anchor.title) continue;
    const nextAnchorIndex = anchors[position + 1]?.index ?? Number.POSITIVE_INFINITY;
    const snippet = snippets.find((entry) => entry.index > anchor.index && entry.index < nextAnchorIndex)?.text;
    const published = timestamps.find((entry) => entry.index > anchor.index && entry.index < nextAnchorIndex)?.text;
    seen.add(url);
    results.push({
      title: anchor.title,
      url,
      ...(snippet ? { snippet } : {}),
      ...(published ? { publishedDate: published } : {}),
      source: "duckduckgo",
    });
    if (results.length >= limit) break;
  }
  return results;
}

export interface DuckDuckGoOptions {
  limit: number;
  recency?: WebSearchRecency;
  signal?: AbortSignal;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export async function searchDuckDuckGo(query: string, options: DuckDuckGoOptions): Promise<WebSearchResult[]> {
  const parsed = parseSearchQuery(query);
  const form = new URLSearchParams({ q: formatScraperQuery(parsed), b: "" });
  if (options.recency) form.set("df", RECENCY_TO_DF[options.recency]);

  const { status, text } = await fetchText(HTML_ENDPOINT, {
    method: "POST",
    headers: scraperHeaders({
      "content-type": "application/x-www-form-urlencoded",
      referer: "https://duckduckgo.com/",
    }),
    body: form.toString(),
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs: options.timeoutMs,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  const results = parseDuckDuckGoHtml(text, options.limit);
  if (results.length > 0) return results;
  if (status === 202 || looksLikeChallenge(text)) {
    throw new WebSearchError("duckduckgo", "answered with a bot challenge (try SearXNG or the aggregate)");
  }
  throw new WebSearchError("duckduckgo", `no results parsed (HTTP ${status})`);
}
