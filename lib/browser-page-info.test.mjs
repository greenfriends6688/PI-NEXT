import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { EMPTY_PAGE_INFO, buildPageInfoExpression, parsePageInfo } = await jiti.import("./browser-page-info.ts");

// fork:browser-page-info —— 一次探针拿标题 + favicon + 加载态。
test("the probe reads title, favicon and readyState in one round trip", () => {
  const expression = buildPageInfoExpression();
  assert.match(expression, /document\.title/);
  assert.match(expression, /readyState/);
  assert.match(expression, /link\[rel~="icon"\]/);
});

// favicon 的 href 要直接进 <img src>，协议必须收紧 —— javascript: 渲染进去没意义，
// 而且是条不必要的注入面。
test("only http(s)/data favicons survive parsing", () => {
  assert.equal(parsePageInfo({ favicon: "https://x.test/f.ico", title: "", readyState: "complete" }).favicon, "https://x.test/f.ico");
  assert.equal(parsePageInfo({ favicon: "http://x.test/f.png", title: "", readyState: "complete" }).favicon, "http://x.test/f.png");
  assert.equal(parsePageInfo({ favicon: "data:image/png;base64,AA", title: "", readyState: "complete" }).favicon, "data:image/png;base64,AA");
  // 危险 / 无用协议一律丢掉，退回 null（UI 不画图标，而不是画一个坏图）。
  for (const bad of ["javascript:alert(1)", "blob:http://x/y", "file:///etc/passwd", "notaurl"]) {
    assert.equal(parsePageInfo({ favicon: bad }).favicon, null, `${bad} 不该通过`);
  }
  // data: 只收图片类。
  assert.equal(parsePageInfo({ favicon: "data:text/html,<script>" }).favicon, null);
});

test("readyState only accepts the three known values", () => {
  assert.equal(parsePageInfo({ readyState: "complete" }).readyState, "complete");
  assert.equal(parsePageInfo({ readyState: "interactive" }).readyState, "interactive");
  assert.equal(parsePageInfo({ readyState: "loading" }).readyState, "loading");
  // 页面完全能返回任意串，所以未知值必须落回 loading 而不是被当 complete。
  for (const bad of ["done", "", null, 42, "COMPLETE"]) {
    assert.equal(parsePageInfo({ readyState: bad }).readyState, "loading", `${bad} 不该被当成合法状态`);
  }
});

// 「读不到」与「读到但是空」是两件事，调用方要能分开处理。
test("an unreadable probe is distinguishable from an empty page", () => {
  assert.deepEqual(parsePageInfo(null), EMPTY_PAGE_INFO);
  assert.deepEqual(parsePageInfo("nope"), EMPTY_PAGE_INFO);
  assert.deepEqual(parsePageInfo({}), EMPTY_PAGE_INFO);
  // 真的读到了、页面就是没标题 —— 这时 readyState 是 complete，不是 loading。
  assert.deepEqual(parsePageInfo({ title: "", favicon: null, readyState: "complete" }), {
    title: "", favicon: null, readyState: "complete",
  });
});

test("titles are length-capped so a hostile page cannot bloat the tab bar", () => {
  const long = parsePageInfo({ title: "x".repeat(5000), readyState: "complete" });
  assert.equal(long.title.length, 200);
});