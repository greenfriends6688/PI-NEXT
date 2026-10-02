// fork:pr12-a5-context-budget —— `lib/context-budget-settings.ts` 的**纯常量 / 类型**部分。
//
// 为什么要拆：服务端那份读写真实文件（`node:fs` / `proper-lockfile` / pi 的
// `SettingsManager`），只能活在服务端；面板 `components/ContextBudgetSettingsBlock.tsx`
// 是 `"use client"`。这一份没有任何平台依赖，客户端只需要「形状 + 取值范围 + 内建默认」。
//
// 字段与 pi 的对应关系（0.87 `settings-manager.d.ts:4-15`）：
//   CompactionSettings      → enabled / reserveTokens / keepRecentTokens / modelOverrides
//   CompactionModelOverride → { reserveTokens?, keepRecentTokens? }（**不是**「用哪个模型压缩」）
//   BranchSummarySettings   → reserveTokens
// 见 `lib/context-budget-settings.ts` 头部的逐字段 setter 结论。
export interface CompactionModelOverride {
  /** 该模型压缩时给摘要留的额度（缺省 = 跟随 `compaction.reserveTokens`）。 */
  reserveTokens?: number;
  /** 该模型压缩时逐字保留的最近上下文（缺省 = 跟随 `compaction.keepRecentTokens`）。 */
  keepRecentTokens?: number;
}

export interface ContextBudgetSettings {
  /** `settings.compaction.enabled` —— 关掉后 pi 完全不自动压缩。 */
  enabled: boolean;
  /** `settings.compaction.reserveTokens`。 */
  reserveTokens: number;
  /** `settings.compaction.keepRecentTokens`。 */
  keepRecentTokens: number;
  /** `settings.branchSummary.reserveTokens`（会话树跳转时的分支摘要）。 */
  branchSummaryReserveTokens: number;
  /** `settings.compaction.modelOverrides`，键是 `"<provider>/<id>"`。 */
  modelOverrides: Record<string, CompactionModelOverride>;
}

/** `GET/PUT /api/context-budget-settings` 的响应体（缺字段时回落 pi 的内建默认）。 */
export type ContextBudgetSettingsResponse = ContextBudgetSettings;

/**
 * 与 SDK 的内建默认逐值一致：
 *   · `DEFAULT_COMPACTION_TOKEN_SETTINGS`（`settings-manager.js:10-13`）= 16384 / 20000
 *   · `getBranchSummarySettings()` 的 `?? 16384`（`settings-manager.js:599`）
 *   · `getCompactionEnabled()` 的 `?? true`（`settings-manager.js:556`）
 */
export const CONTEXT_BUDGET_DEFAULTS: ContextBudgetSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
  branchSummaryReserveTokens: 16384,
  modelOverrides: {},
};

/**
 * 取值上限。SDK 自己**不校验上界**，只要求「非负安全整数」
 * （`getCompactionTokenSetting`，`settings-manager.js:566-581`），所以上界是我们定的：
 * 1M 已经超过任何真实上下文窗口（Claude 200k / Gemini 1M），再大只可能让每次压缩都立刻
 * 再触发一次压缩。上界同时是「读回来时认不认」的判据 —— 面板显示的永远是能原样写回去的值。
 */
export const CONTEXT_BUDGET_MAX_TOKENS = 1_000_000;

/**
 * 模型覆盖的键必须是 SDK 认的那种引用：`getCompactionTokenSetting` 用
 * `` `${model.provider}/${model.id}` `` 去查表（`settings-manager.js:572`）。
 * 模型 id 本身可以带 `/`（`openrouter/anthropic/claude-…`），所以只要求「第一段非空、
 * 后面至少一段、不含空白」。
 */
export const CONTEXT_BUDGET_MODEL_REF = /^[^\s/]+\/.+$/;
