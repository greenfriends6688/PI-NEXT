import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const boardCss = await readFile(new URL("../design/pi-web-design/assets/board.css", import.meta.url), "utf8");
const forkCss = await readFile(new URL("../app/fork-ui.css", import.meta.url), "utf8");
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
  // fork:no-recent-sessions —— 标题不再是「最近会话」下拉的触发钮（那一档已撤），
  // 也不再是任何交互元素：纯文本标题，点它什么都不发生。
  assert.match(
    source,
    /<div\n  title=\{topBarSessionTitle\}\n  className="pw-tb-title"\n>\s*\{!isMobile && <span className="pw-ico pw-dim"><i data-ico="panel-left" data-size="14"><\/i><\/span>\}\s*<span>\{topBarSessionTitle\}<\/span>\s*<\/div>/,
  );
  assert.doesNotMatch(source, /activeTopPanel === "sessions"/);
  assert.doesNotMatch(source, /sidebar\.recentSessions/);
  // The title is no longer a bare <button> carrying its own box.
  assert.doesNotMatch(source, /textOverflow: "ellipsis",\s*whiteSpace: "nowrap",\s*maxWidth: "100%",\s*padding: "3px 6px",/);
});

test("the collapsed rail is the board's vertical .pw-rail column", () => {
  assert.match(boardCss, /\.pw-rail \{ display: flex; flex-direction: column; align-items: center/);
  assert.match(source, /className="pw-rail"/);
  // No float, no hand-rolled buttons.
  assert.doesNotMatch(source, /fork-collapsed-rail/);
  // fork:design-components 2026-09-30 —— 画板 02 帧 C：那是**全高竖列**，
  // logo 在顶、四枚 .pw-iconbtn（展开 / 搜索 / 新建会话 / 设置）、设置靠 grow 贴底。
  // 断言钉的是「占列 + 四枚 + 不再绝对定位」这条结构，而不是某个具体按钮。
  assert.match(source, /className="pw-rail"\s+style=\{\{\s+flexShrink: 0,/);
  assert.match(source, /className="pw-logo"/);
  const railBlock = source.slice(
    source.indexOf("const renderCollapsedRail"),
    source.indexOf("const renderSidebarToggle"),
  );
  for (const icon of ["panel-right", "search", "square-pen", "settings"]) {
    assert.match(railBlock, new RegExp(`data-ico="${icon}"`));
  }
  assert.equal((railBlock.match(/<button/g) ?? []).length, 4);
  // macOS 红绿灯让位不是内联写的，而是平台钩子（属产品 CSS 的行为位）。
  // 断言只钉意图（darwin 钩子命中 .pw-rail），不钉选择器写法 —— 这条已经因为
  // `:is(.pw-rail, .settings-…)` ↔ `.pw-rail` 的来回重构假失败过两次。
  assert.match(forkCss, /\[data-desktop-platform="darwin"\]\s*(?::is\(\s*)?\.pw-rail/);
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
  // fork:trace-menu-2026-10-02 —— 「系统提示词」「工具定义」收进 ⋯ 菜单后，顶栏少两枚。
  assert.equal(source.match(/className=\{mobile \? "pw-touch" : "pw-iconbtn"\}/g)?.length, 4);
  assert.equal(source.match(/className="pw-iconbtn"/g)?.length, 3);
  // 3 = 面板头行两枚「更多控件」+ 右栏那枚「新建浏览器标签」（原来自绘
  // `.file-viewer-icon-button` 26px，比同排其余钮大一圈，已换成画板 .pw-iconbtn.sm）
  // + fork:phone-push 侧栏底栏那枚手机钮（2026-10-03 用户要的位置：版本徽章左边）。
  // fork:mobile-toolbar-slim-2026-10-03 —— 窄屏顶栏那枚「更多控件」⋯（`pw-iconbtn sm`）
  // 随覆盖层一起删除，所以这里从 4 处变 3 处。
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
