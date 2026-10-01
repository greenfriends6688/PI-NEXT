// fork:thinking-level-prefill —— 进新会话时按 per-model 记忆预选推理强度。
/**
 * `lib/thinking-level-memory.ts` + `GET /api/models` 的 `thinkingLevelMemory` 一直都在，
 * 但只在设置页模型详情里显示成「上次使用：high」加一枚清除钮 ——
 * 聊天侧的思考档选择器**不预填**，于是每开一个新会话都要重新选一遍档。
 *
 * 本模块只做**读**：记忆由 `lib/rpc-manager.ts` 在两处写 ——
 * `set_thinking_level`（:1019）与「新会话显式指定档位」（:2447），记的都是
 * **SDK clamp 之后实际生效**的值。所以前端一个字节都不用写，
 * 「每次渲染都写一遍」这条根本不会发生。
 *
 * ## 三个表的 key 形状不一样（真踩过的坑）
 * | 表 | key |
 * |---|---|
 * | `thinkingLevels`（`app/api/models/route.ts:65`） | `provider:modelId`（**冒号**） |
 * | `thinkingLevelPins`（`lib/model-scope.ts:161`） | `provider/modelId`（**斜杠**） |
 * | `thinkingLevelMemory`（`lib/thinking-level-memory.ts:24`） | `provider/modelId`（**斜杠**） |
 *
 * ## 优先级：pin > 记忆 > auto
 * `enabledModels` 的 `provider/*:high` 后缀是配置里**显式写死**的意图，比「上次用了什么」
 * 更强；记忆次之；都没有就不动（`auto` = 不碰 pi 当前的设置）。
 *
 * ## 记忆里那一档已经不被支持了就丢弃
 * 模型升级 / `thinkingLevelMap` 被改之后，记忆里的 `xhigh` 可能已经不在
 * `getSupportedThinkingLevels()` 的列表里。预填一个不存在的档位会让选择器显示成
 * 选中的档却发不出去，所以那种情况按「没有记忆」处理。
 */
import { thinkingLevelMemoryKey } from "./thinking-level-memory";

export type PrefillThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * `pin` = `enabledModels` 里的 `provider/*:high`（服务端建会话时自己解析并应用，前端不重复钉）；
 * `memory` = 我们读出来的 per-model 记忆（**需要**钉住，否则选择器显示的档和真跑的不一样）。
 */
export type PrefillSource = "pin" | "memory";

export interface ThinkingLevelPrefill {
  level: PrefillThinkingLevel;
  source: PrefillSource;
}

const PREFILL_LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function isPrefillLevel(value: unknown): value is PrefillThinkingLevel {
  return typeof value === "string" && PREFILL_LEVELS.includes(value);
}

/** `thinkingLevels` 的 key（冒号）；pin 与记忆都用 `thinkingLevelMemoryKey`（斜杠）。 */
export function thinkingLevelScopeKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

/**
 * 该预填哪一档；`null` = 没有可预填的（调用方保持 `auto`）。
 *
 * 三个表都可以缺（模型刚被删、runtime 读失败、隐私模式下拿不到 localStorage），
 * 缺表一律按「没有」处理，不抛。
 */
export function resolvePrefilledThinkingLevel(input: {
  provider: string;
  modelId: string;
  thinkingLevels?: Record<string, string[]>;
  thinkingLevelPins?: Record<string, string>;
  thinkingLevelMemory?: Record<string, string>;
}): ThinkingLevelPrefill | null {
  const scopeKey = thinkingLevelScopeKey(input.provider, input.modelId);
  const memoryKey = thinkingLevelMemoryKey(input.provider, input.modelId);

  const pinned = input.thinkingLevelPins?.[memoryKey];
  if (isPrefillLevel(pinned)) return { level: pinned, source: "pin" };

  const remembered = input.thinkingLevelMemory?.[memoryKey];
  if (!isPrefillLevel(remembered)) return null;

  // 支持档位表存在且不含记忆值 → 记忆已经过时（模型升级 / thinkingLevelMap 改了）。
  // 表不存在 = 不知道这个模型支持什么，这时候按记忆来，与设置页「上次使用」的显示一致。
  const supported = input.thinkingLevels?.[scopeKey];
  if (supported && !supported.includes(remembered)) return null;
  return { level: remembered, source: "memory" };
}