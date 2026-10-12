/**
 * fork:upstream-0.12-sidebar-parity —— 删除会话文件：DELETE /api/sessions/[id]（行内
 * 删除）与 POST /api/sessions/delete（项目分组的「删除全部会话」）（#1182）。
 *
 * 每个具名会话连同它下面每个子代理会话（已落盘或活着的）一起删。留下的会话若其 header
 * 把被删的会话当作 parent，就重新指向仍在的最近祖先（`parentSession` 只是展示元数据，
 * 改写安全）。打开的 wrapper 在文件之前关掉，子代理先于父会话；然后忘掉每个被删 id 的
 * 置顶与归档时间。
 *
 * 一次调用列一遍目录、每个文件夹只读一次，不管删多少个会话：项目里几百个会话一个请求
 * 删一个会把该文件夹的每个文件读几百遍。
 *
 * 与上游的差异：本仓的置顶/归档仍在浏览器 localStorage（服务端状态化是后续 PR），所以
 * 这里没有 `forgetSessionUiState` —— 客户端在列表里看不到该会话时会自行剪掉标记。
 */

import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { abortSubagent, getRpcSession, getRpcSessionInfos, getRunningRpcSessionIds } from "./rpc-manager";
import {
  invalidateSessionListCache,
  invalidateSessionManagerCache,
  invalidateSessionPathCache,
  listAllSessions,
  mergeSessionLists,
  readSessionHeader,
  resolveSessionPath,
} from "./session-reader";
import { sessionPathKey } from "./session-path";
import { readSubagentRun, SUBAGENT_META_TYPE } from "./subagents";
import type { SessionEntry } from "./types";

/** POST /api/sessions/delete 一次最多接多少个 id；侧栏把更大的项目分批发。 */
export const MAX_SESSION_DELETE_IDS = 500;

export interface SessionDeleteResult {
  /** 每个被移除的会话：具名的以及它们下面的子代理会话。 */
  deleted: string[];
  /** 既无文件也无缓存路径的具名 id。 */
  missing: string[];
  /** 因其中有会话在跑而被保留的具名 id（仅 `keepRunning`）。 */
  running: string[];
}

function addChild(childrenByParent: Map<string, string[]>, parentId: string, childId: string): void {
  const children = childrenByParent.get(parentId) ?? [];
  children.push(childId);
  childrenByParent.set(parentId, children);
}

/**
 * 删除 `ids` 及其子代理会话。带 `keepRunning` 时，若某个具名会话（或其下某个子代理）
 * 正在跑就整个留着：用户刚刚确认的批量删除不该停掉一个之后才开始的运行。
 */
export async function deleteSessions(
  ids: readonly string[],
  options: { keepRunning?: boolean } = {},
): Promise<SessionDeleteResult> {
  const targets = new Map<string, string>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const filePath = await resolveSessionPath(id);
    if (filePath) targets.set(id, filePath);
    else missing.push(id);
  }
  if (targets.size === 0) return { deleted: [], missing, running: [] };

  // Read only the bounded headers before deleting.
  const parentPathByKey = new Map<string, string | undefined>();
  for (const filePath of targets.values()) {
    let parentSessionPath: string | undefined;
    try {
      parentSessionPath = readSessionHeader(filePath)?.parentSession;
    } catch (error) {
      // Empty runtime sessions have a cached path before their first disk write.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    parentPathByKey.set(sessionPathKey(filePath), parentSessionPath);
  }

  const targetPathKeys = new Set([...targets.values()].map((path) => sessionPathKey(path)));
  const targetDirs = new Set([...targets.values()].map((path) => dirname(path)));
  // Deleting a session also deletes every persisted or live subagent below it.
  const sessions = mergeSessionLists(
    await listAllSessions({ force: true }),
    getRpcSessionInfos({ includeTransient: true }),
  );
  const childrenByParent = new Map<string, string[]>();
  for (const session of sessions) {
    if (session.relation?.kind === "subagent") addChild(childrenByParent, session.relation.parentSessionId, session.id);
  }
  const sessionPaths = new Map(sessions.map((session) => [session.id, session.path]));
  // Include local files even when the global catalogue is stale or incomplete.
  for (const dir of targetDirs) {
    try {
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".jsonl"))) {
        const childPath = join(dir, file);
        if (targetPathKeys.has(sessionPathKey(childPath))) continue;
        try {
          const lines = readFileSync(childPath, "utf8").split("\n");
          const header = JSON.parse(lines[0]) as { type?: string; id?: string };
          if (header.type !== "session" || typeof header.id !== "string") continue;
          const entries = lines.slice(1).flatMap((line) => {
            try { return [JSON.parse(line) as SessionEntry]; } catch { return []; }
          });
          const subagent = readSubagentRun(entries, header.id, childPath);
          if (!subagent) continue;
          addChild(childrenByParent, subagent.parentSessionId, header.id);
          sessionPaths.set(header.id, childPath);
        } catch { /* skip malformed or concurrently removed sessions */ }
      }
    } catch { /* skip if dir unreadable */ }
  }

  // Each named session with the subagents below it, children before their
  // parent: wrappers are shut down in this order.
  const runningIds = options.keepRunning ? new Set(getRunningRpcSessionIds()) : new Set<string>();
  const deletedSessionIds = new Set<string>();
  const running: string[] = [];
  for (const id of targets.keys()) {
    if (deletedSessionIds.has(id)) continue;
    const family: string[] = [];
    const seen = new Set<string>();
    const visit = (sessionId: string) => {
      if (seen.has(sessionId) || deletedSessionIds.has(sessionId)) return;
      seen.add(sessionId);
      for (const childId of childrenByParent.get(sessionId) ?? []) visit(childId);
      family.push(sessionId);
    };
    visit(id);
    if (family.some((sessionId) => runningIds.has(sessionId))) {
      running.push(id);
      continue;
    }
    for (const sessionId of family) deletedSessionIds.add(sessionId);
  }

  const deletedPaths = new Map<string, string>();
  for (const deletedId of deletedSessionIds) {
    const sessionPath = targets.get(deletedId) ?? sessionPaths.get(deletedId) ?? getRpcSession(deletedId)?.sessionFile
      ?? await resolveSessionPath(deletedId);
    if (sessionPath) deletedPaths.set(deletedId, sessionPath);
  }
  const deletedPathKeys = new Map([...deletedPaths.values()].map((path) => [sessionPathKey(path), path]));

  // A session left behind whose parent goes is re-attached to the nearest
  // ancestor that stays (cascade re-parent).
  const survivingParent = (parentSessionPath: string | undefined): string | undefined => {
    const seen = new Set<string>();
    let current = parentSessionPath;
    while (current) {
      const key = sessionPathKey(current);
      const deletedPath = deletedPathKeys.get(key);
      if (deletedPath === undefined) return current;
      if (seen.has(key)) return undefined;
      seen.add(key);
      if (!parentPathByKey.has(key)) {
        let parent: string | undefined;
        // A subagent's file may be gone already; it then re-attaches nothing.
        try { parent = readSessionHeader(deletedPath)?.parentSession; } catch { parent = undefined; }
        parentPathByKey.set(key, parent);
      }
      current = parentPathByKey.get(key);
    }
    return undefined;
  };
  if (deletedPaths.size > 0) {
    const scanDirs = new Set([...deletedPaths.values()].map((path) => dirname(path)));
    for (const dir of scanDirs) {
      try {
        const files = readdirSync(dir).filter(
          (file) => file.endsWith(".jsonl") && !deletedPathKeys.has(sessionPathKey(join(dir, file))),
        );
        for (const file of files) {
          const childPath = join(dir, file);
          try {
            // The bounded header says whether it needs a rewrite at all.
            const childParent = readSessionHeader(childPath)?.parentSession;
            if (!childParent || !deletedPathKeys.has(sessionPathKey(childParent))) continue;
            const parentSessionPath = survivingParent(childParent);
            let parentSessionId: string | undefined;
            if (parentSessionPath) {
              try {
                // The parent may have been deleted or moved already; treat it as absent.
                parentSessionId = readSessionHeader(parentSessionPath)?.id;
              } catch {
                parentSessionId = undefined;
              }
            }
            const lines = readFileSync(childPath, "utf8").split("\n");
            const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
            if (header.type !== "session") continue;
            // Rewrite header with new parentSession
            header.parentSession = parentSessionPath;
            lines[0] = JSON.stringify(header);
            if (parentSessionPath && parentSessionId) {
              for (let index = 1; index < lines.length; index += 1) {
                let entry: { type?: string; customType?: string; data?: unknown };
                try {
                  entry = JSON.parse(lines[index]);
                } catch {
                  continue;
                }
                if (
                  entry.type !== "custom"
                  || entry.customType !== SUBAGENT_META_TYPE
                  || typeof entry.data !== "object"
                  || entry.data === null
                  || Array.isArray(entry.data)
                ) continue;
                entry.data = {
                  ...entry.data,
                  parentSessionId,
                  parentSessionPath,
                };
                lines[index] = JSON.stringify(entry);
                break;
              }
            }
            writeFileSync(childPath, lines.join("\n"));
          } catch { /* skip malformed */ }
        }
      } catch { /* skip if dir unreadable */ }
    }
  }

  for (const deletedId of deletedSessionIds) {
    try { await abortSubagent(deletedId); } catch { /* ordinary session, idle or completed */ }
    await getRpcSession(deletedId)?.shutdown();
  }
  for (const [deletedId, deletedPath] of deletedPaths) {
    try {
      unlinkSync(deletedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    invalidateSessionPathCache(deletedId);
    invalidateSessionManagerCache(deletedPath);
  }
  invalidateSessionListCache();
  return { deleted: [...deletedSessionIds], missing, running };
}
