/**
 * 联网搜索 (fork:websearch) — the half the renderer is allowed to see.
 *
 * Shared because both sides need the same vocabulary: the settings pane draws the provider
 * list, the tool reads the settings, and the two must not drift. The provider metadata
 * (labels, descriptions, which one needs an endpoint) stays in the main process — it is
 * prose for the tool's prompt, not something the page renders.
 */

export const WEB_SEARCH_PROVIDER_IDS: readonly WebSearchProviderId[] = ["searxng", "bing", "duckduckgo", "mojeek", "public"];

export type WebSearchProviderId = "searxng" | "bing" | "duckduckgo" | "mojeek" | "public";

export function isWebSearchProviderId(value: unknown): value is WebSearchProviderId {
  return typeof value === "string" && (WEB_SEARCH_PROVIDER_IDS as readonly string[]).includes(value);
}

/* 默认选 bing：实测国内可达，而 DuckDuckGo 在国内超时（用户仍可在设置里换）。 */
export const WEB_SEARCH_DEFAULT_PROVIDER: WebSearchProviderId = "bing";
export const WEB_SEARCH_DEFAULT_TIMEOUT_SECONDS = 30;
export const WEB_SEARCH_MAX_TIMEOUT_SECONDS = 120;

/** The mask `get` returns in place of the token; sending it back means "keep the stored one". */
export const WEB_SEARCH_TOKEN_MASK = "••••••••";

export interface WebSearchSettings {
  /** 默认**关**（与「记忆」同口径：会出网的能力先关，由用户打开）。 */
  enabled: boolean;
  provider: WebSearchProviderId;
  /** 主 provider 失败时是否回退到聚合档。 */
  fallbackToPublic: boolean;
  timeoutSeconds: number;
  searxngEndpoint: string;
  searxngToken: string;
  searxngLanguage: string;
  /** 允许端点指向本机/局域网（自建 SearXNG 的常见形态，默认关）。 */
  allowPrivateEndpoint: boolean;
}

export const WEB_SEARCH_DEFAULTS: WebSearchSettings = {
  enabled: false,
  provider: WEB_SEARCH_DEFAULT_PROVIDER,
  fallbackToPublic: true,
  timeoutSeconds: WEB_SEARCH_DEFAULT_TIMEOUT_SECONDS,
  searxngEndpoint: "",
  searxngToken: "",
  searxngLanguage: "",
  allowPrivateEndpoint: false,
};
