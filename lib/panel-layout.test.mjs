import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  clampPanelWidth,
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
} = await jiti.import("./panel-layout.ts");

test("clamps panel widths to finite bounds", () => {
  assert.equal(clampPanelWidth(420.4, 180, 480), 420);
  assert.equal(clampPanelWidth(120, 180, 480), 180);
  assert.equal(clampPanelWidth(600, 180, 480), 480);
  assert.equal(clampPanelWidth(Number.NaN, 180, 480), 180);
  assert.equal(clampPanelWidth(200, 300, 250), 300);
});

test("keeps the responsive right panel default within useful limits", () => {
  assert.equal(getDefaultRightPanelWidth(700), 380);
  // fork:panel-tree-only — 默认宽度是「只有文件树」时的宽度（420）：面板首次打开时
  // 里面没有文档，760（树 + 文档并排）会让半扇窗口坐着一棵树。文档打开时由
  // AppShell.handleOpenFile 一次性加宽到 760 + 60。
  assert.equal(getDefaultRightPanelWidth(1366), 420);
  assert.equal(getDefaultRightPanelWidth(1600), 420);
  assert.equal(getDefaultRightPanelWidth(1920), 420);
  // 窗口不够宽时仍然让位给聊天，且不超过「树 + 文档并排」的上限。
  for (const viewport of [1024, 1280, 1366, 1440, 1600, 1920, 2560]) {
    const panel = getDefaultRightPanelWidth(viewport);
    assert.ok(panel <= 760, `panel wider than the split comfort width at ${viewport}`);
    assert.ok(viewport - panel - 300 >= 344, `chat squeezed at ${viewport}`);
  }
});

test("reserves chat space while split panels are visible", () => {
  // Zeno rail caps the sidebar at 360, so the compact (non-split) reserve is
  // min(SIDEBAR_MAX, viewport - chat) rather than the chat-leftover 380.
  assert.equal(getSidebarMaxWidth({
    viewportWidth: 700,
    rightPanelOpen: true,
    rightPanelWidth: 560,
  }), 360);
  assert.equal(getSidebarMaxWidth({
    viewportWidth: 1366,
    rightPanelOpen: true,
    rightPanelWidth: 686,
  }), 260);
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 1024,
    sidebarOpen: true,
    sidebarWidth: 260,
  }), 344);
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 1366,
    sidebarOpen: true,
    sidebarWidth: 260,
  }), 686);
});

test("does not rewrite desktop widths while the file panel is in overlay mode", () => {
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 900,
    sidebarOpen: true,
    sidebarWidth: 480,
  }), 1200);
});
