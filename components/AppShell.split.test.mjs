import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * fork:pr40-split (2026-10-03) —— 右栏分屏接线在 AppShell 这一侧的形状守卫。
 *
 * 两条约束都是「错了不会报错、只会像坏了」的那种，所以写成断言：
 *   1. 分屏分支**不能**沿用单列的「全量常驻 + hidden」——同一个终端 tab 会被两个
 *      Pane 各起一个 PTY；
 *   2. 窄栏 / 手机退回单列时**保留分屏态**（不 `setSplits(null)`），否则拖回来的
 *      过程会把用户刚排好的布局清掉。
 */

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/fork-ui.css", import.meta.url), "utf8");

test("the split branch mounts exactly one tab per pane, not the resident list", () => {
  assert.match(
    source,
    /\{splitPanes\.isSplitActive && splitPanes\.leftTabId && splitPanes\.rightTabId \? \(/,
    "two panes only render when both tab ids are known",
  );
  // children(pane, tabId) → resident=false：那一格**只**挂自己那一个 tab。
  assert.match(source, /\{\(_pane, paneTabId\) => renderTabContent\(paneTabId, false\)\}/);
  // 单列那一支才是 resident=true（常驻 + hidden）。
  assert.match(source, /\{fileTabs\.map\(\(tab\) => renderTabContent\(tab\.id, true\)\)\}/);
  assert.match(source, /\{terminalTabs\.map\(\(tab\) => renderTabContent\(tab\.id, true\)\)\}/);
});

test("the render helper splits resident and per-pane mounting on one flag", () => {
  assert.match(source, /const renderTabContent = \(tabId: string, resident: boolean\) => \{/);
  assert.match(source, /const isActive = resident \? tabId === activeFileTabId : true;/);
  assert.match(source, /resident\s*\n\s*\? <div key=\{key\} hidden=\{!isActive\}/);
  // 分屏时那一格没有「先激活再挂」这一步，不能拿 mountedFileTabs 去卡它。
  assert.match(source, /if \(resident && !mountedFileTabs\.has\(fileTab\.id\)\) return null;/);
});

test("the hook is fed the panel's own tab list and takes over tab selection", () => {
  assert.match(source, /const splitPanes = useSplitPanes\(\{\n\s+sessionId: selectedSession\?\.id \?\? null,\n\s+availableTabIds: panelTabIds,\n\s+activeTabId: activeFileTabId,\n\s+onActiveTabIdChange: setActiveFileTabId,\n\s+isMobile,/);
  // 顶栏点选必须走 selectTab：分屏时它决定「换内容」还是「只换焦点」。
  assert.match(source, /onSelectTab=\{splitPanes\.selectTab\}/);
});

test("the tree column yields to a split instead of squeezing three columns", () => {
  assert.match(source, /&& !splitPanes\.isSplitActive/);
});

test("the split's two tabs are grouped adjacently in the tab bar", () => {
  assert.match(source, /groupRightPanelSplitTabs\(panelTabs, splitPanes\.leftTabId, splitPanes\.rightTabId\)/);
  assert.match(source, /tabs=\{orderedPanelTabs\}/);
});

test("the split-pane skeleton stays in fork-ui.css and adds no new .pw-* class", () => {
  // `.pw-*` 是画板与对位脚本认得的契约名；新造一个会被当成「板上有、产品没实现」。
  assert.match(css, /\.split-pane-grid\s*\{\s*\n\s*\/\*[^\n]*\*\/\s*\n\s*grid-template-columns: var\(--split-pane-columns\);/);
  assert.match(css, /\.split-pane\s*\{/);
  assert.match(css, /\.split-pane-divider\s*\{/);
  assert.match(css, /\.split-pane-drop\s*\{/);
  // 分隔条宽度取 token，不写死 8px（与 lib/right-panel-split.ts 的 SPLIT_DIVIDER_WIDTH 同值）。
  assert.match(css, /--split-gutter:\s*var\(--s2\)/);
  assert.doesNotMatch(css, /\.split-pane-divider\s*\{[^}]*\bwidth:\s*8px/);
  const splitBlock = css.slice(css.indexOf("fork:pr40-split"));
  assert.doesNotMatch(splitBlock, /^\.pw-/m, "the split block must not define a new .pw-* class");
});