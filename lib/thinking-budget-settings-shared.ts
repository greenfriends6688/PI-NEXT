// fork:pr12-a6-thinking-budget —— `lib/thinking-budget-settings.ts` 的**纯常量 / 类型**部分。
//
// 与 `lib/retry-settings-shared.ts` / `lib/context-budget-settings-shared.ts` 同一个理由拆法：
// 服务端那份读写真实文件（`node:fs` / `proper-lockfile`），面板组件是 `"use client"`。
// 这一份没有平台依赖，客户端只需要「形状 + 取值范围 + 内建默认」。
//
// 字段：pi 的 `settings.thinkingBudgets.{minimal,low,medium,high}`
// （`settings-manager.d.ts:50-53`、`:115`），消费者在 pi-ai：
// `thinkingBudgetForLevel(level, customBudgets)`（`simple-options.js:47-51`）。
export type ThinkingBudgetLevel = "minimal" | "low" | "medium" | "high";

/** 面板暴露的四档，顺序就是思考强度从低到高。 */
export const THINKING_BUDGET_LEVELS: readonly ThinkingBudgetLevel[] = ["minimal", "low", "medium", "high"];

export type ThinkingBudgetSettings = Record<ThinkingBudgetLevel, number>;

/** `GET/PUT /api/thinking-budget-settings` 的响应体（缺字段时回落 pi-ai 的内建默认）。 */
export type ThinkingBudgetSettingsResponse = ThinkingBudgetSettings;

/**
 * 与 `DEFAULT_THINKING_BUDGETS` 逐值一致（pi-ai `dist/api/simple-options.js:37-42`）。
 *
 * 思考强度还有 `off` / `xhigh` / `max` 三档，但 `thinkingBudgets` 只有这四个键：
 * `off` 不发思考参数（没有预算可言），`xhigh` / `max` 被 `clampReasoning` 折回 `high`
 * （`simple-options.js:43-46`），所以它们共用 high 这一档的预算。
 */
export const THINKING_BUDGET_DEFAULTS: ThinkingBudgetSettings = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
};

/**
 * 取值上限（我们自己定的，SDK 不校验上界，只要求是正整数）。
 * `adjustMaxTokensForThinking` 之后还会按模型的 `maxTokens` 夹一次，并且无论如何给答案留
 * `MIN_ANSWER_TOKENS`（1024，pi-ai `simple-options.js:36`）—— 上界只是「别把预算填到
 * 一亿」这一层的第一道闸。
 */
export const THINKING_BUDGET_MAX_TOKENS = 1_000_000;
