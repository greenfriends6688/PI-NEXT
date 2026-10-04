import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const boardCss = await readFile(new URL("../design/pi-web-design/assets/board.css", import.meta.url), "utf8");
const systemCss = await readFile(new URL("../design/v5/web/system.css", import.meta.url), "utf8");
const forkCss = await readFile(new URL("../app/fork-ui.css", import.meta.url), "utf8");
const icons = await readFile(new URL("../design/pi-web-design/assets/icons.js", import.meta.url), "utf8");

test("the shell draws no hand-written inline SVG", () => {
  assert.doesNotMatch(source, /<svg[\s>]/);
});

test("every icon in the shell comes from the board icon set", () => {
  const used = [...source.matchAll(/data-ico="([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const name of used) {
    assert.match(icons, new RegExp(`^  "${name}":`, "m"), `unknown board icon: ${name}`);
  }
});

test("the top bar title is the board's .d-tb-stack, not a hand-styled button", () => {
  // fork:v5-landing —— 标题两行 = 画板 D-01/D-02 的 `.d-tb-stack`（`d-tb-title` + `d-tb-sub`），
  // 省略号由 `.d-tb-title` 给；旧 `.pw-tb-title` 已从 DOM 退场。
  assert.match(systemCss, /\.d-tb-stack \{ display: flex; flex-direction: column; min-width: 0; \}/);
  assert.match(systemCss, /\.d-tb-title \{[^}]*text-overflow: ellipsis/);
  // fork:no-recent-sessions —— 标题不再是「最近会话」下拉的触发钮（那一档已撤），
  // 也不再是任何交互元素：纯文本标题，点它什么都不发生。
  assert.match(source, /className="d-tb-stack"/);
  assert.match(source, /<span className="d-tb-title">\{topBarSessionTitle\}<\/span>/);
  assert.match(source, /\{subtitle && <span className="d-tb-sub">\{subtitle\}<\/span>\}/);
  assert.doesNotMatch(source, /activeTopPanel === "sessions"/);
  assert.doesNotMatch(source, /sidebar\.recentSessions/);
  // The title is no longer a bare <button> carrying its own box.
  assert.doesNotMatch(source, /textOverflow: "ellipsis",\s*whiteSpace: "nowrap",\s*maxWidth: "100%",\s*padding: "3px 6px",/);
});

test("the collapsed rail is the board's vertical .d-rail column", () => {
  assert.match(systemCss, /\.d-rail \{ width: 48px; flex: 0 0 auto; display: flex; flex-direction: column; align-items: center/);
  assert.match(source, /className="d-rail"/);
  // No float, no hand-rolled buttons.
  assert.doesNotMatch(source, /fork-collapsed-rail/);
  // fork:design-components 2026-09-30 —— 画板 02 帧 C：那是**全高竖列**，
  // logo 在顶、四枚 .d-iconbtn（展开 / 搜索 / 新建会话 / 设置）、设置靠 grow 贴底。
  // 断言钉的是「占列 + 四枚 + 不再绝对定位」这条结构，而不是某个具体按钮。
  assert.match(source, /className="d-rail"\s+style=\{\{\s+flexShrink: 0,/);
  assert.match(source, /className="d-logo"/);
  const railBlock = source.slice(
    source.indexOf("const renderCollapsedRail"),
    source.indexOf("const renderSidebarToggle"),
  );
  for (const icon of ["panel-right", "search", "square-pen", "settings"]) {
    assert.match(railBlock, new RegExp(`data-ico="${icon}"`));
  }
  assert.equal((railBlock.match(/<button/g) ?? []).length, 4);
  // macOS 红绿灯让位钩子写在 fork-ui.css 的 `[data-desktop-platform="darwin"] .d-rail` 上；
  // fork:v5-landing —— 导轨 DOM 从 `.pw-rail` 换成 `.d-rail`，钩子已在收尾波改挂 `.d-rail`
  // （否则红绿灯会压住导轨顶端）。断言随之改钉当前类名。
  assert.match(forkCss, /\[data-desktop-platform="darwin"\] \.d-rail/);
  assert.doesNotMatch(forkCss, /\[data-desktop-platform="darwin"\][^{]*\.pw-rail/);
});

test("the top bar action buttons take their size from the board classes", () => {
  // `.d-iconbtn` owns the box, so the toolbar actions no longer repeat width/height inline.
  // The only two that still do are the workspace boundary chips (renderMainFileToggle /
  // renderWorkspaceRoleToggle) — they straddle a panel edge and the board has no primitive
  // (手机那一档已经改挂 `.m-top-btn`，所以 renderMainFileToggle 只剩桌面这一条)。
  assert.equal(source.match(/width: TOP_BAR_ICON_BUTTON_SIZE/g)?.length, 2);
  // fork:v5-landing —— 顶栏动作钮统一是画板 `.d-iconbtn`；手机触控档的旧 `.pw-touch` 已退场。
  // fork:v5-wave-b —— 手机上其中两枚（抽屉底栏的手机与推送钮、右栏面板开关）改挂 PWA
  // 的 `.m-iconbtn` / `.m-top-btn`（≤640 生效），所以字面量从 11 降到 10。
  assert.equal(source.match(/className="d-iconbtn"/g)?.length, 9);
  assert.match(source, /className=\{isMobile \? "m-iconbtn" : "d-iconbtn"\}/);
  // 手机顶栏的两枚（抽屉入口 + 右栏面板开关）现在都是 `.m-top-btn`。
  assert.match(source, /className="m-top-btn"/);
  assert.match(source, /className=\{mobile \? "m-top-btn" : "desktop-secondary-workspace-toggle"\}/);
  assert.doesNotMatch(source, /className=\{mobile \? "pw-touch"/);
});

test("the empty chat placeholder is the board's .d-empty frame", () => {
  assert.match(systemCss, /\.d-empty \{ display: flex; flex-direction: column; align-items: center; justify-content: center/);
  assert.match(systemCss, /\.d-empty-ico \{ width: 44px; height: 44px/);
  assert.match(source, /<div className="d-empty" style=\{\{ height: "100%" \}\}>[\s\S]*?<div className="d-empty-ico">[\s\S]*?<div className="d-empty-t">\{translate\("workspace\.getStarted"\)\}<\/div>/);
  assert.doesNotMatch(source, /position: "absolute", top: 12, left: 12/);
});

test("the mobile shell uses the board's scrim, banner and sidebar column", () => {
  assert.match(systemCss, /\.d-scrim \{ position: absolute; inset: 0;/);
  // The drawer is the sidebar container itself; the old `.pw-drawer` size class is gone
  // (the mobile width comes from `.sidebar-container` + `d-side`).
  assert.match(source, /className=\{`sidebar-container d-side/);
  assert.match(source, /sidebar-overlay-backdrop d-scrim/);
  // fork:v5-wave-b —— 抽屉与遮罩在窄屏换成 PWA 的 `.m-drawer` / `.m-scrim`（开合由
  // 同一个 `sidebarOpen` state 表达成 `.is-open`），≥641 仍是 d-*。
  assert.match(source, /isMobile \? " m-drawer" : ""/);
  assert.match(source, /isMobile \? ` m-scrim\$\{sidebarOpen \? " is-open" : ""\}` : ""/);
  // fork:design-system SW-16 —— 画板 60 帧 D：移动端信任横幅是 .d-banner，桌面是 .d-banner.err。
  // fork:v5-wave-b —— 窄屏换成 PWA 的 `.m-banner.warn`（同一个 state / role / 回调）。
  assert.match(source, /className=\{mobileBanner \? "m-banner warn" : "d-banner warn"\}/);
  assert.match(source, /className="d-banner err"/);
  assert.match(source, /data-ico="shield-question"/);
  // No bottom control bar was introduced.
  assert.doesNotMatch(source, /pw-mobile-bar|pw-sheet/);
});
