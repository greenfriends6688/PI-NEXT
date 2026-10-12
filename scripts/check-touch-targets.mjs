#!/usr/bin/env node
/**
 * iPhone/PWA direct operations must keep a 44px minimum hit target.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const css = readFileSync(join(ROOT, "design/v5/pwa/system.css"), "utf8");

function block(selector) {
  const match = css.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

const violations = [];
for (const [selector, part] of [
  [".m-top-btn", "size"],
  [".m-cap-btn", "size"],
  [".m-send", "size"],
  [".m-setrow", "height"],
  [".m-trow", "height"],
  [".m-menu-row", "height"],
]) {
  const body = block(selector);
  if (!body) {
    violations.push(`${selector}：缺少定义`);
    continue;
  }
  const ok = part === "size"
    ? /width:\s*var\(--nx-touch-min\)/.test(body) && /height:\s*var\(--nx-touch-min\)/.test(body)
    : /min-height:\s*var\(--nx-touch-min\)/.test(body);
  if (!ok) violations.push(`${selector}：${part} 未达到 --nx-touch-min`);
}

if (violations.length) {
  console.error("✗ PWA 触控门禁：主要操作低于 44px");
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("✓ PWA 触控门禁：主要操作达到 --nx-touch-min");
