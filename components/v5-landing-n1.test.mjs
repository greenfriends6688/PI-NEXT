// fork:v5-wave-n1（2026-10-04）—— 这一批补齐的「画板有、产品还没有」的 DOM 段。
//
// 与本仓其它源码守卫测试同一口径：钉**结构**（类名 / 嵌套 / 顺序），不钉像素。
// 每条断言后面写清它挡的是哪一次回归 —— 结构对不上时，视觉一定对不上
// （LANDING §0：类名相同 ≠ 结构相同，只加类不换 DOM 就是这条路）。
//
// 本批覆盖：
//   · D-01/D-02/D-02d 的 `<img class="d-wordmark">`（此前产品内联了第二份尺寸）
//   · D-01/D-02 的 `.d-side-nav > .d-row` 行尾 `.d-kbd`（⌘N）
//   · D-02/D-02b/D-02c/D-02d 每条桌面顶栏的 `.d-tb-spacer`
//   · D-02 帧 D / D-02d 帧 E 搜索格的外层 `.d-side-nav`（间距不再有第二个来源）
//   · M-01/M-04 的窄屏会话标题 `.m-top-title`（d-* 在 ≤640 不生效，此前那格是白板）
//   · M-04 帧 C 的 ContextMenu 窄屏件 `.m-pop-float` / `.m-menu-row` / `.m-sep`
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sessionSidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const contextMenu = await readFile(new URL("./ContextMenu.tsx", import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const shell = strip(appShell);
const sidebar = strip(sessionSidebar);
const menu = strip(contextMenu);

test("品牌字标走画板那一件 .d-wordmark，不再内联第二份尺寸", () => {
  // 画板原文：<img class="d-wordmark" src="…/wordmark.png" alt="PI NEXT">
  // 产品原来写死 height:10 —— 同一个值两处（铁律三），且比画板矮一半。
  assert.match(sidebar, /<img className="d-wordmark" src="\/pi-next-wordmark\.png" alt="PI NEXT" draggable=\{false\} \/>/);
  assert.doesNotMatch(sidebar, /pi-next-wordmark\.png[^>]*style=\{/);
});

test("侧栏「新建任务」行尾有 .d-kbd（⌘N），与窄屏那一支同一件", () => {
  assert.match(
    sidebar,
    /<span className="d-grow">\{t\("sidebar\.newTask"\)\}<\/span>\s*(?:\{\s*\})?\s*<span className="d-kbd">⌘N<\/span>/,
  );
  // 窄屏那一枚仍是 .m-badge mute（同一个 ⌘N，两种形态）。
  assert.match(sidebar, /className="m-badge mute">⌘N<\/span>/);
});

test("桌面顶栏的身份两行与动作簇之间是 .d-tb-spacer，不是动作簇的 margin-left:auto", () => {
  assert.match(shell, /\{!isMobile && <div className="d-tb-spacer" \/>\}/);
  assert.doesNotMatch(
    shell,
    /alignItems: "center", gap: "var\(--s1\)", paddingRight: "var\(--s1\)", marginLeft: "auto"/,
    "弹性垫片由 .d-tb-spacer 承担，动作簇不再自带 margin-left:auto（值只能有一个来源）",
  );
});

test("桌面搜索格落在 .d-side-nav 盒子里；窄屏那格是 .m-searchfield", () => {
  assert.match(
    sidebar,
    /\{sessionSearchOpen && \(\s*isMobile \? sessionSearchField\("m-searchfield"\) : \(\s*<div className="d-side-nav">\{sessionSearchField\("d-searchfield"\)\}<\/div>/,
  );
  // 搜索格仍然只在 sessionSearchOpen 时挂载（DIVERGENCE 38 的默认收起）。
  assert.equal((sidebar.match(/id="session-search-input"/g) ?? []).length, 1);
});

test("窄屏会话标题挂 .m-top-title（PWA 形态），桌面那一支仍是 .d-tb-stack", () => {
  assert.match(shell, /<span className="m-top-title">\{topBarSessionTitle\}<\/span>/);
  assert.match(shell, /className="d-tb-stack"/);
  // 副行（fork:mobile-tb-subtitle 的既有功能）在窄屏换 PWA 字号件，不删。
  assert.match(shell, /\{subtitle && <span className="m-t-xs m-t-faint">\{subtitle\}<\/span>\}/);
});

test("ContextMenu 窄屏换 m-* 件，宽屏仍是 d-*；形态判据是 useIsMobile（≤640）", () => {
  assert.match(menu, /import \{ useIsMobile \} from "@\/hooks\/useIsMobile"/);
  assert.match(menu, /const isMobile = useIsMobile\(\)/);
  // 外壳：窄屏 .m-pop-float.is-open，宽屏 .d-pop-float；两支都保留 .context-menu
  // 两段入场（间距不能丢：enteredClass 自己不带前导空格）。
  assert.match(menu, /`\$\{isMobile \? "m-pop-float is-open" : "d-pop-float"\} \$\{enteredClass\("context-menu", entered\)\}/);
  // 行：窄屏 .m-menu-row，宽屏 .d-menu-row（danger / is-on 两种状态类两支同义）。
  assert.match(menu, /`\$\{isMobile \? "m-menu-row" : "d-menu-row"\}\$\{opts\.isActive \? " is-on" : ""\}\$\{danger \? " danger" : ""\}`/);
  // 分隔与弱化。
  assert.match(menu, /className=\{isMobile \? "m-sep" : "d-sep"\}/);
  assert.match(menu, /entry\.disabled \? \(isMobile \? "m-t-faint" : "d-t-faint"\) : undefined/);
  // 定位仍是「跟随指针 + 视口翻转」：没有改成 M-04 帧 C 的底部升起 m-menu-sheet
  // （那是行为变更，见汇报的需产品裁定项）。这条断言就是那道闸。
  assert.doesNotMatch(menu, /m-menu-sheet/);
  assert.match(menu, /top: pos\.y,\s*left: pos\.x/);
});
