// fork:mobile-drawer-2026-10-03 —— 侧栏分栏的两个值与默认值。
//
// 单测只钉两件事：**默认值**（用户要的项目在前），以及**未知值/旧值回落**。

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

test("projects is the default pane and there are exactly two", () => {
  assert.equal(SIDEBAR_PANE_DEFAULT, "projects");
  assert.deepEqual([...SIDEBAR_PANE_VALUES], ["projects", "chat"]);
});

test("an unknown or missing stored value falls back to the default pane", () => {
  assert.equal(parseSidebarPane(null), SIDEBAR_PANE_DEFAULT);
  assert.equal(parseSidebarPane(""), SIDEBAR_PANE_DEFAULT);
  assert.equal(parseSidebarPane("proma-39-changes"), SIDEBAR_PANE_DEFAULT);
  // 值还在但已删除的分栏（历史值）不能把抽屉变成空白。
  assert.equal(parseSidebarPane("recent"), SIDEBAR_PANE_DEFAULT);
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
  writeStoredSidebarPane("chat");
  assert.equal(store.get(SIDEBAR_PANE_STORAGE_KEY), "chat");
  assert.equal(readStoredSidebarPane(), "chat");

  // localStorage 抛异常（隐私模式）时本次会话仍能落在默认值上。
  globalThis.window = {
    localStorage: {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    },
  };
  assert.equal(readStoredSidebarPane(), SIDEBAR_PANE_DEFAULT);
  writeStoredSidebarPane("chat");
  delete globalThis.window;
});