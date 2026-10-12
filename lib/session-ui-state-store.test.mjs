import assert from "node:assert/strict";
import { createJiti } from "jiti";
import test from "node:test";

const jiti = createJiti(import.meta.url);

/*
 * fork:upstream-0.12-session-state（PR-3b）—— 这个 store 的三个 getter 直接挂在
 * `useSyncExternalStore` 上（`useSessionGroups` / `useRecordProjectOrder` / 会话开关）。
 *
 * 2026-10-13 事故：`snapshot()` 每次 `return { … }` 一个新的对象字面量，
 * `useSyncExternalStore` 一看 `getSnapshot()` 不是同一个引用就判定「快照没缓存」，
 * 当场无限重渲染 —— 生产构建里只有一句 `Minified React error #185`，整个应用白屏，
 * 类型检查、4031 条单测、lint、build **全是绿的**。所以这条测试盯的是引用，不是值。
 */
const store = await jiti.import("./session-ui-state-store.ts");

test("the published snapshot keeps one identity while nothing changes", () => {
  const a = store.getSessionUiStateSnapshot();
  const b = store.getSessionUiStateSnapshot();
  assert.equal(a, b, "getSnapshot 每次返回新对象 = useSyncExternalStore 无限重渲染（React #185）");
});

test("the server snapshot has the same shape and is equally stable", () => {
  const a = store.getSessionUiStateServerSnapshot();
  assert.equal(a, store.getSessionUiStateServerSnapshot());
  // 服务端快照的空态必须与客户端未水合时一致，否则 hydration 当场不匹配。
  assert.equal(a.loaded, false);
  assert.equal(a.synced, false);
  assert.equal(a.error, null);
});

test("a write publishes a new identity exactly once", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ state: store.getSessionUiState() }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const before = store.getSessionUiStateSnapshot();
  const settled = store.applySessionUiState({ action: "pin-project", projectKey: "/tmp/proj", root: "/tmp/proj", pinned: true });
  const after = store.getSessionUiStateSnapshot();
  assert.notEqual(after, before, "乐观写入必须立刻换引用，否则订阅者收不到更新");
  assert.equal(after, store.getSessionUiStateSnapshot(), "换了之后又要稳定下来");
  assert.equal(await settled, true);
});
