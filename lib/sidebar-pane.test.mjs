// fork:mobile-drawer-2026-10-03 —— 侧栏分栏的三格值与默认值。
//
// 单测只钉两件事：**新增的 recent 不能改变默认值**，以及**未知值/旧值回落**。
// 顺序（recent 在最前）是产品决定，board.css 用 auto-flow 按内容分列，所以
// 这里也不该把它钉成「三格按这个顺序」——那是画板的事（DIVERGENCE AH 节）。

import assert from "node:assert/strict";
import test from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  SIDEBAR_PANE_DEFAULT,
  SIDEBAR_PANE_STORAGE_KEY,
  SIDEBAR_PANE_VALUES,
  parseSidebarPane,
  readStoredSidebarPane,
  writeStoredSidebarPane,
} = await jiti.import("./sidebar-pane.ts");

test("recent is a pane but never the default", () => {
  assert.ok(SIDEBAR_PANE_VALUES.includes("recent"));
  assert.equal(SIDEBAR_PANE_DEFAULT, "projects");
});

test("an unknown or missing stored value falls back to the default pane", () => {
  assert.equal(parseSidebarPane(null), SIDEBAR_PANE_DEFAULT);
  assert.equal(parseSidebarPane(""), SIDEBAR_PANE_DEFAULT);
  assert.equal(parseSidebarPane("proma-39-changes"), SIDEBAR_PANE_DEFAULT);
  // 值还在但已删除的分栏（历史值）不能把抽屉变成空白。
  assert.equal(parseSidebarPane("changes"), SIDEBAR_PANE_DEFAULT);
});

test("every stored pane value round-trips", () => {
  for (const pane of SIDEBAR_PANE_VALUES) {
    assert.equal(parseSidebarPane(pane), pane);
  }
});

test("storage reads and writes go through one key and survive a hostile store", () => {
  assert.equal(SIDEBAR_PANE_STORAGE_KEY, "pi-sidebar-pane");

  // 模块读的是 `window.localStorage`（浏览器形态），不是 globalThis.localStorage ——
  // Node 那边两者不等价，所以这里一并把 window 换掉。
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
    },
  };
  writeStoredSidebarPane("recent");
  assert.equal(store.get(SIDEBAR_PANE_STORAGE_KEY), "recent");
  assert.equal(readStoredSidebarPane(), "recent");

  // localStorage 抛异常（隐私模式）时本次会话仍能落在默认值上。
  globalThis.window = {
    localStorage: {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    },
  };
  assert.equal(readStoredSidebarPane(), SIDEBAR_PANE_DEFAULT);
  writeStoredSidebarPane("recent");
  delete globalThis.window;
});