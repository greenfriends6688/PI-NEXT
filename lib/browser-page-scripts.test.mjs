import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  assertBrowserExtract,
  assertBrowserSelector,
  buildBrowserExtractExpression,
  buildBrowserInspectExpression,
  buildBrowserReadyExpression,
  serializeBrowserPayload,
} = await jiti.import("./browser-page-scripts.ts");
const { MAX_BROWSER_SELECTOR_CHARS } = await jiti.import("./browser-capacity.ts");

test("序列化把能提前闭合脚本块的东西全转义掉", () => {
  const serialized = serializeBrowserPayload({ selector: "</script><!--<img src=x" });
  assert.equal(serialized.includes("</script>"), false);
  assert.equal(serialized.includes("<"), false);
  // U+2028 / U+2029 在 JSON 字面量里是行终止符，必须转义。
  const separator = serializeBrowserPayload({ s: "\u2028\u2029" });
  assert.equal(separator.includes("\u2028"), false);
  assert.equal(separator.includes("\u2029"), false);
});

test("selector 只作为 JSON 字面量出现，不可能落进可执行位置", () => {
  const hostile = `a"]);globalThis.pwned=1;document.querySelector("#`;
  const expression = buildBrowserExtractExpression({ format: "text", selector: hostile });
  assert.equal(expression.includes("globalThis.pwned=1"), true, "原串会在 JSON 里，但只是字符串内容");
  // 关键：它出现在 JSON 字面量内部，前后都有引号，不会闭合脚本。
  const payload = serializeBrowserPayload({ format: "text", selector: hostile });
  assert.ok(expression.includes(payload));
  assert.equal(expression.includes(`; ${hostile}`), false);
});

test("表达式里没有任何来自调用方的裸代码（eval / Function / fetch / window）", () => {
  for (const expression of [
    buildBrowserExtractExpression({ format: "markdown", selector: "#main" }),
    buildBrowserInspectExpression("#main"),
    buildBrowserReadyExpression(),
  ]) {
    assert.equal(/\beval\s*\(/.test(expression), false);
    assert.equal(/\bnew\s+Function\s*\(/.test(expression), false);
    assert.equal(/\bfetch\s*\(/.test(expression), false);
    assert.equal(/\bimport\s*\(/.test(expression), false);
  }
});

test("抽取表达式固定跳过 script / style / 模板与 aria-hidden 子树", () => {
  const expression = buildBrowserExtractExpression({ format: "markdown" });
  for (const tag of ["'script'", "'style'", "'noscript'", "'template'", "'svg'"]) {
    assert.ok(expression.includes(tag), tag);
  }
  assert.ok(expression.includes("aria-hidden"));
});

test("链接只保留 http(s)，页面给的 javascript:/data: 链接不会变成可点目标", () => {
  const expression = buildBrowserExtractExpression({ format: "markdown" });
  assert.ok(expression.includes("url.protocol === 'http:' || url.protocol === 'https:'"));
});

test("抽取的工作量有界：节点数 / 深度 / 字符三条都设了闸", () => {
  const expression = buildBrowserExtractExpression({ format: "markdown" });
  assert.ok(expression.includes("maxNodes = 10000"));
  assert.ok(expression.includes("maxDepth = 64"));
  assert.ok(expression.includes("workCharLimit"));
});

test("selector 与 maxChars 的边界在生成前就被拦下", () => {
  // 可选 selector 传空串等于「不给」，不是错误；必填时才拒。
  assert.equal(assertBrowserSelector(""), undefined);
  assert.throws(() => assertBrowserSelector("", true));
  assert.throws(() => assertBrowserSelector("a".repeat(MAX_BROWSER_SELECTOR_CHARS + 1)));
  assert.throws(() => assertBrowserExtract({ format: "html" }));
  assert.throws(() => assertBrowserExtract({ format: "text", maxChars: 0 }));
  assert.throws(() => assertBrowserExtract({ format: "text", maxChars: Number.POSITIVE_INFINITY }));
  assert.throws(() => assertBrowserExtract({ format: "text", maxChars: 50_001 }));
});

test("inspect 表达式要求非空 selector", () => {
  assert.throws(() => buildBrowserInspectExpression(""));
  assert.ok(buildBrowserInspectExpression("#main").includes("password"));
});