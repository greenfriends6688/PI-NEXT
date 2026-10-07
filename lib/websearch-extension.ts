/**
 * fork:websearch —— `web_search` 工具（pi 内联扩展）。
 *
 * 形态遵循 `AGENTS.md`「产品能力不许降级成 skill」：这是**工具**，不是 skill ——
 * 工具名进 `get_tools`、能被 `lib/approval-policy.ts` 按名字拦（默认「需审批」，它会出网）、
 * 可统计、有 UI（设置分节 + 消息流结果卡）。
 *
 * 三条不变量：
 *   1. **只回标题 + URL + 摘要 + 时间，不回正文**：正文交给 `web_fetch` / `browser_extract`，
 *      否则一次搜索就把上下文塞满（参考项目同一条口径）。
 *   2. **失败如实说**：谁被风控、谁超时、谁没配，逐条写进正文 —— 空数组会被模型当成
 *      「世界上没有这件事」。
 *   3. **关着就是关着**：设置里没开时直接拒绝，不偷偷出网。
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type InlineExtension } from "@earendil-works/pi-coding-agent";

import { describeSearchFailures, searchWeb } from "./websearch";
import { readWebSearchSettings } from "./websearch-settings";
import {
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_PROVIDER_IDS,
  WEB_SEARCH_RECENCIES,
  isWebSearchProviderId,
  type WebSearchResponse,
} from "./websearch/types";

export const HOST_WEBSEARCH_EXTENSION_NAME = "pi-web-websearch";

function formatResults(response: WebSearchResponse): string {
  const lines = response.results.map((result, index) => {
    const meta = [result.publishedDate, result.snippet].filter(Boolean).join(" · ");
    return `${index + 1}. ${result.title}\n   ${result.url}${meta ? `\n   ${meta}` : ""}`;
  });
  const note = response.failures.length > 0 ? `\n\n(tried before this one — ${describeSearchFailures(response.failures)})` : "";
  return `${response.results.length} result(s) via ${response.provider} in ${Math.round(response.durationMs)}ms:\n${lines.join("\n")}${note}`;
}

export function createWebSearchExtension(): InlineExtension {
  return {
    name: HOST_WEBSEARCH_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      pi.registerTool(defineTool({
        name: "web_search",
        label: "Web search",
        description: [
          "Search the web and return titles, URLs and snippets (no page bodies).",
          "Works without an API key: SearXNG (your own instance), DuckDuckGo and a multi-engine aggregate.",
          "Supports `site:`, `filetype:`, quoted phrases and `-exclude` inside the query.",
          "Use web_fetch or the browser tools when you need the actual page content.",
        ].join(" "),
        promptSnippet: "Search the web (no API key needed)",
        promptGuidelines: [
          "Quote the URL you actually used when you cite a result; never invent one.",
          "One search is usually enough — refine the query (site:, filetype:, quotes) instead of re-running the same one.",
          "If it reports a bot challenge or a timeout, say so instead of answering from memory.",
        ],
        parameters: Type.Object({
          query: Type.String({ description: "What to search for. `site:`, `filetype:`, \"phrases\" and -exclusions are understood." }),
          count: Type.Optional(Type.Number({ description: `How many results, 1-${WEB_SEARCH_MAX_RESULTS}. Default 10.` })),
          recency: Type.Optional(Type.String({ description: `Time filter: ${WEB_SEARCH_RECENCIES.join(" | ")}.` })),
          provider: Type.Optional(Type.String({ description: `Force one backend: ${WEB_SEARCH_PROVIDER_IDS.join(" | ")}. Default: the one configured in Settings → Web search.` })),
        }),
        async execute(_toolCallId, params, signal) {
          const settings = readWebSearchSettings();
          if (!settings.enabled) {
            return {
              content: [{ type: "text" as const, text: "Web search is switched off. The user turns it on in Settings → Web search." }],
              details: undefined,
              isError: true,
            };
          }
          const provider = isWebSearchProviderId(params.provider) ? params.provider : undefined;
          const recency = WEB_SEARCH_RECENCIES.find((value) => value === params.recency);
          const response = await searchWeb(params.query, {
            ...(provider ? { provider } : {}),
            ...(typeof params.count === "number" ? { count: params.count } : {}),
            ...(recency ? { recency } : {}),
            ...(signal ? { signal } : {}),
            settings,
          });
          if (response.results.length === 0) {
            return {
              content: [{ type: "text" as const, text: `Web search found nothing. ${describeSearchFailures(response.failures)}` }],
              details: undefined,
              isError: true,
            };
          }
          return {
            content: [{ type: "text" as const, text: formatResults(response) }],
            details: { results: response.results, provider: response.provider, failures: response.failures },
          };
        },
      }));
    },
  };
}
