#!/usr/bin/env node
/**
 * scripts/check-style-literals.mjs
 *
 * fork:design-system（2026-09-28）—— 「设计系统 → 门禁」的第一条。
 *
 * `AGENTS.md` 一直写着「组件里不要再写 hex / 数字圆角」，但**没有任何脚本拦**，
 * 于是每次上游合并都会重新引入一批。这个脚本把它变成退出码。
 *
 * 规则（对应 design/pi-web-design/DESIGN-SPEC.md 的硬约束）：
 *   · 颜色：组件里不写 `#rrggbb` / `rgb()` / `rgba()` —— 一律 `var(--token)`
 *   · 圆角：不写 `borderRadius: <数字>` —— 只允许设计的三档 3 / 4 / 6 与 pill
 *   · 字号：不写 `fontSize: <数字>`（这条已由 lib/typography-usage.test.mjs 守）
 *   · 间距：不写 `padding: "<数字>px ..."` 这类**完整字面量**（单值微调放行）
 *
 * 白名单（写死在脚本里，附理由）：
 *   · components/FileIcons.tsx        —— 品牌文件图标，颜色是品牌色不是主题色
 *   · components/fork/usage-charts.tsx —— 手写 SVG 图表，色阶由数据驱动
 *   · 带 `非主题值` 注释的行           —— 图像处理常量这类确实不该跟主题走的
 *
 * 用法：node scripts/check-style-literals.mjs [文件...]
 * 退出码非 0 = 有违规。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["components", "app"];
const SKIP_DIRS = new Set(["node_modules", ".next", "test-results", "release", "boardui", "design"]);

const WHITELIST_FILES = new Set([
  // 品牌文件图标：颜色是品牌色（蓝文件夹 / 黄 zip），不是主题色，不该跟主题走。
  "components/FileIcons.tsx",
  // 手写 SVG 图表：色阶由数据驱动，不落在语义槽位上。
  "components/fork/usage-charts.tsx",
  // 服务端生成的**独立 HTML 文档**（文件预览 / 导出）：它不加载 app 的 CSS，
  // `var(--x)` 在那里解析为空，只能用字面值。这是唯一合法的字面值出口。
  "app/api/files/[...path]/route.ts",
  // 根布局级错误页：它渲染的场合正是根布局（连同 globals.css）可能没加载的时候，
  // 所以设计也要求它**只用系统色**（Canvas / CanvasText）与字面半径。
  // 见 design/pi-web-design/61-system-states.html。
  "app/global-error.tsx",
  // PWA manifest 与浏览器主题色：值是交给**浏览器**的，不是 CSS，必须是字面值。
  "app/manifest.ts",
  "app/layout.tsx",
]);

/** 允许在组件里出现的「非主题值」标记：行内带这个注释就放行。 */
const NON_THEME_MARKER = "非主题值";

const RULES = [
  {
    id: "color-literal",
    // #abc / #aabbcc / #aabbccdd；排除 URL 片段、i18n 插值、PR 编号、issue 编号
    pattern: /#[0-9a-fA-F]{3,8}\b/,
    skip: (line) =>
      /url\(#|href=|id="|#\{/.test(line) ||
      /PR #|#\d{2,4}\b/.test(line) ||
      /"#[0-9a-fA-F]{3,8}"\s*:/.test(line) && false,
    message: "颜色字面量：改用 var(--token)（design/pi-web-design/assets/tokens.css）",
  },
  {
    id: "color-function",
    pattern: /\brgba?\(/,
    skip: (line) => /color-mix\(/.test(line) || /getComputedStyle/.test(line),
    message: "rgb()/rgba()：改用 var(--token) 或 color-mix()",
  },
  {
    id: "radius-literal",
    pattern: /borderRadius:\s*[0-9]/,
    skip: () => false,
    message: "数字圆角：只允许 var(--radius-xs|sm|lg|pill)（设计三档 3/4/6）",
  },
  {
    id: "font-size-literal",
    pattern: /fontSize:\s*[0-9]/,
    skip: () => false,
    message: "数字字号：改用 TEXT.* / TEXT_PX.*（lib/typography.ts）",
  },
];

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx|mjs)$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

const explicit = process.argv.slice(2);
const files = explicit.length
  ? explicit.map((f) => resolve(f))
  : SCAN_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)));

const violations = [];
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (WHITELIST_FILES.has(rel)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    // 标记可以写在同一行，也可以写在上面几行（理由通常要两三行才说清）。
    const context = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
    if (context.includes(NON_THEME_MARKER)) return;
    // 注释行不算：文档里举例说明是允许的
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;
      if (rule.skip(line)) continue;
      violations.push(`${rel}:${index + 1}  [${rule.id}]  ${line.trim().slice(0, 110)}\n      → ${rule.message}`);
    }
  });
}

if (violations.length) {
  console.error(`✗ 样式字面量门禁：${violations.length} 处违规\n`);
  console.error(violations.join("\n"));
  console.error(`\n规则与白名单见 ${relative(ROOT, fileURLToPath(import.meta.url))} 顶部。`);
  process.exit(1);
}
console.log(`✓ 样式字面量门禁：${files.length} 个文件，0 处违规`);
