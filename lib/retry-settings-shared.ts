// fork:pwa-build-2026-10-01 —— `lib/retry-settings.ts` 的**纯常量 / 类型**部分。
//
// 为什么要拆：`lib/retry-settings.ts` 读写真实文件（`node:fs` / `node:path` /
// pi 的 `SettingsManager` / `proper-lockfile`），只能活在服务端；而面板
// `components/RetrySettingsBlock.tsx` 是 `"use client"`，为了那三个上限常量与
// 默认值把整个模块拉进浏览器依赖图，webpack 直接报
// `Module not found: Can't resolve 'fs'`（连带 `child_process`），prod 构建整条挂掉。
//
// 客户端只需要「形状 + 取值范围」：表单初值（RETRY_DEFAULTS）、两个 number 输入的
// min/max（RETRY_MAX_*）、以及 `Partial<RetrySettings>` 这个类型。这些没有任何
// 平台依赖，所以放这一份；服务端 `lib/retry-settings.ts` 从这里再导出，
// 对调用方（API 路由 / 服务端读）保持原样，不改任何一处 import 语义。
export interface RetrySettings {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
}

/** 与 `SettingsManager.getRetrySettings()` 的内建默认逐值一致（SDK `settings-manager.js:606-624`）。 */
export const RETRY_DEFAULTS: RetrySettings = { enabled: true, maxRetries: 3, baseDelayMs: 2000 };

/**
 * UI 与服务端共用的取值范围。SDK 自己不校验（`getRetrySettings()` 直接 `?? 3`），
 * 所以上限是我们定的：重试次数再多只是白等，基础延迟再大只是每次都超时。
 * 与 `pi-agent-core/dist/harness/config.js:17-22` 的下限（≥ 0 的安全整数）对齐。
 */
export const RETRY_MAX_RETRIES = 20;
export const RETRY_MAX_BASE_DELAY_MS = 60_000;