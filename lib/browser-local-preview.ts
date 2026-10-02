/**
 * fork:proma-42-browser · 本地 HTML 预览的**授权**（纯逻辑）。
 *
 * 受管浏览器**禁止 `file://`**（`lib/browser-url-policy.ts`），所以「看一眼项目里刚
 * 生成的 HTML」必须有另一条路。这条路就是本模块：把一个用户/agent 给的路径解析成
 * 应用自己 origin 下的预览地址，只接受**已授权根目录内**的 HTML。
 *
 * 授权口径与 `/api/files` 完全一致（`getAllowedFileRoots()` + `isExistingFilePathAllowed`
 * + `hasParentDirectorySegment`），**不新开一个更松的口子**：
 *   · 会话 cwd / 项目根 / `~/pi-cwd-*` / 独立聊天工作区 / 操作员手动放行的根；
 *   · `..` 分段一律拒（`link/..` 在字典序上等于 root，实际却是链接目标旁边那一格）；
 *   · 只放 `.html` / `.htm` —— 预览是给人看的正文，不是把任意文件读给模型；
 *   · 目录则回落到其中的 `index.html`。
 *
 * 返回的是**站内相对地址**，不是绝对路径：绝对路径不进入模型上下文、不进入 URL，
 * 跨平台路径分隔符也就不用跟 `file://` 的那套麻烦打交道。
 */

import { extname } from "node:path";
import { hasParentDirectorySegment, isExistingPathWithinRoots } from "./path-security";

/** 预览只认这两种扩展名。 */
export const BROWSER_PREVIEW_EXTENSIONS = [".html", ".htm"] as const;

/** 预览路由前缀；`app/api/browser/preview/route.ts` 是它的实现。 */
export const BROWSER_PREVIEW_ROUTE = "/api/browser/preview";

export interface BrowserLocalPreviewTarget {
  /** 站内相对地址（不含 origin），由宿主补上自己的 server origin。 */
  url: string;
  /** 用于 trace / 回执的文件名（**不是**绝对路径）。 */
  fileName: string;
}

export class BrowserLocalPreviewDenied extends Error {
  readonly reason: "empty" | "parent-segment" | "outside-roots" | "not-found" | "not-html";

  constructor(reason: BrowserLocalPreviewDenied["reason"], message: string) {
    super(message);
    this.name = "BrowserLocalPreviewDenied";
    this.reason = reason;
  }
}

/**
 * 路径 → 预览地址。
 *
 * @param relativePath 会话 cwd 起的相对路径，或 roots 内文件的绝对路径。
 * @param roots `getAllowedFileRoots()` 的结果。
 * @param baseDir 会话 cwd（相对路径的基准）。
 * @param exists 由调用方注入（`node:fs` 的 statSync），保持本模块可单测。
 * @param resolvePath 由调用方注入（`node:path` 的 resolve + realpathSync）。
 */
export function resolveBrowserLocalPreview(
  relativePath: string,
  options: {
    roots: Set<string>;
    baseDir: string;
    resolvePath: (base: string, target: string) => string;
    realPath: (target: string) => string;
    exists: (target: string) => boolean;
    isDirectory: (target: string) => boolean;
    isFile: (target: string) => boolean;
  },
): BrowserLocalPreviewTarget {
  const raw = relativePath.trim();
  if (!raw) throw new BrowserLocalPreviewDenied("empty", "本地预览路径不能为空。");
  // 同一个坑 `/api/files` 的注释里写着：`link/..` 字典序上等于 root，实际却打开了
  // 链接目标旁边的文件。先按分段拒掉，再谈 realpath。
  if (hasParentDirectorySegment(raw)) {
    throw new BrowserLocalPreviewDenied("parent-segment", "本地预览路径不能包含 .. 分段。");
  }
  const target = options.realPath(options.resolvePath(options.baseDir, raw));
  if (!options.exists(target)) {
    throw new BrowserLocalPreviewDenied("not-found", "本地预览路径不存在。");
  }
  if (!isReachableByRoots(target, options.roots)) {
    throw new BrowserLocalPreviewDenied("outside-roots", "本地预览路径不在当前会话已授权的项目或附加目录内。");
  }

  let filePath = target;
  if (options.isDirectory(filePath)) {
    const index = ["index.html", "index.htm"]
      .map((name) => options.resolvePath(filePath, name))
      .find((candidate) => options.exists(candidate) && options.isFile(candidate));
    if (!index) {
      throw new BrowserLocalPreviewDenied("not-html", "本地预览目录里没有 index.html 或 index.htm。");
    }
    filePath = options.realPath(index);
    // realpath 可能把 index 带到 roots 之外（目录本身是个软链），所以要复查一次。
    if (!isReachableByRoots(filePath, options.roots)) {
      throw new BrowserLocalPreviewDenied("outside-roots", "本地预览路径不在当前会话已授权的项目或附加目录内。");
    }
  }
  if (!BROWSER_PREVIEW_EXTENSIONS.includes(extname(filePath).toLowerCase() as (typeof BROWSER_PREVIEW_EXTENSIONS)[number])) {
    throw new BrowserLocalPreviewDenied("not-html", `只支持 HTML 本地预览，当前文件是 ${fileNameOf(filePath)}。`);
  }
  return {
    url: `${BROWSER_PREVIEW_ROUTE}?path=${encodeURIComponent(filePath)}`,
    fileName: fileNameOf(filePath),
  };
}

function isReachableByRoots(target: string, roots: Set<string>): boolean {
  // `isExistingPathWithinRoots` 是 /api/files 的授权实现；这里不重写一份。
  return isExistingPathWithinRoots(target, roots);
}

function fileNameOf(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}