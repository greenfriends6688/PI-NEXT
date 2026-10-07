/**
 * fork:websearch —— **客户端安全**的类型与 provider 注册表。
 *
 * 形态照抄参考项目 `pi参考项目/MusePi-main/packages/coding-agent/src/web/search/types.ts`：
 * provider 选项表是**唯一真相**，设置页的下拉与运行时的候选链都从它推导，不许各写一份。
 *
 * 第一期只做**免 API key** 的三档（这是调研结论：MusePi 那张 20 项的 provider 表里
 * 绝大多数要 key，照抄会立刻变成「一堆选项但都不能用」）：
 *   · `searxng`    —— 自建/公共实例，端点本身不需要 key（最稳）
 *   · `duckduckgo` —— 无凭证抓取 `html.duckduckgo.com/html/`（机房 IP 上可能被风控）
 *   · `public`     —— 并行问多个无凭证引擎，按共识合并去重（慢一点但更全）
 */

export type WebSearchProviderId = "searxng" | "duckduckgo" | "bing" | "mojeek" | "public";

export interface WebSearchProviderMeta {
  id: WebSearchProviderId;
  label: string;
  /** 一句「它是怎么免 key 的 / 会踩什么坑」，设置页直接显示。 */
  description: string;
  /** 需要在设置里填的东西（空 = 拿来就能用）。 */
  requires: "searxngEndpoint" | null;
  /** 建议超时（秒）。聚合要多给窗口。 */
  defaultTimeoutSeconds: number;
}

export const WEB_SEARCH_PROVIDERS: Record<WebSearchProviderId, WebSearchProviderMeta> = {
  searxng: {
    id: "searxng",
    label: "SearXNG",
    description: "自己有一个实例（公共实例也能填），端点不需要 key；最稳，建议首选。",
    requires: "searxngEndpoint",
    defaultTimeoutSeconds: 20,
  },
  duckduckgo: {
    id: "duckduckgo",
    label: "DuckDuckGo",
    description: "无凭证抓取无 JS 版结果页。机房/共享出口 IP 上可能被风控（会如实报错，不假装成功）。",
    requires: null,
    defaultTimeoutSeconds: 20,
  },
  bing: {
    id: "bing",
    label: "Bing",
    description: "无凭证抓取 cn.bing.com 的静态结果页；实测在中国大陆网络下可达（DuckDuckGo 不可达）。中文覆盖好。",
    requires: null,
    defaultTimeoutSeconds: 20,
  },
  mojeek: {
    id: "mojeek",
    label: "Mojeek",
    description: "无凭证抓取，独立索引（不和 Google/Bing 同源），做补充来源用。",
    requires: null,
    defaultTimeoutSeconds: 20,
  },
  public: {
    id: "public",
    label: "多引擎聚合",
    description: "并行问 DuckDuckGo / Mojeek，按共识合并去重；更全也更慢。",
    requires: null,
    defaultTimeoutSeconds: 30,
  },
};

export const WEB_SEARCH_PROVIDER_IDS: readonly WebSearchProviderId[] = ["searxng", "bing", "duckduckgo", "mojeek", "public"];

export function isWebSearchProviderId(value: unknown): value is WebSearchProviderId {
  return typeof value === "string" && (WEB_SEARCH_PROVIDER_IDS as readonly string[]).includes(value);
}

/* 默认选 bing：实测国内可达，而 DuckDuckGo 在国内超时（用户仍可在设置里换）。 */
export const WEB_SEARCH_DEFAULT_PROVIDER: WebSearchProviderId = "bing";
export const WEB_SEARCH_DEFAULT_TIMEOUT_SECONDS = 30;
export const WEB_SEARCH_MAX_TIMEOUT_SECONDS = 120;
export const WEB_SEARCH_MAX_RESULTS = 20;
export const WEB_SEARCH_DEFAULT_RESULTS = 10;

export type WebSearchRecency = "day" | "week" | "month" | "year";

export const WEB_SEARCH_RECENCIES: readonly WebSearchRecency[] = ["day", "week", "month", "year"];

export function isWebSearchRecency(value: unknown): value is WebSearchRecency {
  return typeof value === "string" && (WEB_SEARCH_RECENCIES as readonly string[]).includes(value);
}

/** 一条结果。`source` = 哪一档 provider 给的（聚合时用得上）。 */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  /** 结果页给的日期（ISO 或相对文本）。 */
  publishedDate?: string;
  source: WebSearchProviderId;
}

export interface WebSearchFailure {
  provider: WebSearchProviderId;
  message: string;
}

export interface WebSearchResponse {
  /** 最终出结果的 provider（回退之后就是回退到的那个）。 */
  provider: WebSearchProviderId;
  results: WebSearchResult[];
  /** 试过但失败的档（含原因），给用户与模型一个诚实的解释。 */
  failures: WebSearchFailure[];
  durationMs: number;
}

export class WebSearchError extends Error {
  readonly provider: WebSearchProviderId;
  constructor(provider: WebSearchProviderId, message: string) {
    super(message);
    this.name = "WebSearchError";
    this.provider = provider;
  }
}

/** 归一化后的查询（`parseSearchQuery` 的产物）。 */
export interface ParsedSearchQuery {
  /** 去掉了 site:/filetype: 之后的自由文本。 */
  text: string;
  site?: string;
  filetype?: string;
  /** 排除词（`-term`）。 */
  excluded: string[];
  /** 必须包含的短语（引号里的）。 */
  phrases: string[];
}
