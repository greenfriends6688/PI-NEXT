#!/usr/bin/env node
/**
 * Known modal/popover ancestors must not borrow `backdrop-filter` until all
 * viewport-fixed descendants are portaled. This is deliberately a narrow
 * syntax gate: it blocks the regression that already caused clipped popovers.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FILES = [
  "app/fork-ui.css",
  "app/fork-mac-skeuo.css",
  "app/wallpaper.css",
];
const PROTECTED = [
  ".settings-dialog-surface",
  ".d-modal-box",
  ".config-panel-surface",
  ".context-menu",
  ".d-pop-float",
  ".pw-modal",
];

const violations = [];
for (const rel of FILES) {
  const source = readFileSync(join(ROOT, rel), "utf8");
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rule.exec(source)) !== null) {
    const selector = match[1].replace(/\s+/g, " ").trim();
    const body = match[2];
    if (!/(?:^|\n)\s*(?:-webkit-)?backdrop-filter\s*:/.test(body)) continue;
    const protectedSelector = PROTECTED.find((name) => selector.includes(name));
    if (!protectedSelector) continue;
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${rel}:${line}  ${protectedSelector}  ← ${selector.slice(0, 120)}`);
  }
}

if (violations.length) {
  console.error("✗ 材质边界门禁：弹层定位祖先仍在使用 backdrop-filter");
  console.error(violations.join("\n"));
  console.error("\n浮层必须 portal；暂时无法 portal 的弹层使用不透明 elevated surface。");
  process.exit(1);
}

console.log("✓ 材质边界门禁：已知弹层定位祖先未使用 backdrop-filter");
