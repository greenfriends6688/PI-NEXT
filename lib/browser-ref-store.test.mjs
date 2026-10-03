import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  BrowserRefRegistry,
  BrowserRefStaleError,
  MAX_BROWSER_REF_ENTRIES,
  formatBrowserRefLabel,
} = await jiti.import("./browser-ref-store.ts");

const elements = (count, start = 0) => Array.from({ length: count }, (_unused, index) => ({
  backendNodeId: 100 + start + index,
  role: "button",
  name: `按钮 ${start + index}`,
  editable: false,
}));

test("observe 开启新世代，ref 带世代前缀", () => {
  const registry = new BrowserRefRegistry();
  const first = registry.publish("tab-a", elements(2));
  assert.equal(first.generation, 1);
  assert.deepEqual(first.refs.map((entry) => entry.ref), ["r1-1", "r1-2"]);
  assert.equal(registry.resolve("tab-a", "r1-1").backendNodeId, 100);
  assert.equal(first.refs[0].label, "button「按钮 0」");
});

test("核心不变式：下一次 observe 让上一代的全部 ref 失效", () => {
  const registry = new BrowserRefRegistry();
  const first = registry.publish("tab-a", elements(2));
  registry.publish("tab-a", elements(1));
  for (const entry of first.refs) {
    assert.throws(
      () => registry.resolve("tab-a", entry.ref),
      (error) => error instanceof BrowserRefStaleError && error.ref === entry.ref && error.refGeneration === 1 && error.currentGeneration === 2,
    );
  }
});

test("导航 / 重载 / debugger 恢复 / 关标签同样作废", () => {
  for (const reason of ["navigate", "reload", "debugger-recovered", "tab-closed"]) {
    const registry = new BrowserRefRegistry();
    const observed = registry.publish("tab-a", elements(1));
    const generation = registry.invalidate("tab-a", reason);
    assert.equal(generation, 2);
    assert.equal(registry.size("tab-a"), 0);
    assert.throws(() => registry.resolve("tab-a", observed.refs[0].ref), BrowserRefStaleError, reason);
  }
});

test("世代按 tab 分片：A 标签导航绝不让 B 标签的 ref 失效", () => {
  const registry = new BrowserRefRegistry();
  const a = registry.publish("tab-a", elements(1));
  const b = registry.publish("tab-b", elements(1));
  registry.invalidate("tab-a", "navigate");
  assert.throws(() => registry.resolve("tab-a", a.refs[0].ref), BrowserRefStaleError);
  assert.equal(registry.resolve("tab-b", b.refs[0].ref).backendNodeId, b.refs[0].backendNodeId);
  assert.deepEqual(registry.stats().generations, { "tab-a": 2, "tab-b": 1 });
});

test("第二道检查：entry 世代与当前世代不符也算失效（防未来有人绕过 invalidate 直接改表）", () => {
  const registry = new BrowserRefRegistry();
  registry.publish("tab-a", elements(1));
  const state = registry.tabs.get("tab-a");
  state.entries.get("r1-1").generation = 0;
  assert.throws(
    () => registry.resolve("tab-a", "r1-1"),
    (error) => error instanceof BrowserRefStaleError && error.refGeneration === 0 && error.currentGeneration === 1,
  );
});

test("从未存在过的 ref 与过期 ref 都报同一个可执行的错", () => {
  const registry = new BrowserRefRegistry();
  registry.publish("tab-a", elements(1));
  assert.throws(() => registry.resolve("tab-a", "r9-9"), BrowserRefStaleError);
  assert.throws(() => registry.resolve("tab-zzz", "r1-1"), BrowserRefStaleError);
});

test("observe 条数有上限，超出部分不发 ref", () => {
  const registry = new BrowserRefRegistry();
  const published = registry.publish("tab-a", elements(MAX_BROWSER_REF_ENTRIES + 50));
  assert.equal(published.refs.length, MAX_BROWSER_REF_ENTRIES);
  assert.equal(registry.size("tab-a"), MAX_BROWSER_REF_ENTRIES);
});

test("forget 之后同 id 复用从 0 重新开始，不与旧世代混", () => {
  const registry = new BrowserRefRegistry();
  const first = registry.publish("tab-a", elements(1));
  registry.forget("tab-a");
  assert.equal(registry.generation("tab-a"), 0);
  const second = registry.publish("tab-a", elements(1));
  assert.equal(second.generation, 1);
  // 新一代的 r1-1 与旧一代的 r1-1 同形，但旧表已经不存在了 —— 旧 tab 已经关掉，
  // 它的 ref 本来就不该再被使用。
  assert.equal(registry.resolve("tab-a", second.refs[0].ref).backendNodeId, 100);
  assert.equal(first.refs[0].ref, second.refs[0].ref);
});

test("标签没有可访问名称时，label 退化成 role", () => {
  assert.equal(formatBrowserRefLabel("textbox", "  "), "textbox");
  assert.equal(formatBrowserRefLabel("button", "x".repeat(200)).length < 100, true);
});