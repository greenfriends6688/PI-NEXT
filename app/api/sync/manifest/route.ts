import { NextResponse } from "next/server";
import { statSync } from "fs";

import { listAllSessions } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

/**
 * GET /api/sync/manifest —— 全部会话的同步清单（fork:mobile-shell）。
 *
 * 这就是「扫描关联电脑本地所有对话」：手机镜像库靠它 diff 出「哪些会话是新的、
 * 哪些长高了」。条目含 sizeBytes/mtimeMs 两个版本字段（append-only 文件的
 * (size, mtime) 对就是版本号），增量拉取走 `/api/sync/session/[id]/entries?offset=`，
 * 离线阅读走现成的 `/api/sessions/[id]/export?inline=1`。
 *
 * 鉴权与频控都走 `/api/**` 既有令牌闸门（proxy.ts），本路由不新增鉴权面。
 */
export async function GET() {
  const sessions = await listAllSessions();
  const entries = sessions.map((session) => {
    let sizeBytes = 0;
    let mtimeMs = 0;
    try {
      const stats = statSync(session.path);
      sizeBytes = stats.size;
      mtimeMs = stats.mtimeMs;
    } catch {
      // 列表刚扫到、文件已被删的竞态：给 0/0，客户端会当「没了」处理。
    }
    return {
      id: session.id,
      name: session.name ?? null,
      cwd: session.cwd,
      projectRoot: session.projectRoot ?? session.cwd,
      projectKey: session.projectKey ?? null,
      branch: session.branch ?? null,
      isWorktree: Boolean(session.isWorktree),
      parentSessionId: session.parentSessionId ?? null,
      relationKind: session.relation?.kind ?? null,
      created: session.created,
      modified: session.modified,
      messageCount: session.messageCount,
      sizeBytes,
      mtimeMs,
    };
  });
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    count: entries.length,
    sessions: entries,
  });
}
