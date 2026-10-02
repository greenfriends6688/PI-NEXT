import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  BrowserUrlRejected,
  assertNavigableBrowserUrl,
  classifyBrowserHostname,
  isAllowedBrowserUrlScheme,
  normalizeBrowserTarget,
} = await jiti.import("./browser-url-policy.ts");

test("公网 / loopback / 私网三类都能导航", () => {
  assert.equal(assertNavigableBrowserUrl("https://example.com/a?b=1").scope, "public");
  assert.equal(assertNavigableBrowserUrl("http://localhost:3000/x").scope, "loopback");
  assert.equal(assertNavigableBrowserUrl("http://127.0.0.1:8080").scope, "loopback");
  assert.equal(assertNavigableBrowserUrl("http://[::1]:9000").scope, "loopback");
  assert.equal(assertNavigableBrowserUrl("http://192.168.1.10/").scope, "private");
  assert.equal(assertNavigableBrowserUrl("http://10.1.2.3/").scope, "private");
  assert.equal(assertNavigableBrowserUrl("http://172.16.0.9/").scope, "private");
  assert.equal(assertNavigableBrowserUrl("http://172.31.255.254/").scope, "private");
});

test("172.32/172.15 不算私网（区间写错就是内网探测的口子）", () => {
  assert.equal(classifyBrowserHostname("172.32.0.1"), "public");
  assert.equal(classifyBrowserHostname("172.15.0.1"), "public");
  assert.equal(classifyBrowserHostname("192.169.0.1"), "public");
});

test("link-local 不放行：它只在同一条链路上有意义，agent 没有那个上下文", () => {
  assert.equal(classifyBrowserHostname("169.254.1.1"), "blocked");
  assert.equal(classifyBrowserHostname("fe80::1"), "blocked");
  assert.throws(
    () => assertNavigableBrowserUrl("http://169.254.169.254/latest/meta-data/"),
    (error) => error instanceof BrowserUrlRejected && error.reason === "host-not-allowed",
  );
});

test("file:// 一律拒，并给出本地预览的替代路径", () => {
  for (const input of ["file:///etc/passwd", "FILE:///C:/Windows/win.ini", "file://localhost/etc/hosts"]) {
    assert.throws(
      () => assertNavigableBrowserUrl(input),
      (error) => error instanceof BrowserUrlRejected && error.reason === "file-url-forbidden",
      input,
    );
  }
});

test("非 http/https 的 scheme 一律拒", () => {
  for (const input of ["javascript:alert(1)", "data:text/html,<h1>x", "blob:https://x/y", "chrome://settings", "vbscript:msgbox"]) {
    assert.throws(
      () => assertNavigableBrowserUrl(input),
      (error) => error instanceof BrowserUrlRejected && error.reason === "scheme-not-allowed",
      input,
    );
  }
  assert.equal(isAllowedBrowserUrlScheme("https://a.example"), true);
  assert.equal(isAllowedBrowserUrlScheme("file:///tmp/a.html"), false);
  assert.equal(isAllowedBrowserUrlScheme("not a url at all"), false);
});

test("无 scheme 输入按地址栏常见写法补全", () => {
  assert.equal(normalizeBrowserTarget("example.com"), "https://example.com");
  assert.equal(normalizeBrowserTarget("example.com:8080/x"), "https://example.com:8080/x");
  assert.equal(normalizeBrowserTarget("localhost:3001"), "http://localhost:3001");
  assert.equal(normalizeBrowserTarget("127.0.0.1:5001/api"), "http://127.0.0.1:5001/api");
  assert.equal(normalizeBrowserTarget("192.168.0.2:80"), "http://192.168.0.2:80");
  assert.equal(normalizeBrowserTarget("//cdn.example.com/x"), "https://cdn.example.com/x");
});

test("空输入与超长输入各自给出可分辨的拒绝原因", () => {
  assert.throws(
    () => assertNavigableBrowserUrl("   "),
    (error) => error instanceof BrowserUrlRejected && error.reason === "empty",
  );
  assert.throws(
    () => assertNavigableBrowserUrl(`https://example.com/${"a".repeat(5000)}`),
    (error) => error instanceof BrowserUrlRejected && error.reason === "too-long",
  );
});

test("不做「不像 URL 就当搜索词」的静默回退", () => {
  // 这条与参考实现不同：任意一句话都变成一次对外请求是不可接受的默认行为。
  assert.throws(() => assertNavigableBrowserUrl("今天的天气怎么样"));
});

test("主机名为空 / 不可解析都 fail closed", () => {
  assert.throws(
    () => assertNavigableBrowserUrl("https://"),
    (error) => error instanceof BrowserUrlRejected && error.reason === "unparsable",
  );
  assert.throws(
    () => assertNavigableBrowserUrl("intranet"),
    (error) => error instanceof BrowserUrlRejected && error.reason === "unparsable",
  );
});