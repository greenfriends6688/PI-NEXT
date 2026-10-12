#!/usr/bin/env node
/**
 * Runtime components must consume semantic tokens, not the legacy `--n-*`,
 * `--ds-*`, `--radius-*` or size-based `--nx-r-*` aliases.
 *
 * Bridge files are allowed to define aliases during migration:
 *   - app/globals.css
 *   - app/design/tokens.css
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BRIDGES = new Set(["app/globals.css", "app/design/tokens.css"]);
const RUNTIME_DIRS = ["app", "components"];
const EXTRA_FILES = [
  "design/v5/web/system.css",
  "design/v5/pwa/system.css",
];
const RUNTIME_EXT = /\.(css|ts|tsx)$/;
const LEGACY = /var\(--(?:n-|ds-|radius-|nx-r-)[a-z0-9-]+/g;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "release") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (RUNTIME_EXT.test(entry)) files.push(path);
  }
  return files;
}

const violations = [];
const files = [
  ...RUNTIME_DIRS.flatMap((dir) => walk(join(ROOT, dir))),
  ...EXTRA_FILES.map((rel) => join(ROOT, rel)),
];
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (BRIDGES.has(rel)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    LEGACY.lastIndex = 0;
    if (LEGACY.test(line)) violations.push(`${rel}:${index + 1}  ${line.trim().slice(0, 120)}`);
  });
}

if (violations.length) {
  console.error("✗ Token 消费门禁：运行时组件仍直接引用旧 token");
  console.error(violations.join("\n"));
  console.error("\n新代码使用 --nx-* 语义角色；旧别名只在 app/globals.css 与 app/design/tokens.css 中过渡。");
  process.exit(1);
}

console.log("✓ Token 消费门禁：运行时组件只读 --nx-* 语义角色");
