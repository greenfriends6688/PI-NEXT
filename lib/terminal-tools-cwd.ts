/**
 * fork:proma-41-terminal — Agent 可见终端的 **cwd 授权**。
 *
 * 端口：Proma `apps/electron/src/main/lib/terminal-agent-policy.ts` 的
 * `resolveAgentTerminalCwd`。差别只有一处：Proma 拿 `agentCwd + allowedRoots` 两个入参，
 * 本仓直接复用现成的授权面 —— `/api/terminal` 用的同一套
 * `getAllowedFileRoots()` + `isExistingFilePathAllowed()`（`lib/file-access.ts` →
 * `lib/path-security.ts`）。这样 agent 开的终端和用户手开的终端**授权面完全一致**，
 * 不必再养一份"agent 专用 roots"。
 *
 * 这条检查**不是 OS sandbox**：拿到交互 shell 的用户本来就拥有本机的文件访问能力。
 * 它拦的是"把授权目录之外的路径当成会话 cwd 传进来"这一类越权（#748 那一类 `..` 变体）。
 */

import { existsSync, realpathSync, statSync } from "fs";
import { resolve } from "path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
import { hasParentDirectorySegment } from "./path-security";

export interface AgentTerminalCwdInput {
  /** 会话自己的 cwd（没有它就没有可授权的基准目录）。 */
  sessionCwd: string | undefined;
  /** 模型传入的 cwd：绝对路径，或相对会话 cwd 的路径。 */
  requested?: string | undefined;
  /** 显式给定的授权面；省略时读 `/api/terminal` 用的那一份全局 roots。 */
  allowedRoots?: Set<string> | undefined;
}

/**
 * 解析 agent 终端的初始 cwd：必须落在**会话已授权目录**之内，返回 realpath。
 *
 * · `..` 分段一律拒（`lib/path-security.ts:hasParentDirectorySegment`）——
 *   `root/link/..` 字典序上等于 `root`，文件系统反过来；
 * · 会话 cwd 本身永远算已授权（Proma 的 `roots = [fallback, ...allowedRoots]`），
 *   子代理只拿到受限 roots 时也能在会话目录里开终端；
 * · 返回 realpath：授权比较与实际 spawn 的 cwd 必须是同一条规范化路径。
 */
export async function resolveAgentTerminalCwd(input: AgentTerminalCwdInput): Promise<string> {
  const sessionCwd = input.sessionCwd?.trim();
  if (!sessionCwd) throw new Error("当前会话没有可用工作目录，无法打开终端");

  const requested = typeof input.requested === "string" && input.requested.trim()
    ? input.requested.trim()
    : ".";
  if (hasParentDirectorySegment(requested)) {
    throw new Error("终端工作目录不能包含 `..` 分段");
  }

  const cwd = resolve(sessionCwd, requested);
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error("终端工作目录不存在或不是目录");
  }

  const authorized = new Set<string>(input.allowedRoots ?? [...(await getAllowedFileRoots())]);
  const realSessionCwd = safeRealpath(sessionCwd);
  if (realSessionCwd) authorized.add(realSessionCwd);

  if (!isExistingFilePathAllowed(cwd, authorized)) {
    throw new Error("终端工作目录不在当前会话已授权的目录范围内");
  }
  return realpathSync(cwd);
}

function safeRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}
