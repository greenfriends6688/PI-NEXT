import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
// fork:v5-landing E4 —— 手机信任条搬进 `components/pwa/PwaTrustSheet.tsx`，
// 所以这条守卫同时读那个组件与 PWA 形态库。
const trustBanner = await readFile(new URL("./pwa/PwaTrustSheet.tsx", import.meta.url), "utf8");
const pwaSystemCss = await readFile(new URL("../design/v5/pwa/system.css", import.meta.url), "utf8");
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
  // fork:v5-landing —— 标题 = 画板 D-01/D-02 的 `.d-tb-stack`（现在只剩 `d-tb-title`），
  // 省略号由 `.d-tb-title` 给；旧 `.pw-tb-title` 已从 DOM 退场。
  assert.match(systemCss, /\.d-tb-stack \{ display: flex; flex-direction: column; min-width: 0; \}/);
  assert.match(systemCss, /\.d-tb-title \{[^}]*text-overflow: ellipsis/);
  // fork:no-recent-sessions —— 标题不再是「最近会话」下拉的触发钮（那一档已撤），
  // 也不再是任何交互元素：纯文本标题，点它什么都不发生。
  // fork:no-tb-sub（2026-10-05）→ fork:v6-landing（2026-10-07 上午）→
  // fork:no-tb-sub-everywhere（2026-10-07 当天用户再次要求）：`d-tb-sub` 那一行
  // **最终删掉**，`.d-tb-stack` 里只剩标题。
  assert.match(source, /className="d-tb-stack"/);
  assert.match(source, /<span className="d-tb-title">\{topBarSessionTitle\}<\/span>/);
  assert.doesNotMatch(source, /className="d-tb-sub"/);
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
  // 数的是**元素**，不是文本：源码注释里出现过 `<button class="d-iconbtn is-on">`
  // 这种板面原文照抄，裸 `match(/<button/g)` 会把它数进去。
  const railCode = railBlock.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  assert.equal((railCode.match(/<button/g) ?? []).length, 4);
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
  // fork:panel-head-actions —— 2026-10-06 用户裁定：右栏面板头行里 git 钮后面新挂了
  // 终端 / 浏览器两枚（浏览器那枚本来就有，从文件树头行搬过来），多用了一处。
  // fork:tb-slim（2026-10-07 用户裁定）—— 顶栏的「生成会话标题」与「导出 Markdown」
  // 两枚图标钮退场（前者搬进会话动作 ⋯ 菜单，后者本来就在那个菜单里），所以 10 → 8。
  assert.equal(source.match(/className="d-iconbtn"/g)?.length, 8);
  // fork:v5-frame-audit（2026-10-05）—— 抽屉底栏那枚「手机与推送」钮按画板
  // M-04 帧 A 的 `.m-drawer-foot` 改成了 `.m-top-btn`（桌面上仍是 `.d-iconbtn`）。
  // fork:pwa-drawer-foot-icon（2026-10-06 用户裁定）—— 随后换成无底的 `.m-iconbtn`：
  // 底栏那枚不是浮在内容上的顶栏钮，玻璃圆底是一圈多余的圆。
  assert.match(source, /className=\{isMobile \? "m-iconbtn" : "d-iconbtn"\}/);
  // 手机顶栏的两枚（抽屉入口 + 右栏面板开关）现在都是 `.m-top-btn`。
  // fork:v5-wave-b —— 右栏面板钮后来又收了一步：它两端都在（手机与桌面同一个按钮），
  // 形态由内联几何的 `mobile ? undefined : {...}` 分支处理，不再用三元类名。
  // 所以断言改成「两枚入口钮都在、手机那一套几何确实被跳过」——不变的仍是那件事。
  assert.match(source, /className="m-top-btn"/);
  assert.match(source, /className="desktop-secondary-workspace-toggle"/);
  assert.match(source, /style=\{mobile \? undefined : \{/);
  assert.doesNotMatch(source, /className=\{mobile \? "pw-touch"/);
});

test("the shared top-panel shell never renders the branch panel's empty body", () => {
  // fix:branch-panel-ghost（2026-10-06 用户报「点了会话分支，左边还留着一个空框」）——
  // 分支浮层的实体是 BranchNavigator 自己那只（桌面在顶栏芯片下、窄屏在 `.m-branch`
  // 下）；共用壳里只有 agents / system / tools 三种 body，让 `branches` 进去就会得到
  // 一个定位到顶栏左缘、没有内容、还挡住一块可点区域的 `.d-pop-float`。
  assert.match(source, /activeTopPanel && activeTopPanel !== "branches" && topPanelPos &&/);
  // 窄屏那枚内联按钮是 `display:none`，必须把 `.m-branch` 的 ref 当锚点交给
  // BranchNavigator，否则浮层落到 top:6 / left:8。
  assert.match(source, /ref=\{mobileBranchRef\}/);
  assert.match(source, /hideInlineButton\s+containerRef=\{mobileBranchRef\}/);
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
  // fork:design-system SW-16 —— 画板 60 帧 D：移动端信任横幅是顶栏下方的常驻条，
  // 不是弹窗；桌面仍是点开模态的 `.d-banner.err`。
  // fork:v5-landing E4 —— 横幅本体换成画板 M-10 帧 C-1 的 `.m-trust`
  // （落在 `components/pwa/PwaTrustSheet.tsx` 的 `PwaTrustBanner`）：宿主只给
  // 真实 cwd / busy / 错误与那一个信任动作，形态与状态类全在组件里。
  assert.match(source, /<PwaTrustBanner[\s\S]{0,200}?onTrust=\{\(\) => void handleTrustProject\(\)\}/);
  assert.match(trustBanner, /className="m-trust"/);
  assert.match(pwaSystemCss, /\.m-trust \{/);
  assert.match(source, /className="d-banner err"/);
  assert.match(source, /data-ico="shield-question"/);
  // No bottom control bar was introduced.
  assert.doesNotMatch(source, /pw-mobile-bar|pw-sheet/);
});
