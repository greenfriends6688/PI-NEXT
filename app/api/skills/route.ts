import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { setDisableModelInvocation } from "@/lib/skill-frontmatter";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";

export const dynamic = "force-dynamic";

// GET /api/skills?cwd=<path>
// Uses DefaultResourceLoader (same logic as AgentSession startup) so settings.json
// skill paths, package skills, and .agents/skills directories are all included.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(await loadSkillsWithInstallInfo(cwd));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

async function getSkillEditRoots(): Promise<Set<string>> {
  const allowedRoots = new Set(await getAllowedFileRoots());
  allowedRoots.add(getAgentDir());
  // Globally installed skills live in ~/.agents/skills and are symlinked into
  // the agent's skills dir; isExistingFilePathAllowed resolves the symlink, so
  // the real target sits outside getAgentDir(). Allow the global skills root
  // too (the SDK always treats ~/.agents/skills as trusted).
  const globalSkillsDir = path.join(homedir(), ".agents", "skills");
  if (existsSync(globalSkillsDir)) allowedRoots.add(globalSkillsDir);
  return allowedRoots;
}

/**
 * fork:bulk-routes（上游 `eceac13` #1020 移植）—— 编辑一个 SKILL.md，
 * 或返回「拒绝它的状态码 + 原因」。单条与批量走**同一个**入口，语义不会分叉。
 */
function toggleSkillFile(
  filePath: string,
  disableModelInvocation: boolean,
  allowedRoots: Set<string>,
): { status: number; error: string } | null {
  // 技能就是 SKILL.md / *.md：允许根里还躺着 settings.json、auth.json 与项目的
  // package.json，往这些文件顶上插 frontmatter 会把它们弄坏（上游 #658 的第三条
  // 修的就是这个）。
  if (path.extname(filePath).toLowerCase() !== ".md") return { status: 400, error: "Not a skill file" };
  if (!existsSync(filePath)) return { status: 404, error: "file not found" };
  if (!isExistingFilePathAllowed(filePath, allowedRoots)) {
    return { status: 403, error: "Access denied" };
  }
  const content = readFileSync(filePath, "utf8");
  const updated = setDisableModelInvocation(content, disableModelInvocation);
  // 已经在目标状态的技能保持文件与 mtime 不变（批量时只有真正要改的才写盘）。
  if (updated !== content) writeFileSync(filePath, updated, "utf8");
  return null;
}

/**
 * 批量 `PATCH /api/skills` 的**每一条**结果：`error` 为空即写成功，
 * 有值表示那一条被拒、**保持原状**。上游把这两个类型放在 `lib/api-types.ts`，
 * 那个文件不在本次改动的边界内，所以路由这边自带一份同形定义。
 */
export interface SkillToggleResult {
  filePath: string;
  error?: string;
}

/**
 * fork:bulk-routes（上游 `eceac13` #1020 移植）—— 改一个或一批技能的
 * `disable-model-invocation`。
 *
 * Body 二选一：
 *   · `{ filePath, disableModelInvocation }` —— 单条，回 `{ success: true }`
 *     （与改前逐字节同形，单条调用方不用改）
 *   · `{ filePaths, disableModelInvocation }` —— 批量（技能页的「整组开/关」），
 *     回 `{ results: [{ filePath, error? }] }`
 *
 * 批量逐条编辑、逐条作答：某一条被拒（不在允许根里 / 不是 .md /
 * frontmatter 外科手术失败）不打断其余，最后由调用方如实报出是哪几条。
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as {
      filePath?: string;
      filePaths?: unknown;
      disableModelInvocation: boolean;
    };
    const { filePath, filePaths, disableModelInvocation } = body;

    if (filePaths !== undefined) {
      if (!Array.isArray(filePaths) || !filePaths.every((item) => typeof item === "string" && item)) {
        return NextResponse.json({ error: "filePaths must be a list of paths" }, { status: 400 });
      }
      if (typeof disableModelInvocation !== "boolean") {
        return NextResponse.json({ error: "disableModelInvocation must be a boolean" }, { status: 400 });
      }
      const allowedRoots = await getSkillEditRoots();
      const results: SkillToggleResult[] = [];
      // 去重：同一个路径重复出现只写一次、只答一条。
      for (const target of new Set(filePaths as string[])) {
        try {
          const refused = toggleSkillFile(target, disableModelInvocation, allowedRoots);
          results.push(refused ? { filePath: target, error: refused.error } : { filePath: target });
        } catch (e) {
          results.push({ filePath: target, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return NextResponse.json({ results });
    }

    if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });
    const refused = toggleSkillFile(filePath, disableModelInvocation, await getSkillEditRoots());
    if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
