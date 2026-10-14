/**
 * fork:websearch —— 「设置 → 联网搜索」的读写。
 *
 * 存在 `~/.pi/agent/pi-web-preferences.json` 的 `webSearch` 段（走 `lib/pi-web-preferences.ts`，
 * 全仓单写入者）——**不写 pi 的 settings.json**：那是 pi 自己的 schema，写它等于替别的运行时做决定。
 *
 * 与 im-bridge / 生图同一条铁律：`searxngToken` 在 GET 里只回掩码，写入时掩码值 = 沿用已存值。
 */

import { readAppSettings, writeAppSettings } from "../../engine/app-settings.ts";
import { getPinextPaths } from "../../engine/paths.ts";
import {
  WEB_SEARCH_DEFAULTS,
  WEB_SEARCH_MAX_TIMEOUT_SECONDS,
  WEB_SEARCH_PROVIDER_IDS,
  WEB_SEARCH_TOKEN_MASK,
  isWebSearchProviderId,
  type WebSearchProviderId,
  type WebSearchSettings,
} from "../../../shared/websearch.ts";

export { WEB_SEARCH_TOKEN_MASK };
export type { WebSearchSettings };

interface LegacyShape {
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

function clampTimeout(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : WEB_SEARCH_DEFAULTS.timeoutSeconds;
  return Math.min(WEB_SEARCH_MAX_TIMEOUT_SECONDS, Math.max(5, n));
}

/** 任意 JSON → 合法设置（字段缺失落默认，绝不抛）。 */
export function normalizeWebSearchSettings(value: unknown): WebSearchSettings {
  const raw = (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    provider: isWebSearchProviderId(raw.provider) ? raw.provider : WEB_SEARCH_DEFAULTS.provider,
    fallbackToPublic: raw.fallbackToPublic !== false,
    timeoutSeconds: clampTimeout(raw.timeoutSeconds),
    searxngEndpoint: typeof raw.searxngEndpoint === "string" ? raw.searxngEndpoint.trim() : "",
    searxngToken: typeof raw.searxngToken === "string" ? raw.searxngToken : "",
    searxngLanguage: typeof raw.searxngLanguage === "string" ? raw.searxngLanguage.trim() : "",
    allowPrivateEndpoint: raw.allowPrivateEndpoint === true,
  };
}

/**
 * The `webSearch` section of this host's own settings file.
 *
 * PI NEXT kept it in `~/.pi/agent/pi-web-preferences.json`; this host keeps its preferences
 * in its own `settings.json` (see `engine/app-settings.ts`), which is also where the
 * renderer writes everything else. One file, one reader, one writer.
 */
export function readWebSearchSettings(): WebSearchSettings {
  const stored = readAppSettings(getPinextPaths()).webSearch as Partial<WebSearchSettings> | undefined;
  return normalizeWebSearchSettings(stored);
}

/** 掩码视图：token 有值就换成掩码常量（明文不过网）。 */
export function maskedWebSearchSettings(settings: WebSearchSettings): WebSearchSettings {
  return { ...settings, searxngToken: settings.searxngToken ? WEB_SEARCH_TOKEN_MASK : "" };
}

/** 掩码值 = 沿用已存 token；显式空串才是清掉。 */
export function writeWebSearchSettings(patch: Partial<WebSearchSettings>): WebSearchSettings {
  const current = readWebSearchSettings();
  const next = normalizeWebSearchSettings({
    ...current,
    ...patch,
    searxngToken: patch.searxngToken === undefined
      ? current.searxngToken
      : patch.searxngToken === WEB_SEARCH_TOKEN_MASK
        ? current.searxngToken
        : patch.searxngToken,
  });
  const paths = getPinextPaths();
  // Read-modify-write through the same helpers the renderer uses, so a concurrent settings
  // change from the UI is not clobbered by this one section.
  writeAppSettings(paths, { ...readAppSettings(paths), webSearch: next });
  return next;
}

/** 设置页 / 工具共用的一句状态：这一档现在能不能真的跑。 */
export function webSearchProviderReady(settings: WebSearchSettings, provider: WebSearchProviderId): boolean {
  if (!(WEB_SEARCH_PROVIDER_IDS as readonly string[]).includes(provider)) return false;
  if (provider === "searxng") return settings.searxngEndpoint.length > 0;
  return true;
}
