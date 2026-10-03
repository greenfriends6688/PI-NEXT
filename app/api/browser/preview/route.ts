import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getAllowedFileRoots } from "@/lib/file-access";
import { hasParentDirectorySegment, isPathWithinRoots } from "@/lib/path-security";
import { isApiRequestAllowed } from "@/lib/request-security";
import { BROWSER_PREVIEW_EXTENSIONS, BROWSER_PREVIEW_ROUTE } from "@/lib/browser-local-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 预览只读不超过这个体积的 HTML；更大的文件用文件查看器，不要拿浏览器硬扛。 */
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

/**
 * fork:proma-42-browser · 受管浏览器的**本地预览**。
 *
 * 存在的理由：`lib/browser-url-policy.ts` 禁止 `file://`，所以「看一眼项目里刚生成的
 * HTML」必须有另一条路，而这条路不能是随手放宽的文件协议。
 *
 * 授权口径与 `/api/files` 完全一致（`getAllowedFileRoots()` + 同样的 `..` 拒绝），
 * 差别只有两处，都是为了让预览**安全地渲染**：
 *   1. 只放 `.html` / `.htm`，且文件必须已存在、是普通文件（不是设备/管道）；
 *   2. 响应带一条严格 CSP —— 预览页里的脚本默认全禁，也不许向外发请求。
 *      本地生成的 HTML 只需要看，不需要跑它自己的 JS；禁掉之后，一次
 *      `<script>` 或一张外链图就不会变成「agent 打开本地文件 = 打开任意站点」。
 */
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  if (url.pathname !== BROWSER_PREVIEW_ROUTE) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const target = url.searchParams.get("path") ?? "";
  if (!target) return NextResponse.json({ error: "path required" }, { status: 400 });
  if (hasParentDirectorySegment(target)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!BROWSER_PREVIEW_EXTENSIONS.includes(path.extname(target).toLowerCase() as (typeof BROWSER_PREVIEW_EXTENSIONS)[number])) {
    return NextResponse.json({ error: "Only HTML previews" }, { status: 415 });
  }

  const roots = await getAllowedFileRoots();
  // 授权实现只有 `lib/path-security.ts` 这一份（`/api/files` 也走它）；这里不重写比较逻辑。
  if (!isPathWithinRoots(target, roots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let stat;
  try {
    stat = statSync(target);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!stat.isFile()) return NextResponse.json({ error: "Not a file" }, { status: 400 });
  if (stat.size > MAX_PREVIEW_BYTES) {
    return NextResponse.json({ error: "Preview too large" }, { status: 413 });
  }

  const stream = createReadStream(target);
  // 预览页只读本地这一份文件：脚本、内联样式引用的外链、连接、frame 全禁。
  const csp = [
    "default-src 'none'",
    "img-src 'self' data:",
    "style-src 'unsafe-inline'",
    "font-src 'self' data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");

  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
    },
  });
}