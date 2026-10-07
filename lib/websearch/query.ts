/**
 * fork:websearch —— 查询解析（客户端安全，纯函数）。
 *
 * 支持参考项目那套「前缀即语法」（MusePi `web/search/query.ts`）里最有用的三项：
 * `site:` / `filetype:` / `-排除词` 与引号短语。**不做** `+`/`OR` 之类的布尔语法：
 * 各家 scraper 支持程度不一，写进去只会得到「有时生效」的假象。
 *
 * 解析结果有两个用处：抓取时拼成各家认的查询串（`formatScraperQuery`），
 * 以及**本地兜底过滤**（结果页不认 `site:` 时我们自己筛）。
 */

import type { ParsedSearchQuery } from "./types";

const SITE_PATTERN = /(?:^|\s)site:([^\s]+)/i;
const FILETYPE_PATTERN = /(?:^|\s)filetype:([^\s]+)/i;
const QUOTED_PATTERN = /"([^"]+)"/g;
const EXCLUDED_PATTERN = /(?:^|\s)-([^\s-][^\s]*)/g;

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const input = raw.trim();
  const site = SITE_PATTERN.exec(input)?.[1];
  const filetype = FILETYPE_PATTERN.exec(input)?.[1];
  const phrases: string[] = [];
  for (const match of input.matchAll(QUOTED_PATTERN)) phrases.push(match[1].trim());
  const excluded: string[] = [];
  for (const match of input.matchAll(EXCLUDED_PATTERN)) excluded.push(match[1].trim());

  // 自由文本 = 去掉被认出来的那些 token（引号里的短语**留着**：它也是查询内容）。
  const text = input
    .replace(SITE_PATTERN, " ")
    .replace(FILETYPE_PATTERN, " ")
    .replace(EXCLUDED_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    text,
    ...(site ? { site } : {}),
    ...(filetype ? { filetype } : {}),
    excluded,
    phrases,
  };
}

/** 拼成给 scraper 的查询串：把 `site:` / `filetype:` 原样带上（DDG/SearXNG 都认）。 */
export function formatScraperQuery(parsed: ParsedSearchQuery): string {
  const parts = [parsed.text || parsed.phrases.join(" ")];
  if (parsed.site) parts.push(`site:${parsed.site}`);
  if (parsed.filetype) parts.push(`filetype:${parsed.filetype}`);
  for (const term of parsed.excluded) parts.push(`-${term}`);
  return parts.filter(Boolean).join(" ").trim();
}

function hostMatches(hostname: string, site: string): boolean {
  const target = site.toLowerCase().replace(/^\*\./, "");
  const host = hostname.toLowerCase();
  return host === target || host.endsWith(`.${target}`);
}

/**
 * 结果页不认 `site:` / `filetype:` 时（或它给了泛结果）在本地再筛一遍。
 * **只筛、不补**：筛空了就返回空数组 —— 让上层如实说「这一档没给出匹配结果」，
 * 而不是偷偷放宽条件假装成功。
 */
export function matchesQueryConstraints(url: string, parsed: ParsedSearchQuery): boolean {
  if (parsed.site || parsed.filetype) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return false;
    }
    if (parsed.site && !hostMatches(parsedUrl.hostname, parsed.site)) return false;
    if (parsed.filetype) {
      const wanted = parsed.filetype.replace(/^\./, "").toLowerCase();
      const path = parsedUrl.pathname.toLowerCase();
      if (!path.endsWith(`.${wanted}`)) return false;
    }
  }
  return true;
}
