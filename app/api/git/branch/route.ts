import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { resolveProject } from "@/lib/worktree";

// fork:ui-ctxbar —— 新会话输入框**上方**的上下文条要显示「当前分支」。
//
// 为什么不复用 /api/git/status：那个接口要跑 `git status` + `git diff --numstat`
// 并按预算读未跟踪文件（为了一行分支名不值得，实测是百毫秒级）。
// `resolveProject()` 只跑一次 `git rev-parse`，且带 60s 缓存 + 过期后台刷新，
// 正好是这个只读展示位需要的成本。
//
// 守卫与 /api/worktrees 完全一致（同一套 allowed-roots 判定），
// 拒绝时前端只是不渲染分支项 —— 不是错误状态。
export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd")?.trim() ?? "";
  if (!cwd) {
    return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots) || !isExistingFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const project = await resolveProject(cwd);
    return NextResponse.json({ branch: project.branch, projectRoot: project.projectRoot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
