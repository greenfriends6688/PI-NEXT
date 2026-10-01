import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("switching changes surface roles without reversing the fixed layout tracks", () => {
  assert.match(source, /const \[workspaceSwapped, setWorkspaceSwapped\] = useState\(false\);/);
  assert.match(source, /setWorkspaceSwapped\(\(swapped\) => !swapped\)/);
  assert.match(css, /grid-template-areas: "main separator secondary"/);
  assert.doesNotMatch(css, /grid-template-areas: "workspace separator chat"/);
  assert.match(css, /\.main-panels:not\(\.workspace-swapped\) \.chat-slot,[\s\S]*?grid-area: main/);
  assert.match(css, /\.main-panels\.workspace-swapped \.right-panel-container[\s\S]*?grid-area: main/);
  assert.match(css, /\.main-panels\.workspace-swapped \.chat-slot[\s\S]*?grid-area: secondary/);
});

test("fixed controls target roles instead of moving with chat or editor content", () => {
  assert.match(source, /className=\{mobile \? undefined : "desktop-sidebar-toggle"\}/);
  assert.match(source, /cssVariableMirrorRef: appShellRef/);
  // Zeno shell: the sidebar toggle lives in the header lane (leading inset
  // below), so it no longer rides `var(--sidebar-width)`; the secondary
  // workspace control still tracks the live right-panel CSS variable.
  assert.match(source, /className=\{mobile \? undefined : "desktop-secondary-workspace-toggle"\}/);
  assert.match(source, /aria-controls=\{mobile \? "file-panel" : secondaryWorkspaceId\}/);
  assert.match(source, /rightPanelOpen[\s\S]*?\? "var\(--right-panel-width\)"[\s\S]*?: "0px"/);
  assert.match(source, /className="desktop-workspace-role-toggle"/);
  assert.match(source, /\{!isMobile && rightPanelOpen && renderWorkspaceRoleToggle\(\)\}/);
  assert.match(css, /\.main-panels\.workspace-panel-open[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 0 var\(--right-panel-width/);
  assert.match(source, /background: rightPanelOpen \? "var\(--bg-panel\)" : "none"/);
  assert.match(source, /color: rightPanelOpen \? "var\(--accent\)" : "var\(--text-muted\)"/);
});

test("resizing updates live without layout-transition lag", () => {
  assert.match(source, /cssVariableMirrorRef: appShellRef/);
  assert.match(source, /className=\{`main-panels\$\{workspaceSwapped \? " workspace-swapped" : ""\}\$\{rightPanelOpen \? " workspace-panel-open" : " workspace-panel-closed"\}\$\{rightPanelResizer\.isResizing \? " main-panels-resizing" : ""\}`\}/);
  assert.match(css, /\.sidebar-container\.sidebar-resizing,[\s\S]*?transition: none !important/);
  assert.match(css, /\.main-panels\.main-panels-resizing[\s\S]*?transition: none/);
});

test("the main workspace header reserves the independent sidebar control lane", () => {
  // Mobile keeps the in-flow toolbar size; on desktop the collapsed rail is now a
  // **column that occupies width** (board 02 frame C), so the header no longer has
  // to dodge a floating strip — both states use the board's own --s2.
  // fork:design-system PR-27 — 顶栏图标按钮改成 CSS 变量（桌面 28 / 粗指针 36），
  // 所以这里断言的是变量名而不是拼出来的 px 值。
  // fork:design-components 2026-09-30 —— 折叠态导轨从「绝对定位在顶栏左端的浮块」
  // 改成画板 02 的全高竖列（logo 顶 / 设置贴底），92px 的让位宽度随之去掉；
  // 展开态回落到 --s2 这条不变（归零会把画板 `.pw-topbar { padding: 0 var(--s2) }` 吃掉）。
  assert.match(
    source,
    /"--main-workspace-header-leading-inset": isMobile\s*\?\s*TOP_BAR_ICON_BUTTON_SIZE\s*:\s*"var\(--s2, 8px\)"/,
  );
  assert.doesNotMatch(source, /--main-workspace-header-leading-inset"?:[\s\S]{0,80}?"92px"/);
  assert.match(source, /"--main-workspace-header-trailing-inset": TOP_BAR_ICON_BUTTON_SIZE,/);
  // fork:design-components —— 两处头行现在同时挂画板类（主区 .pw-topbar / 右栏 .pw-panel-head），
  // 断言的是「恰好两处」这条结构约束，与挂哪个画板类无关。
  assert.equal(source.match(/className="main-workspace-header pw-/g)?.length, 2);
  assert.match(css, /\.main-panels > \.main-workspace \.main-workspace-header[\s\S]*?padding-inline-start: var\(--main-workspace-header-leading-inset, 36px\)/);
  assert.match(css, /\.main-panels \.main-workspace-header[\s\S]*?padding-inline-end: var\(--main-workspace-header-trailing-inset, 36px\)/);
});

test("editor-specific behavior remains active when the editor is the main region", () => {
  assert.match(source, /const editorVisible = workspaceSwapped \|\| rightPanelOpen;/);
  assert.match(source, /if \(!workspaceSwapped\) setRightPanelOpen\(true\);/);
  assert.match(source, /if \(!workspaceSwapped && !replacement && !remaining\.length && !fileTabs\.length\) setRightPanelOpen\(false\);/);
  // fork:file-tab-keep-alive — 隐藏的 tab 不再看文件变更，只有激活项吃 editorVisible。
  assert.match(source, /watchEnabled=\{editorVisible && isActive\}/);
  assert.match(source, /active=\{editorVisible && tab\.id === activeFileTabId\}/);
});

test("compact and phone layouts keep role semantics", () => {
  assert.match(css, /@media \(min-width: 641px\) and \(max-width: 959px\)[\s\S]*?\.secondary-workspace/);
  assert.match(css, /\.main-panels\.workspace-swapped \.right-panel-container\.main-workspace/);
  assert.match(source, /if \(isMobile\) \{[\s\S]*?setWorkspaceSwapped\(false\);/);
});
