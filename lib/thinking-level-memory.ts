/**
 * 服务端 per-model 推理强度记忆。
 *
 * 独立存储于 `~/.pi/agent/pi-web-preferences.json`（读写收敛在 `lib/pi-web-preferences.ts`），
 * 不动 pi CLI 的 settings.json schema（SDK 可能重写 settings.json）。
 * 只记录**实际生效**的等级（SDK clamp 后），key 为 `${provider}/${modelId}`（斜杠，不是冒号）。
 *
 * 前端接线：
 * - `GET /api/models` 响应新增 `thinkingLevelMemory: Record<"provider/modelId", level>`；
 * - `DELETE /api/thinking-level-memory`（body `{ modelKey }`）清除某模型的记忆。
 */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readPiWebPreferences, updatePiWebPreferences } from "./pi-web-preferences";

const MEMORY_KEY = "thinkingLevelMemory";

// fork:pwa-build-2026-10-01 —— 类型与 key 构造函数搬去 `thinking-level-memory-shared.ts`：
// 本模块带 `fs`，客户端（useAgentSession → thinking-level-prefill）只想要纯 key，
// 挂在同一个模块里会被 webpack 拖进浏览器依赖图（`Can't resolve 'fs'`）。
export type { PiWebPreferences } from "./thinking-level-memory-shared";
export { thinkingLevelMemoryKey } from "./thinking-level-memory-shared";
import type { PiWebPreferences } from "./thinking-level-memory-shared";
import { thinkingLevelMemoryKey } from "./thinking-level-memory-shared";

/** 读全部 per-model 记忆（`provider/modelId` → 等级）。 */
export function getThinkingLevelMemory(agentDir = getAgentDir()): Record<string, string> {
  return readPiWebPreferences(agentDir)[MEMORY_KEY] ?? {};
}

/** 记录某模型实际生效的推理强度（原子写）。 */
export function rememberThinkingLevel(modelKey: string, level: string, agentDir = getAgentDir()): void {
  updatePiWebPreferences((preferences: PiWebPreferences) => {
    const memory = { ...(preferences[MEMORY_KEY] ?? {}) };
    memory[modelKey] = level;
    return { ...preferences, [MEMORY_KEY]: memory };
  }, agentDir);
}

/** 清除某模型的记忆（不存在则不变）。 */
export function forgetThinkingLevel(modelKey: string, agentDir = getAgentDir()): void {
  updatePiWebPreferences((preferences: PiWebPreferences) => {
    const memory = { ...(preferences[MEMORY_KEY] ?? {}) };
    if (!(modelKey in memory)) return null;
    delete memory[modelKey];
    if (Object.keys(memory).length === 0) {
      const rest = { ...preferences };
      delete rest[MEMORY_KEY];
      return rest;
    }
    return { ...preferences, [MEMORY_KEY]: memory };
  }, agentDir);
}
