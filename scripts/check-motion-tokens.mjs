#!/usr/bin/env node
/**
 * scripts/check-motion-tokens.mjs
 *
 * fork:design-system（2026-09-28）—— 「设计系统 → 门禁」的第二条。
 *
 * 设计把全系统的动效定成**十二个 token**（`design/pi-web-design/assets/tokens.css` §12），
 * 但 CSS 里写 `transition: background 150ms` 是顺手就会犯的错，而且看不出来。
 * 这个脚本扫 `app/*.css`，任何**时长字面量**（`120ms` / `0.15s`）都必须来自 token。
 *
 * 允许：
 *   · `var(--motion-*)` / `var(--ds-motion-*)`
 *   · `0s` / `0ms`（「不动」）
 *   · `animation-duration: 0.01ms`（prefers-reduced-motion 的「瞬间到终态」惯例）
 *   · `linear` 只允许出现在 spinner 与扫掠线上（设计全系统仅此两处）
 *
 * 用法：node scripts/check-motion-tokens.mjs
 * 退出码非 0 = 有违规。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 不含 app/design/tokens.css：那个文件**就是** token 的定义处，值当然是字面量。
const FILES = ["app/globals.css", "app/fork-ui.css", "app/settings.css", "app/wallpaper.css"];

/** 时长字面量：120ms / 0.15s / 1.4s（不含 0s / 0ms）。 */
const DURATION = /(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g;

/** 允许的例外：这些字面量不是「动效时长」。 */
const ALLOWED_LITERAL = new Set(["0ms", "0s", "0.01ms"]);

/** 白名单行：值本身不是主题动效（第三方/规范要求固定值）。 */
const ALLOWED_LINE = [
  /@keyframes/,          // 关键帧里不写时长
  /animation-duration:\s*0\.01ms/,
  /transition-duration:\s*0\.01ms/,
  /scroll-behavior/,
];

const violations = [];
let scanned = 0;

for (const rel of FILES) {
  const path = join(ROOT, rel);
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  scanned += 1;
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;              // 注释
    if (ALLOWED_LINE.some((re) => re.test(line))) return;
    const trimmed = line.trim();
    // 只审「动效相关」的声明行：transition / animation / duration / delay
    if (!/^(transition|animation|animation-duration|animation-delay|transition-duration|transition-delay)/.test(trimmed)
        && !/(transition|animation)[-a-z]*\s*:/.test(trimmed)) return;
    DURATION.lastIndex = 0;
    let match;
    while ((match = DURATION.exec(line)) !== null) {
      const literal = match[0];
      if (ALLOWED_LITERAL.has(literal)) continue;
      // 同一行里有 token 引用时，说明这一行是「token + 补语」，仍然要逐值检查
      violations.push(`${rel}:${index + 1}  ${literal}  ←  ${trimmed.slice(0, 100)}`);
    }
  });
}

// linear 只允许两处：spinner 与侧栏扫掠线（设计 §1.6 的「两处 linear，仅此两处」）。
const LINEAR_ALLOWED = [
  /fork-session-sweep/,
  /pw-sweep/,
  /spinner|spin\b|\.animate-spin/,
  /shimmer/,
];
const linearViolations = [];
for (const rel of FILES) {
  const path = join(ROOT, rel);
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  source.split("\n").forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const trimmed = line.trim();
    // 只审**时序函数位**：`animation:` / `transition:` 简写，或 *-timing-function。
    // `linear-gradient(...)` 与 `linear(...)`（CSS 线性缓动函数）都不是时序函数，必须排除。
    const isTimingSlot =
      /^(transition|animation)(-[a-z]+)?\s*:/.test(trimmed) ||
      /timing-function\s*:/.test(trimmed);
    if (!isTimingSlot) return;
    if (!/(^|[\s,(])linear([\s,;]|$)/.test(line)) return;
    if (LINEAR_ALLOWED.some((re) => re.test(line))) return;
    linearViolations.push(`${rel}:${index + 1}  ${trimmed.slice(0, 100)}`);
  });
}

if (violations.length || linearViolations.length) {
  if (violations.length) {
    console.error(`✗ 动效时长字面量：${violations.length} 处（必须走 var(--motion-*)）\n`);
    console.error(violations.join("\n"));
  }
  if (linearViolations.length) {
    console.error(`\n✗ linear 用在了不允许的地方：${linearViolations.length} 处`);
    console.error("  设计规定全系统只有两处 linear：侧栏扫掠线（1400ms）与 spinner（900ms）。\n");
    console.error(linearViolations.join("\n"));
  }
  process.exit(1);
}
console.log(`✓ 动效 token 门禁：${scanned} 个 CSS 文件，0 处字面量、0 处越界的 linear`);
