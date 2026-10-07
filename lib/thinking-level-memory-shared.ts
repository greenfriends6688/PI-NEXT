// fork:pwa-build-2026-10-01 —— `lib/thinking-level-memory.ts` 的**纯 key 约定**。
//
// 与 `lib/retry-settings-shared.ts` 同一个理由：`lib/thinking-level-memory.ts`
// 读写真实文件（`fs` / `path` / pi 的 `getAgentDir`），只能在服务端跑；而
// `hooks/useAgentSession.ts` 是客户端 hook，它要的 `resolvePrefilledThinkingLevel`
// （`lib/thinking-level-prefill.ts`）本身是**纯函数**，只差一个 key 构造函数就被
// 拖进了浏览器依赖图，webpack 报 `Can't resolve 'fs'`，prod 构建整条挂掉。
//
// 所以 key 约定单独放一份，两边都从这儿取，`thinkingLevelMemoryKey` 的语义
// （`provider/modelId`，斜杠形式）仍只有这一处定义。
export interface PiWebPreferences {
  thinkingLevelMemory?: Record<string, string>;
  /** fork:memory —— 「设置 → 记忆」里那个开关（**只影响 PI NEXT**，不动 pi 的 packages）。 */
  memoryExtensionEnabled?: boolean;
  /** fork:websearch —— 「设置 → 联网搜索」的配置（形状由 `lib/websearch-settings.ts` 归一化）。 */
  webSearch?: unknown;
}

/** per-model 记忆的 key 约定：`provider/modelId`（斜杠形式）。 */
export function thinkingLevelMemoryKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}