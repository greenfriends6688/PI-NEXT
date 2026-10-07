/**
 * fork:memory —— 本应用自己的偏好文件：`~/.pi/agent/pi-web-preferences.json`。
 *
 * 为什么不写进 pi 的 `settings.json`：那个文件是 **pi 自己的 schema**（CLI / 其它运行时也读它），
 * 本应用私有的偏好（例如「记忆扩展在 PI NEXT 里开不开」）放进去会变成「pi 的配置」，
 * 别的运行时会跟着受影响 —— 那正是这次要避开的。
 *
 * 读写只有这一处（原先内联在 `lib/thinking-level-memory.ts` 里）：同一个文件两个写入者
 * 各自读-改-写，就会互相抹掉对方刚写的键。
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { writePrivateFileAtomicSync } from "./atomic-file";
import type { PiWebPreferences } from "./thinking-level-memory-shared";

export function piWebPreferencesPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web-preferences.json");
}

/** 文件不在 / 坏了 / 不是对象 → 空偏好（不抛：它只装偏好，不装真相）。 */
export function readPiWebPreferences(agentDir = getAgentDir()): PiWebPreferences {
  const path = piWebPreferencesPath(agentDir);
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as PiWebPreferences;
  } catch {
    return {};
  }
}

/**
 * 读-改-写（原子写）。`patch` 返回 `null` 表示「不用写」；未知键原样保留 ——
 * 别的模块（现在是推理强度记忆）写的键不能被这里抹掉。
 */
export function updatePiWebPreferences(
  patch: (current: PiWebPreferences) => PiWebPreferences | null,
  agentDir = getAgentDir(),
): PiWebPreferences {
  const current = readPiWebPreferences(agentDir);
  const next = patch(current);
  if (!next) return current;
  const path = piWebPreferencesPath(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  writePrivateFileAtomicSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
