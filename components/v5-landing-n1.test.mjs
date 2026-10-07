// fork:v5-wave-n1（2026-10-04）—— 这一批补齐的「画板有、产品还没有」的 DOM 段。
//
// 与本仓其它源码守卫测试同一口径：钉**结构**（类名 / 嵌套 / 顺序），不钉像素。
// 每条断言后面写清它挡的是哪一次回归 —— 结构对不上时，视觉一定对不上
// （LANDING §0：类名相同 ≠ 结构相同，只加类不换 DOM 就是这条路）。
//
// 本批覆盖：
//   · D-01/D-02/D-02d 的品牌字标（此前产品内联了第二份尺寸）
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
  // fork:v5-frame-audit-2026-10-05：品牌行照画板逐节点抄，字标**本身就是**那张图
  // （原来外面还套了一层按钮，把板面上两件并列的件折成「壳 + 按钮 + 图」）。
  // fork:drop-brand-scramble（用户 2026-10-05）：「点头像翻版本号」这个彩蛋**删掉**
  // —— 点一下字标会换成 `0.1.9-beta.1+…p1.0.0` 滚 3 秒，顶到行外、把搜索与折叠两枚
  // 钮挤没（用户原话「版本号炸了」）。版本号在侧栏底栏有一处，那才是它该在的地方；
  // 连带删掉 useScramble 与相关 state（只有一个消费者）。所以这里断言的是**纯 img**：
  // 不再挂 role=button / tabIndex / onClick / title（挂了就等于把彩蛋留一半）。
  assert.match(
    sidebar,
    /<img className="d-wordmark" src="\/pi-next-wordmark\.png" alt="PI NEXT" draggable=\{false\} \/>/,
  );
  assert.doesNotMatch(sidebar, /wordmarkProps/);
  assert.doesNotMatch(sidebar, /useScramble/);
  assert.doesNotMatch(sidebar, /pi-next-wordmark\.png[^>]*height:/);
  assert.doesNotMatch(sidebar, /d-brand-lockup/);
});

test("侧栏顶部「新建任务」行按参考稿放大，且**不印**快捷键帽（⌘N 是假的）", () => {
  // fork:drop-fake-kbd（用户 2026-10-05）—— 画板 D-01/D-02 那枚 `.d-kbd`（⌘N）不再进
  // 产品：`lib/shortcuts.ts` 里 newSession 的真实键位是 Ctrl+Alt+N（⌥⌘N），⌘N 什么
  // 都不是。
  assert.doesNotMatch(sidebar, /d-kbd/);
  assert.doesNotMatch(sidebar, /m-badge mute">⌘N/);
  assert.doesNotMatch(sidebar, /⌘N/);
  // fork:side-actions —— 那一行仍是库里的 `.d-row`，几何交给产品类 `.fork-side-action`。
  assert.match(
    sidebar,
    /<button\s+type="button"\s+onClick=\{handleNewSession\}[\s\S]{0,400}?className="d-row fork-side-action"[\s\S]{0,200}?square-pen/,
  );
  // fork:side-actions —— 搜索**不**再加第二行（用户 2026-10-05「先帮我去掉」）：
  // 侧栏顶部只有这一枚动作行，搜索的唯一入口仍是抽屉头那枚放大镜。
  assert.equal((sidebar.match(/fork-side-action/g) ?? []).length, 1);
  assert.doesNotMatch(sidebar, /openSessionSearch/);
});

test("桌面顶栏的身份两行与动作簇之间是 .d-tb-spacer，不是动作簇的 margin-left:auto", () => {
  assert.match(shell, /\{!isMobile && <div className="d-tb-spacer" \/>\}/);
  assert.doesNotMatch(
    shell,
    /alignItems: "center", gap: "var\(--s1\)", paddingRight: "var\(--s1\)", marginLeft: "auto"/,
    "弹性垫片由 .d-tb-spacer 承担，动作簇不再自带 margin-left:auto（值只能有一个来源）",
  );
});

test("桌面搜索格落在 .d-side-nav 盒子里；窄屏那格是 .m-searchfield 且常驻", () => {
  // fork:v5-frame-audit（2026-10-05）—— 窄屏那一格按画板 M-04 帧 A「搜索常驻」，
  // 紧贴抽屉头，所以它与桌面那份分成两个渲染点（桌面仍守 DIVERGENCE 38 的默认收起）。
  assert.match(
    sidebar,
    /\{!isMobile && sessionSearchOpen && \(\s*<div className="d-side-nav">\{sessionSearchField\("d-searchfield"\)\}<\/div>/,
  );
  assert.match(sidebar, /\{isMobile && sessionSearchField\("m-searchfield"\)\}/);
  // input 本体仍然只有一份。
  assert.equal((sidebar.match(/id="session-search-input"/g) ?? []).length, 1);
});

test("窄屏会话标题挂 .m-top-title（PWA 形态），桌面那一支仍是 .d-tb-stack", () => {
  assert.match(shell, /<span className="m-top-title">\{topBarSessionTitle\}<\/span>/);
  assert.match(shell, /className="d-tb-stack"/);
  // fork:no-tb-sub-everywhere（2026-10-07 用户再次要求）—— 副行整件删除，
  // 两种形态都不再渲染它。
  assert.doesNotMatch(shell, /className="m-t-xs m-t-faint"/);
  assert.doesNotMatch(shell, /className="d-tb-sub"/);
});

test("ContextMenu 窄屏换 m-* 件，宽屏仍是 d-*；形态判据是 useIsMobile（≤640）", () => {
  assert.match(menu, /import \{ useIsMobile \} from "@\/hooks\/useIsMobile"/);
  assert.match(menu, /const isMobile = useIsMobile\(\)/);
  // 外壳：窄屏 .m-pop-float.is-open，宽屏 .d-pop-float；两支都保留 .context-menu
  // 两段入场（间距不能丢：enteredClass 自己不带前导空格）。
  // fork:v5-frame-audit-2026-10-05 —— 显形开关 `.is-open` 两支共用（画板
  // `.d-pop-float.is-open`），入场类仍要接在后面（间距不能丢）。
  assert.match(menu, /`\$\{isMobile \? "m-pop-float" : "d-pop-float"\} is-open \$\{enteredClass\("context-menu", entered\)\}/);
  // 行：窄屏 .m-menu-row，宽屏 .d-menu-row（danger / is-on 两种状态类两支同义）。
  assert.match(menu, /`\$\{isMobile \? "m-menu-row" : "d-menu-row"\}\$\{opts\.isActive \? " is-on" : ""\}\$\{danger \? " danger" : ""\}`/);
  // 分隔与弱化。
  assert.match(menu, /className=\{isMobile \? "m-sep" : "d-sep"\}/);
  // fork:v5-frame-audit-2026-10-05 —— 文字格用库里的 `.d-grow`（画板 `<span class="d-grow">`），
  // 禁用时叠一枚 `d-t-faint`；两支同构。
  assert.match(menu, /isMobile \? "m-grow" : "d-grow",/);
  assert.match(menu, /entry\.disabled \? \(isMobile \? "m-t-faint" : "d-t-faint"\) : ""/);
  // 定位仍是「跟随指针 + 视口翻转」：没有改成 M-04 帧 C 的底部升起 m-menu-sheet
  // （那是行为变更，见汇报的需产品裁定项）。这条断言就是那道闸。
  assert.doesNotMatch(menu, /m-menu-sheet/);
  assert.match(menu, /top: pos\.y,\s*left: pos\.x/);
});

test("菜单项里再开一只浮窗时，父菜单的收尾不会把它一起关掉", () => {
  // fork:menu-chained-open（2026-10-07 用户报「插件行的『移除…』点了没反应」）——
  // 插件行菜单的 onSelect 会接着开「卸载确认」浮窗（锚点相同、两枚叠着），而
  // runItem 的收尾无条件 closeMenu()：新开的那只被同一个 tick 的关闭吃掉，
  // 用户看到的就是「点了移除没反应」。openMenu 在「已经有一只开着」时置标记，
  // runItem 收尾看到标记就跳过关闭 —— 这三处必须同时存在。
  const menu = strip(contextMenu);
  assert.match(menu, /chainedOpenRef\.current = menuRef\.current !== null;/);
  assert.match(menu, /const chained = chainedOpenRef\.current;/);
  assert.match(menu, /if \(!chained\) \{/);
});
