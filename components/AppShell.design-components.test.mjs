import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const boardCss = await readFile(new URL("../design/pi-web-design/assets/board.css", import.meta.url), "utf8");
const icons = await readFile(new URL("../design/pi-web-design/assets/icons.js", import.meta.url), "utf8");

test("the shell draws no hand-written inline SVG", () => {
  assert.doesNotMatch(source, /<svg[\s>]/);
});

test("every icon in the shell comes from the board icon set", () => {
  const used = [...source.matchAll(/data-ico=\"([a-z0-9-]+)\"/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const name of used) {
    assert.match(icons, new RegExp(`^  "${name}":`, "m"), `unknown board icon: ${name}`);
  }
});

test("the top bar title is the board's .pw-tb-title, not a hand-styled button", () => {
  // Board 01/02: `.pw-tb-title` holds a dimmed panel icon plus the title text;
  // the ellipsis comes from `.pw-topbar .pw-tb-title span`.
  assert.match(boardCss, /\.pw-topbar \.pw-tb-title \{[\s\S]*?min-width: 0/);
  assert.match(boardCss, /\.pw-topbar \.pw-tb-title span \{ overflow: hidden; text-overflow: ellipsis/);
  assert.match(
    source,
    /className=\{activeTopPanel === "sessions" \? "pw-tb-title is-on" : "pw-tb-title"\}\s*>\s*\{!isMobile && <span className="pw-ico pw-dim"><i data-ico="panel-left" data-size="14"><\/i><\/span>\}\s*<span>\{topBarSessionTitle\}<\/span>/,
  );
  // The title is no longer a bare <button> carrying its own box.
  assert.doesNotMatch(source, /textOverflow: "ellipsis",\s*whiteSpace: "nowrap",\s*maxWidth: "100%",\s*padding: "3px 6px",/);
});

test("the collapsed rail is the board's vertical .pw-rail column", () => {
  assert.match(boardCss, /\.pw-rail \{ display: flex; flex-direction: column; align-items: center/);
  assert.match(source, /className="pw-rail"/);
  // Three actions, no float, no hand-rolled buttons.
  assert.doesNotMatch(source, /fork-collapsed-rail/);
  for (const icon of ["panel-left", "search", "square-pen"]) {
    assert.match(source, new RegExp(`className="pw-iconbtn"[\\s\\S]{0,120}?data-ico="${icon}"`));
  }
});

test("the top bar action buttons take their size from the board classes", () => {
  // `.pw-iconbtn` / `.pw-touch` own the box, so the toolbar actions no longer
  // repeat width/height inline. The only two that still do are the workspace
  // boundary chips (renderMainFileToggle / renderWorkspaceRoleToggle) — they
  // straddle a panel edge and the board has no primitive for them.
  // fork:design-system 2026-09-30 — 面板头的「新建浏览器标签」从自绘
  // `.file-viewer-icon-button`（26px）换成画板的 `.pw-iconbtn.sm`，
  // 所以 `className="pw-iconbtn sm"` 从 2 处变成 3 处。
  assert.equal(source.match(/width: TOP_BAR_ICON_BUTTON_SIZE/g)?.length, 2);
  assert.equal(source.match(/className=\{mobile \? "pw-touch" : "pw-iconbtn"\}/g)?.length, 6);
  assert.equal(source.match(/className="pw-iconbtn"/g)?.length, 3);
  // 3 = 面板头行两枚「更多控件」+ 右栏那枚「新建浏览器标签」（原来自绘
  // `.file-viewer-icon-button` 26px，比同排其余钮大一圈，已换成画板 .pw-iconbtn.sm）。
  assert.equal(source.match(/className="pw-iconbtn sm"/g)?.length, 3);
});

test("the empty chat placeholder is the board's .pw-empty frame", () => {
  assert.match(boardCss, /\.pw-empty \{ flex: 1; min-height: 0; display: grid; place-items: center; \}/);
  assert.match(boardCss, /\.pw-empty-inner \{ display: grid; gap: var\(--s3\); justify-items: center/);
  assert.match(source, /<div className="pw-empty" style=\{\{ height: "100%" \}\}>[\s\S]*?<div className="pw-empty-inner">[\s\S]*?<span className="mark">[\s\S]*?<h2>\{translate\("workspace\.getStarted"\)\}<\/h2>/);
  assert.doesNotMatch(source, /position: "absolute", top: 12, left: 12/);
});

test("the mobile shell uses the board's drawer, scrim, banner and touch targets", () => {
  assert.match(boardCss, /\.pw-scrim-layer \{ position: absolute; inset: 0; background: var\(--scrim\); \}/);
  assert.match(boardCss, /\.pw-drawer \{[\s\S]*?width: 272px/);
  // The drawer is the sidebar container itself, and only on mobile.
  assert.match(source, /className=\{`sidebar-container pw-side\$\{isMobile \? " pw-drawer" : ""\}/);
  assert.match(source, /sidebar-overlay-backdrop pw-scrim-layer/);
  // fork:design-system SW-16 —— 画板 60 帧 D：移动端信任横幅是 .pw-banner（内联信任钮），
  // 桌面仍是 .pw-alert。
  assert.match(source, /className="pw-banner"/);
  assert.match(source, /className="pw-alert"/);
  assert.match(source, /data-ico="shield-question"/);
  // No bottom control bar was introduced.
  assert.doesNotMatch(source, /pw-mobile-bar|pw-sheet/);
});
