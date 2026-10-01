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
 *   · 间距/尺寸：内联样式里不写 `padding|margin|gap|width|height|top|left...: <数字>`
 *     （fork:gate-inline-geometry，2026-09-30 加；0 与 var()/calc()/% 放行）
 *
 * 存量基线（fork:gate-inline-geometry）：
 *   规则加进来时树里已有 300+ 处历史内联几何，一次清完不现实。于是把
 *   **当前**的数量按「文件::规则」冻结在 `scripts/style-literal-baseline.json`：
 *     实际 > 基线 → 失败（新增违规）；实际 < 基线 → 提示可收窄，不失败。
 *   基线只许变少：`node scripts/check-style-literals.mjs --update` 重写基线，
 *   只在真正清理了存量以后跑，别拿它当放行按钮（CI 不跑 --update）。
 *
 * 白名单（写死在脚本里，附理由）：
 *   · components/FileIcons.tsx        —— 品牌文件图标，颜色是品牌色不是主题色
 *   · components/fork/usage-charts.tsx —— 手写 SVG 图表，色阶由数据驱动
 *   · 带 `非主题值` 注释的行           —— 图像处理常量这类确实不该跟主题走的
 *
 * 用法：node scripts/check-style-literals.mjs [文件...]
 * 退出码非 0 = 有违规。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

/** 存量基线：「文件::规则」→ 处数。见文件头「存量基线」。 */
const BASELINE_PATH = join(ROOT, "scripts/style-literal-baseline.json");

/** 几何槽位名：内联样式里出现这些键 + 写死的数字 = 位置漂移的来源。 */
const GEOMETRY_KEYS =
  "(?:padding|margin|gap|rowGap|columnGap|width|height|minWidth|maxWidth|minHeight|maxHeight|top|right|bottom|left|flexBasis|inset)";

const RULES = [  {
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
    // fork:gate-url-encoded-hex（2026-09-30）—— 上一条规则看不到 data-URI 里的颜色：
    // SVG 内联成 `url("data:image/svg+xml,...")` 时 `#` 必须写成 `%23`，
    // 于是 `%23rrggbb` 从颜色规则里整整齐齐地漏过去。
    // 实测漏出去的就是 `.fork-settings-select` 的箭头色 `%23888b91`（已随死代码删除）。
    id: "color-literal-encoded",
    pattern: /%23[0-9a-fA-F]{3,8}\b/,
    skip: () => false,
    message: "URL 编码的颜色字面量（%23rrggbb）：data-URI 里同样不许写颜色，改用 currentColor 或拆掉内联 SVG",
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
  {
    // fork:gate-inline-geometry（2026-09-30）—— 「按钮/位置与设计稿不一样」的根因。
    // 前四条只看颜色/圆角/字号，间距与尺寸整块放行：`gap: 2`、`width: 32`、
    // `marginBottom: 20`、`paddingLeft: "36px"` 全部合法通过，于是位置的真实来源
    // 散在组件里，既不是 token 也不来自 board.css（审计实测 71 文件 1595 处内联）。
    //
    // 判据：内联样式对象里的**单值数字**。放行 0、`var()`、`calc()`、百分比、
    // 相对单位（vw/ch/fr）与 JS 变量——只拦「写死的像素几何」。
    // 确属非主题值（canvas 尺寸、图像常量）在上一行加「非主题值」。
    // fork:board-diff（2026-10-01）—— 单位组只留 px / pt：**em / rem 是相对单位**，
    // `minHeight: "1.5em"`（MessageView.tsx）这类写法跟着根字号走，不是写死的几何，
    // 之前被当成本地像素几何收进了基线，永远消不掉（audit-2026-10-01 指出）。
    id: "inline-geometry-literal",
    pattern: new RegExp(
      `(?:^|[\\s,{(])${GEOMETRY_KEYS}(?:Top|Right|Bottom|Left|Block|Inline|Start|End)?\\s*:\\s*"?\\s*(\\d+(?:\\.\\d+)?)(px|pt)?\\s*"?\\s*(?=[,}\\n])`,
    ),
    skip: (_line, match) => Number(match[1]) === 0,
    message:
      "内联尺寸/间距字面量：间距与控件高度取 var(--token)，控件几何抄 board.css 的 .pw-* 类；"
      + "确属非主题值在上一行写「非主题值」",
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

const argv = process.argv.slice(2);
const UPDATE = argv.includes("--update");
const explicit = argv.filter((a) => !a.startsWith("--"));
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
      const match = rule.pattern.exec(line);
      if (!match) continue;
      if (rule.skip(line, match)) continue;
      violations.push({
        key: `${rel}::${rule.id}`,
        text: `${rel}:${index + 1}  [${rule.id}]  ${line.trim().slice(0, 110)}\n      → ${rule.message}`,
      });
    }
  });
}

/* ---- 与存量基线结算 ---------------------------------------------------- */
const counts = {};
const byKey = new Map();
for (const v of violations) {
  counts[v.key] = (counts[v.key] ?? 0) + 1;
  byKey.set(v.key, [...(byKey.get(v.key) ?? []), v.text]);
}

if (UPDATE) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({
      __comment:
        "内联样式字面量的存量基线（文件::规则 → 处数）。只许变少：新增会失败，清理后跑 "
        + "`node scripts/check-style-literals.mjs --update` 收窄。CI 不跑 --update。",
      counts: sorted,
    }, null, 2)}\n`,
  );
  console.log(`✓ 已更新基线：${Object.keys(sorted).length} 个键，${violations.length} 处存量`);
  process.exit(0);
}

let baseline = { counts: {} };
if (existsSync(BASELINE_PATH)) {
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (error) {
    console.error(`✗ 基线文件读不懂：${BASELINE_PATH}\n  ${error.message}`);
    process.exit(2);
  }
}
const baselineCounts = baseline.counts ?? {};

const fresh = Object.entries(counts).filter(([key, n]) => n > (baselineCounts[key] ?? 0));
const stale = Object.entries(baselineCounts).filter(([key, n]) => (counts[key] ?? 0) < n);

if (fresh.length) {
  const lines = fresh.flatMap(([key, n]) => [
    `${key}：${baselineCounts[key] ?? 0} → ${n}（+${n - (baselineCounts[key] ?? 0)}）`,
    ...byKey.get(key).slice(0, 12),
    ...(byKey.get(key).length > 12 ? [`      … 另有 ${byKey.get(key).length - 12} 处`] : []),
  ]);
  console.error(`✗ 样式字面量门禁：${fresh.length} 个键超出基线\n`);
  console.error(lines.join("\n"));
  console.error(`\n规则与白名单见 ${relative(ROOT, fileURLToPath(import.meta.url))} 顶部；基线见 scripts/style-literal-baseline.json。`);
  process.exit(1);
}

if (stale.length && !explicit.length) {
  console.log(
    `注：${stale.length} 个基线键已可下调，跑 --update 收窄：\n  `
    + stale.map(([key, n]) => `${key} ${n} → ${counts[key] ?? 0}`).join("\n  "),
  );
}

console.log(
  `✓ 样式字面量门禁：${files.length} 个文件，0 处新增（存量 ${violations.length} 处已登记在基线）`,
);
