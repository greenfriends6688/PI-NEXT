import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitStatus } from "@/lib/git-changes";
import { mergeChangeSources, summarizeChanges } from "@/lib/change-sources";
import { toNativePath } from "@/lib/paths";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * fork:proma-39-changes — 改动面板数据接口。
 *
 * POST /api/changes  body: { cwd: string, writtenFiles?: string[] }
 *
 * 三路来源（Git 工作区 / 非 Git 会话写入 / 项目记忆）在这里合并：合并要按
 * `samePath()` 去重，而 `samePath()` 来自 Node 的 `path` 模块，不能进客户端
 * 打包，所以合并放在服务端，面板只渲染结果。
 *
 * 授权与 `/api/files` 同一套：cwd 必须在 allowed roots 内且真实存在；客户端
 * 带上来的会话写入路径也逐条过一遍 `isFilePathAllowed()`，不把授权外的路径
 * 原样回显。`writtenFiles` 上限 2000 条，避免一个失控的会话把请求撑爆。
 */
export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: { cwd?: unknown; writtenFiles?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
    return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
  }

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(cwd);
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const rawWritten = Array.isArray(body.writtenFiles) ? body.writtenFiles : [];
    const writtenFiles = rawWritten
      .slice(0, 2000)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map((value) => toNativePath(value.trim()))
      .filter((value) => isFilePathAllowed(value, allowedRoots))
      .map((filePath) => ({ filePath }));

    const git = await getGitStatus(cwd);
    const changes = mergeChangeSources({ cwd, git, writtenFiles });
    const { additions, deletions } = summarizeChanges(changes);

    return NextResponse.json({
      isGitRepository: git.isGitRepository,
      repositoryRoot: git.repositoryRoot,
      changes,
      additions,
      deletions,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
