/**
 * fork:feature-toggles —— 「设置 → 界面与功能」的读写（服务端那一半）。
 *
 * 碰 `node:fs` 的只有这个文件；开关表与归一化在客户端安全的
 * `lib/feature-toggles.ts` 里（设置页要直接用）。
 *
 * 存在本应用自己的偏好文件 `~/.pi/agent/pi-web-preferences.json` 的 `features` 段，
 * 走**唯一写入者** `lib/pi-web-preferences.ts` —— 同一个文件两个写入者各自读-改-写
 * 会互相抹键，这是 `lib/pi-web-preferences.ts` 头注写明的教训。
 */
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import {
  featureOverrides,
  resolveFeatureFlags,
  type FeatureFlags,
  type FeatureId,
} from "./feature-toggles";
import { readPiWebPreferences, updatePiWebPreferences } from "./pi-web-preferences";

/** 当前开关表（含默认值补齐）。 */
export function readFeatureFlags(agentDir = getAgentDir()): FeatureFlags {
  return resolveFeatureFlags(readPiWebPreferences(agentDir).features);
}

/** 单个开关 —— 工具注册点与请求处理里用它，不必先摊开整张表。 */
export function isFeatureOn(id: FeatureId, agentDir = getAgentDir()): boolean {
  return readFeatureFlags(agentDir)[id];
}

/** 整表写入（只落差异）。返回写完之后读回来的值，供 API 回显。 */
export function writeFeatureFlags(flags: FeatureFlags, agentDir = getAgentDir()): FeatureFlags {
  const overrides = featureOverrides(flags);
  updatePiWebPreferences((current) => {
    const next = { ...current } as Record<string, unknown>;
    if (Object.keys(overrides).length === 0) delete next.features;
    else next.features = overrides;
    return next as typeof current;
  }, agentDir);
  return readFeatureFlags(agentDir);
}

/** `PUT /api/features` 的入参：`{ id, enabled }`，只改一个开关。 */
export function setFeatureFlag(id: FeatureId, enabled: boolean, agentDir = getAgentDir()): FeatureFlags {
  const flags = readFeatureFlags(agentDir);
  flags[id] = enabled;
  return writeFeatureFlags(flags, agentDir);
}
