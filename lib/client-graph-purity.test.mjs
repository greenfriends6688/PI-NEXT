// fork:client-graph-purity —— 客户端依赖图不许碰到 Node 内置模块或 pi SDK。
//
// 为什么需要这条：这类事故在这个仓库**已经发生过两次**。
//   · 51ebad01：常量/类型没有从服务端模块里拆出来，客户端把 `node:fs` 拖进了依赖图；
//   · 1e4dbac0：`lib/mcp-auth-command.ts`（要 `loadPiSdkInternals()`）被
//     `components/fork/McpConfig.tsx` 直接 import，`npm run build` 报
//     `Module not found: Can't resolve 'fs'`。
// 两次都是「跑一次 build 才发现」，而 build 要几分钟；`npm test` 只要十几秒。
// 这个检查只做一件事：从每个 `"use client"` 文件出发，沿**值导入**走本地模块，
// 一旦走到 Node 内置模块或 `@earendil-works/*` 就失败并打印整条链。
//
// 只跟本地文件（跳过 node_modules）。`import type` / 全 `type` 具名的 import 会被
// 编译器擦除，不算 —— 拆 `-shared` 模块（`lib/*-shared.ts`）正是为了让类型留在客户端
// 而实现留在服务端。

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 客户端源码树：这三处才可能有 `"use client"`。 */
const CLIENT_DIRS = ["components", "app", "hooks"];
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".jsx"];

/**
 * 真正会让浏览器目标解析失败的模块说明符。
 *
 * `node:` 前缀一律算（无歧义）；裸名只列 **Next 没有给浏览器 fallback** 的那些
 * —— `path` / `util` / `stream` / `buffer` / `events` / `url` / `crypto` / `os` …
 * 有 polyfill，仓库里 `lib/paths.ts`（`import { parse } from "path"`）就在客户端图里
 * 且 `npm run build` 是绿的，所以它们不算。这份名单以「build 真的红」为准，
 * 不凭想象扩大。
 */
const UNRESOLVABLE_BUILTINS = new Set([
  "async_hooks", "child_process", "cluster", "dgram", "diagnostics_channel",
  "fs", "http2", "inspector", "module", "net", "perf_hooks", "readline", "repl",
  "tls", "trace_events", "tty", "v8", "vm", "wasi", "worker_threads",
]);

function isImpureSpecifier(spec) {
  if (spec.startsWith("node:")) return true;
  if (spec.startsWith("@earendil-works/")) return true;
  return UNRESOLVABLE_BUILTINS.has(spec);
}

/** 去掉块注释与行注释 —— 否则注释里写一句 `require("fs")` 就会自报假阳性。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

/** 值导入 / 值 re-export 的模块说明符。`import type` 与「全部具名都是 type」不算。 */
export function valueSpecifiers(source) {
  const cleaned = stripComments(source);
  const specs = [];
  const pattern = /(?:^|\n)\s*(import|export)\s+([\s\S]*?)from\s+["']([^"']+)["']/g;
  for (const match of cleaned.matchAll(pattern)) {
    const [, keyword, clause, spec] = match;
    const trimmed = clause.trim();
    if (/^type\b/.test(trimmed)) continue;
    // `import { type A, type B } from "x"` —— 一个值具名都没有
    if (/^\{[\s\S]*\}$/.test(trimmed) && trimmed.slice(1, -1).split(",").every((part) => !part.trim() || /^type\b/.test(part.trim()))) {
      continue;
    }
    // `export * from` / `export { a } from` 都可能是值 re-export，保守算值
    if (keyword === "export" && /^type\b/.test(trimmed)) continue;
    specs.push(spec);
  }
  // `import "x";`（副作用导入）没有 from 子句
  for (const match of cleaned.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) specs.push(match[1]);
  for (const match of cleaned.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) specs.push(match[1]);
  return specs;
}

function resolveLocal(spec, fromFile) {
  const base = spec.startsWith("@/")
    ? join(ROOT, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(fromFile), spec)
      : null;
  if (!base) return null;
  for (const candidate of [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => join(base, `index${ext}`))]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function chainToImpure(entry) {
  const seen = new Set();
  const queue = [[entry]];
  while (queue.length) {
    const chain = queue.shift();
    const file = chain[chain.length - 1];
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const spec of valueSpecifiers(source)) {
      if (isImpureSpecifier(spec)) return [...chain, spec];
      const next = resolveLocal(spec, file);
      if (next && !seen.has(next)) queue.push([...chain, next]);
    }
  }
  return null;
}

test("no client component reaches a Node builtin or the pi SDK", () => {
  const roots = [];
  for (const dir of CLIENT_DIRS) {
    const full = join(ROOT, dir);
    if (existsSync(full)) walk(full, roots);
  }
  const entries = roots.filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")));
  assert.ok(entries.length > 20, `expected to find client components, got ${entries.length}`);

  const failures = [];
  for (const entry of entries) {
    const chain = chainToImpure(entry);
    if (chain) failures.push(chain.map((step) => relative(ROOT, step)).join("\n    → "));
  }
  assert.deepEqual(failures, [], `客户端依赖图里出现了服务端专用模块：\n\n${failures.join("\n\n")}`);
});

test("valueSpecifiers ignores type-only imports and comments", () => {
  assert.deepEqual(valueSpecifiers('import type { A } from "node:fs";'), []);
  assert.deepEqual(valueSpecifiers('import { type A, type B } from "node:fs";'), []);
  assert.deepEqual(valueSpecifiers('import { type A, readFileSync } from "node:fs";'), ["node:fs"]);
  assert.deepEqual(valueSpecifiers('import { readFileSync } from "node:fs";'), ["node:fs"]);
  assert.deepEqual(valueSpecifiers('import "node:fs";'), ["node:fs"]);
  assert.deepEqual(valueSpecifiers('import { join } from "node:path";\nimport { x } from "./x";'), ["node:path", "./x"]);
  // 注释里的 require 不算：本模块头部就写着 `require("fs")`，不剥注释会自报假阳性。
  assert.deepEqual(valueSpecifiers('// require("fs") in prose\nconst x = 1;'), []);
  assert.deepEqual(valueSpecifiers('/* import x from "node:fs" */\nconst x = 1;'), []);
  assert.deepEqual(valueSpecifiers('const u = "https://example.com/a";'), []);
});
