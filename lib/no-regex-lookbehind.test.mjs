/*
 * fork:safari-16-2 — 客户端源码里不许出现 RegExp lookbehind 的全局守卫。
 *
 * Safari 16.4 以下解析不了 `(?<=` / `(?<!`，而一个解析不了的正则**字面量**不是「这条规则
 * 失效」而是 **SyntaxError：整个 script chunk 都不执行** —— 首页 `/` 在客户端渲染，于是
 * 直接白屏（#753）。上游 f52fd84 的修法分三块：remark-gfm 依赖里的 lookbehind 用 bundler
 * loader 换成运行时 `new RegExp`（见 `gfm-autolink-email-loader.test.mjs`）、`package.json`
 * 的 browserslist 降级让 SWC 处理 `static {}` 块、以及**我们自己的**源码里不许再写
 * lookbehind（已改为 sticky 扫描，见 `lib/markdown.ts` 的 `replaceNotPrecededBy`）。
 *
 * 注释与 loader 自身除外：loader 是构建期跑的 Node 代码，那条 lookbehind 是
 * `String.raw` 里的**字符串**，不会进浏览器 chunk。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const ROOTS = ["app", "components", "hooks", "lib", "utils"];
const SKIP_DIRS = new Set(["node_modules", ".next", "test-results", "release"]);
// 构建期 Node 代码：lookbehind 只以字符串形式存在。
const EXEMPT_FILES = new Set([join("lib", "gfm-autolink-email-loader.cjs")]);

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (!/\.(ts|tsx|mjs|js|cjs)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx|mjs)$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

/** 去掉块注释与行注释，只留真正会被打进 chunk 的代码。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("no RegExp lookbehind in client source (#753)", () => {
  const offenders = ROOTS.flatMap((root) => sourceFiles(root))
    .filter((path) => !EXEMPT_FILES.has(path))
    .flatMap((path) => {
      const source = stripComments(readFileSync(path, "utf8"));
      return [...source.matchAll(/\(\?<[=!]/g)].map((match) => {
        const line = source.slice(0, match.index).split("\n").length;
        return `${relative(".", path)}:${line} ${source.slice(match.index, match.index + 40).split("\n")[0]}`;
      });
    });

  it("finds none", () => {
    assert.deepEqual(offenders, [], `lookbehind 只在 Safari 16.4+ 可解析，会让老 Safari 首页白屏：\n${offenders.join("\n")}`);
  });
});