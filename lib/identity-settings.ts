/**
 * fork:ai-identity —— 「设置 → AI 身份」的读写（服务端那一半）。
 *
 * 碰 `node:fs` 的只有这个文件；三态归一化在客户端安全的 `lib/identity.ts` 里。
 * 存在本应用自己的偏好文件 `~/.pi/agent/pi-web-preferences.json` 的 `identity` 段，
 * 走唯一写入者 `lib/pi-web-preferences.ts`（同一文件两个写入者会互相抹键）。
 *
 * **不动系统提示词里的身份**：那是 `AGENTS.md` 那一节的职责 —— 改了会影响每个会话的
 * 自我描述。这一节只管「聊天里显示成谁」，纯展示数据、不进 prompt。
 */
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { resolveIdentity, type AgentIdentity } from "./identity";
import { readPiWebPreferences, updatePiWebPreferences } from "./pi-web-preferences";

export function readIdentity(agentDir = getAgentDir()): AgentIdentity {
  return resolveIdentity(readPiWebPreferences(agentDir).identity);
}

/** 整表写入；返回写完之后读回来的值，供 API 回显。空态会把这一键整个删掉。 */
export function writeIdentity(identity: AgentIdentity, agentDir = getAgentDir()): AgentIdentity {
  const next = resolveIdentity(identity);
  const isEmpty = !next.name && !next.avatar && !next.syncWithUserProfile;
  updatePiWebPreferences((current) => {
    const draft = { ...current } as Record<string, unknown>;
    if (isEmpty) delete draft.identity;
    else draft.identity = next;
    return draft as typeof current;
  }, agentDir);
  return readIdentity(agentDir);
}
