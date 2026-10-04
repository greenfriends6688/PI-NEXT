/**
 * lib/mcp-bundled-script.ts — fork:simulator-section
 *
 * 把「装本仓自带的 MCP server」这个请求解析成真正的 stdio 定义。
 *
 * 浏览器知道自己要装「仓库里那个 `mcp/ios-simulator.mjs`」，但**不知道**它在磁盘上
 * 的绝对路径 —— 那是服务端的信息，也不该让客户端猜 cwd（会话 cwd 是用户的项目，
 * 不是本仓）。所以 `/api/mcp` 的 `add` 接受一个简写：
 *
 * ```json
 * { "action": "add", "name": "ios-simulator",
 *   "def": { "type": "stdio", "script": "mcp/ios-simulator.mjs" } }
 * ```
 *
 * 解析成 `{ command: <node>, args: [<绝对路径>] }`。用 `process.execPath` 而不是
 * 裸 `"node"`：装完不依赖 PATH 上有没有 node。
 *
 * ## 这是一道可执行任意文件的口子，所以校验给得很死
 *
 * 三道，缺一道就出事：
 *   1. **必须落在仓库根之下** —— 挡 `../../..` 逃逸；
 *   2. **必须落在白名单目录里**（目前只有 `mcp/`）—— 仓库里到处是 `.mjs`
 *      （`scripts/`、`design/`…），放行它们等于把这道口开给整棵树；
 *   3. **必须是真存在的 `.mjs` 文件** —— 挡目录、软链逃逸、以及把任意 json
 *      当脚本执行。
 *
 * 任何一条不满足都回**说明**（400），不是静默拒绝：用户要能看懂为什么没装上。
 */

import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

/** 允许 `script:` 简写指向的目录（相对仓库根）。 */
export const BUNDLED_SCRIPT_ROOTS = ["mcp"] as const;

export type BundledScriptResult =
  | { ok: true; def: { type: "stdio"; command: string; args: string[] } }
  | { ok: false; error: string };

/**
 * @param relPath 浏览器给的仓库内相对路径
 * @param repoRoot 仓库根；默认取进程 cwd（Next server 的 cwd 就是它）
 */
export function resolveBundledScript(relPath: string, repoRoot: string = process.cwd()): BundledScriptResult {
  const trimmed = relPath.trim();
  if (!trimmed) return { ok: false, error: "script must be a repo-relative .mjs path" };
  if (trimmed.includes("\0")) return { ok: false, error: "script path must not contain NUL" };
  // 绝对路径一律拒绝：简写的意义就是「相对仓库」，给绝对路径说明调用方在猜。
  if (isAbsolute(trimmed)) return { ok: false, error: "script must be relative to the repository root" };
  if (!trimmed.endsWith(".mjs")) return { ok: false, error: "script must end with .mjs" };

  const root = realRoot(repoRoot);
  const absolute = resolve(join(root, trimmed));

  // ① 归一化后仍在仓库根之下。用 relative 而不是字符串前缀：`/a/bc` 不该被
  //    `/a/b` 认成子目录（`startsWith` 会误判）。
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, error: "script must stay inside the repository root" };
  }
  // ② 白名单目录
  const topSegment = rel.split("/")[0];
  if (!BUNDLED_SCRIPT_ROOTS.includes(topSegment as (typeof BUNDLED_SCRIPT_ROOTS)[number])) {
    return { ok: false, error: `script must live under ${BUNDLED_SCRIPT_ROOTS.join("/")}/` };
  }
  // ③ 必须是真文件。realpath 再查一次：软链能把一个仓库内的 .mjs 指向仓库外的可执行文件。
  if (!existsSync(absolute)) return { ok: false, error: `script not found: ${rel}` };
  let real: string;
  try {
    real = realpathSync(absolute);
  } catch {
    return { ok: false, error: `script is not readable: ${rel}` };
  }
  if (!isInsideRoot(real, root)) {
    return { ok: false, error: "script resolves outside the repository root" };
  }

  return { ok: true, def: { type: "stdio", command: process.execPath, args: [absolute] } };
}

function isInsideRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * 根路径也要过 realpath。
 *
 * macOS 上 tmpdir（以及很多工具给的路径）是 `/var/folders/...`，而 `realpathSync`
 * 返回 `/private/var/folders/...`。拿「realpath 的候选」去比「没 realpath 的根」
 * 会判定成**永远在外面** —— 本机测试里 tmpdir 恰好命中，于是每一个正常请求都被
 * 当成逃逸而拒掉。两边统一之后比较才有意义。
 */
function realRoot(repoRoot: string): string {
  try {
    return realpathSync(resolve(repoRoot));
  } catch {
    return resolve(repoRoot);
  }
}