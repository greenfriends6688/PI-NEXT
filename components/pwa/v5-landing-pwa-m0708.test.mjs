// M-07 / M-08 逐帧落地（2026-10-06 · fork:v5-pwa-m0708）
//
// 这一波量出来的是同一类事故的三个面：**整层浮起类被挂在 pane 正文上**。
// `.m-viewer` 在库里是「整层浮起」（`position:absolute; inset:0; z-index:var(--nx-z-panel)`），
// 而 `BrowserPanel` 的 PWA 根在产品里是 pane 正文（挂在 `.file-panel-main` 里，
// 或 M-12 那一层的 `.m-panel-scroll` 里）。挂上去再加内联 `fixed / inset:0`，
// 它就从容器里逃出去铺满视口（实测 390×844 / z=100），把宿主自己的页签条整条盖掉 ——
// 手机上进得去出不来。`TraceFrame`（`.m-viewer`）与 `FileExplorer`（第二条 `.m-top`
// + 108px 顶栏让位）此前是同一件事，已在 `v5-landing-pwa-frames.test.mjs` 里钉住；
// 这一批把 `BrowserPanel` 与 `GitGraphTab` 也钉上，并加上另外两条会静默回归的。
//
// 断言写法沿用上一批：**钉在会算错的那一格上**（类名出现在产品 / 不出现在该出现的那一支 /
// 接线层那几块壳真的存在），不是钉拼写。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const browserPanel = read("components/BrowserPanel.tsx");
const gitGraphTab = read("components/GitGraphTab.tsx");
const commandPalette = read("components/fork/CommandPalette.tsx");
const pwaSystemCss = read("design/v5/pwa/system.css");
const forms = read("app/design/v5-forms.css");
const globalsCss = read("app/globals.css");

/** 去掉注释再匹配：注释里写着「不再用 .m-viewer」不该被当成真用了。 */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const browserCode = strip(browserPanel);
const gitCode = strip(gitGraphTab);

test("M-07 帧 A：浏览器在产品里是 pane 正文，不再自称整层（盖掉宿主页签条）", () => {
  /* 根因：`BrowserPanel` 的 PWA 根原来挂 `.m-viewer is-open` **再加内联
     `position: fixed; inset: 0`**。实测 390×844、`position: fixed`、z=100，
     宿主那一层的 `.m-viewer-bar` / `.m-panel-scroll` 根本不在树上；顶栏那枚
     M-12 入口钮被自己的 `.m-urlbar` 接管指针（重载后照样进得去出不来）。 */
  assert.doesNotMatch(
    browserCode,
    /"m-viewer is-open"/,
    "BrowserPanel 的 PWA 根不能再挂整层浮起类（会盖掉宿主页签条 / M-12 六项切换条）",
  );
  assert.doesNotMatch(
    browserCode,
    /position: "fixed", inset: 0/,
    "PWA 根不许再内联 fixed+inset:0（几何定位要交给宿主那一层）",
  );
  assert.match(browserCode, /<div className="fork-browser-pane">/);
});

test("M-07 帧 A：接线层有 `fork-browser-pane`，且它是一条普通流里的弹性列", () => {
  /* 与 `fork-trace-pane`（TraceFrame）逐字同构。`height: 100%` 必须在：AppShell
     的 `box()` 常驻壳是 `<div style="width:100%; height:100%">`（块级，不是弹性列），
     只给 `flex: 1 1 auto` 高度会塌成内容高。父级是弹性列时（M-12 的
     `.m-panel-scroll`）flex 那三条仍然生效，两条并存不冲突。 */
  assert.match(forms, /\.fork-browser-pane \{[\s\S]*?display: flex;[\s\S]*?flex: 1 1 auto;[\s\S]*?height: 100%;[\s\S]*?min-height: 0;/);
  // 整层浮起那两个属性一个都不许出现在这块壳上。
  const rule = forms.slice(forms.indexOf(".fork-browser-pane {"), forms.indexOf("}", forms.indexOf(".fork-browser-pane {")));
  assert.doesNotMatch(rule, /position:\s*(absolute|fixed)/, "pane 正文不许再是定位层");
  assert.doesNotMatch(rule, /inset:/, "pane 正文不许再 inset:0");
});

test("M-07 帧 A：`.m-urlbar` 那 52px 状态栏让位在 pane 里收掉", () => {
  /* 板面原文：`.m-urlbar { padding: 52px 10px 8px }` —— 52px 让的是画出来的
     `.m-statusbar`。产品没有那一格（iOS 上是 `env(safe-area-inset-top)`，
     pane 里是宿主自己的页签条），留着就是 52px 死空间：修前 `.m-urlbar` 高 104px、
     其中 52px 全空；修后 60px（与 `fork-pane-bar` 的 61px 同档）。取值用板面
     这一行自己的下内距 `--nx-sp-2`，横内距 10px / 44px 地址框 / 8px 下内距照旧。 */
  assert.match(pwaSystemCss, /\.m-urlbar \{[^}]*padding: 52px 10px 8px;/);
  assert.match(forms, /\.fork-browser-pane \.m-urlbar \{\s*padding-top: var\(--nx-sp-2\);/);
  // 只改上内距：三边不许被顺手改掉。
  const rule = forms.slice(forms.indexOf(".fork-browser-pane .m-urlbar"), forms.indexOf("}", forms.indexOf(".fork-browser-pane .m-urlbar")));
  assert.doesNotMatch(rule, /padding:\s/, "不许整条 padding 重写（横内距与下内距照板面）");
});

test("M-07 帧 A：缩放条是板面那四件（缩小钮 / 滑杆 / 放大钮 / 徽章），不是六枚芯片", () => {
  /* 板面帧 A：`.m-zoombar` = 缩小钮 + `.m-slider` + 放大钮 + 百分比徽章，
     两颗钮各 44px（`.m-top-btn`）、拇指 26px（`.m-slider`）。产品此前把六档缩放
     摊成六枚 `.m-vp` 文字芯片 + 一枚徽章 —— 同一个 `.m-zoombar` 八个孩子。 */
  const bar = browserCode.slice(browserCode.indexOf('className="m-zoombar"'), browserCode.indexOf('className="m-zoombar"') + 1400);
  assert.match(bar, /className="m-top-btn"[\s\S]*?data-ico="zoom-out"/, "第一件是缩小钮");
  assert.match(bar, /className="m-slider"[\s\S]*?type="range"/, "第二件是滑杆");
  assert.match(bar, /data-ico="zoom-in"/, "第三件是放大钮");
  assert.match(bar, /className="m-badge mute"/, "第四件是百分比徽章");
  assert.doesNotMatch(bar, /className=\{`m-vp/, "缩放档不再摊成一排文字芯片");
  // 滑杆走**档位下标**，不新增一份连续百分比来源：档位表仍是 lib 那七档。
  assert.match(bar, /BROWSER_VIEWPORT_ZOOM_OPTIONS\[zoomIndex - 1\]/);
  assert.match(bar, /BROWSER_VIEWPORT_ZOOM_OPTIONS\[zoomIndex \+ 1\]/);
  assert.match(bar, /BROWSER_VIEWPORT_ZOOM_OPTIONS\[Number\(event\.target\.value\)\]/);
  assert.match(bar, /max=\{BROWSER_VIEWPORT_ZOOM_OPTIONS\.length - 1\}/);
});

test("M-07 帧 D：Git 图谱在 pane 里不再叠第二条顶栏，也不留 108px 让位", () => {
  /* 与 FileExplorer 同一类（`v5-landing-pwa-frames.test.mjs` 已钉过那一条）：
     板面帧 D 画的是**整页**（`.m-fade` + `.m-top` + `.m-settings` 顶 108px 让位），
     而这一支在产品里永远在 M-12 那一层的 pane 里。实测修前：`.m-viewer-bar`
     占 0–107，下面又一条 60px 的 `.m-top`，再加 108px 空白。 */
  assert.doesNotMatch(gitCode, /className="m-top"/, "pane 里不许再画第二条 `.m-top`");
  assert.doesNotMatch(gitCode, /className="m-fade"/, "pane 里不画 `.m-fade`（渐隐顶栏由宿主那一层负责）");
  assert.match(gitCode, /className="fork-git-pane"/);
  assert.match(gitCode, /className="fork-pane-bar"/);
  assert.match(gitCode, /className="m-settings fork-git-body"/);
  assert.match(forms, /\.fork-git-pane \{[\s\S]*?flex: 1 1 auto;[\s\S]*?height: 100%;[\s\S]*?min-height: 0;/);
  // `.m-panel-scroll` 自己的注释就写死了这一条：它等价于 `.m-settings` 去掉顶栏占位。
  assert.match(pwaSystemCss, /\.m-settings \{[^}]*padding: 108px 14px 32px;/);
  assert.match(forms, /\.fork-git-body \{\s*padding-top: var\(--nx-sp-2\);/);
});

test("M-07 / M-08：`.m-vp` / `.m-seg > button` 的板面高度不許被 DSN-04 顶成 36px", () => {
  /* `app/globals.css` 的 DSN-04（≤640px）给每个 `button` 补
     `min-height: var(--control-touch)`（36px）。`min-height` 只压高不碰宽，于是
     板面里**用 height 写死尺寸**的小件一律被顶大：`.m-vp` 28→36、
     `.m-seg > button` 28→36（两块都实测过）。同一块托盘里的 `.m-tray-chip`
     因为自己声明了 `min-height: var(--nx-ctl-xs)` 反而幸免 ——
     「前缀 chip 28 / 分段钮 36」两种高度并排，就是同一个原因的两副面孔。 */
  assert.match(globalsCss, /@media \(max-width: 640px\)[\s\S]*?button,[\s\S]*?min-height: var\(--control-touch\);/);
  assert.match(pwaSystemCss, /\.m-vp \{[^}]*height: var\(--nx-ctl-xs\);/);
  assert.match(pwaSystemCss, /\.m-seg > button \{[^}]*height: var\(--nx-ctl-xs\);/);
  // 还回去的值就是板面自己那一行里的 `var(--nx-ctl-xs)`，一个新值都不加。
  assert.match(forms, /\.m-vp,\s*\.m-seg > button \{\s*min-height: var\(--nx-ctl-xs\);\s*\}/);
});

test("M-07 帧 D：手机上「分支关系」不隐形（行首走桌面同一个 `gitLaneIcon`）", () => {
  /* 帧 D 的四行画的是 `circle-dot` / `git-commit-horizontal` / `git-branch`（分叉于此）/
     `git-merge`。手机这一支此前只按行号分两种（HEAD 一个圆点、其余一条横线），
     于是分叉点与多父提交在手机上永远是隐形的 —— 而判据本来就在手边：
     `commit.parents` + 已加载窗口里的子提交数，`gitLaneIcon` 也已经是纯函数
     （同一份判据，桌面那一版在用）。手机不许另写一套。 */
  assert.match(gitCode, /data-ico=\{gitLaneIcon\(commit, row, childCounts\)\}/);
  assert.match(gitCode, /data-size="16"/);
  assert.doesNotMatch(gitCode, /row === 0 \? "circle-dot" : "git-commit-horizontal"/);
  // 那个纯函数仍在，且四个字形名一字不动（它们都在 `icons.js` 里）。
  const helper = gitGraphTab.slice(0, 6000);
  assert.match(helper, /function gitLaneIcon\([\s\S]*?"circle-dot" \| "git-merge" \| "git-branch" \| "git-commit-horizontal"/);
  assert.match(helper, /if \(commit\.parents\.length > 1\) return "git-merge";/);
  assert.match(helper, /childCounts\.get\(commit\.hash\) \?\? 0\) > 1\) return "git-branch";/);
});

test("M-07 帧 D：手机上只做「看」，改写历史的动作不下放", () => {
  /* 帧 D 的硬判据：「提交 / 推送 / rebase 一个按钮都不下放到手机」。
     PWA 这一支只有：刷新、点提交看它的文件、点文件打开、`data.truncated` 时「加载更多」。 */
  const mobile = gitCode.slice(gitCode.indexOf("if (isMobile) {"));
  assert.doesNotMatch(mobile, /rebase|cherry-pick|reset --hard|"push"|"commit"\s*[,}]/i);
  assert.match(mobile, /className="m-picktag"[\s\S]*?setLimit\(/, "唯一的按钮是「加载更多」");
});

test("M-07 / M-08：这一批不许自造任何 m-* 类（类名只有一个来源）", () => {
  /* 铁律二：`m-*` 只能写在 `design/v5/pwa/system.css`。产品里新出现的接线壳一律
     `fork-*`。这里逐个把本批用到的库类在 system.css 里点一次名。 */
  for (const cls of [
    "m-urlbar", "m-urlbox", "m-viewportbar", "m-vp", "m-sizebox", "m-zoombar",
    "m-slider", "m-top-btn", "m-vbar", "m-menu-row", "m-scroll-y", "m-empty",
    "m-cardgroup", "m-group-title", "m-setrow", "m-badge", "m-banner", "m-pickbar",
    "m-searchfield", "m-tray", "m-tray-chip", "m-seg", "m-rowlabel", "m-sheet-row",
    "m-sheet-row-desc", "m-kbd", "m-sheet",
  ]) {
    assert.match(pwaSystemCss, new RegExp(`\\.${cls.replace("-", "\\-")}[ ,{]`), `.${cls} 必须在库里`);
  }
  // 产品 CSS 里出现新造的 `m-*` 选择器就是铁律二被绕过。这里只管**选择器首部**
  // 是不是 `m-*` —— 已有的接线层规则（`.m-panel-scroll .m-vbar`、`.m-row-m` 等）
  // 列在白名单里，其余任何一行 `.m-xxx` 都是新起的。
  const allowed = [".m-panel-scroll", ".m-row-m", ".m-vp", ".m-seg"];
  for (const line of forms.split("\n")) {
    const m = line.match(/^(\.[a-z][a-z0-9-]*(?:[ >:+~.][^{]*)?)\{/);
    if (!m) continue;
    const sel = m[1].trim();
    if (!/^\.m-/.test(sel)) continue;
    if (allowed.some((a) => sel === a || sel.startsWith(`${a} `) || sel.startsWith(`${a} >`) || sel.startsWith(`${a}.`))) continue;
    assert.fail(`接线层不许新起 .m-* 类：${sel}（新壳一律 fork-*）`);
  }
});

test("M-07 帧 C / M-08 帧 B：命令中心的分段与前缀 chip 仍是板面那套行", () => {
  /* 帧 C 的硬判据：「三类结果在一个底部面板里排」「分段永远是 全部/命令/会话/文件
     （「全部」在最前）」。这三个前缀是**同一套行的三种筛选**，所以行类只能有一个。 */
  assert.match(commandPalette, /className="m-tray"/);
  assert.match(commandPalette, /className=\{`m-tray-chip\$\{scope === entry\.scope \? " is-on" : ""\}`\}/);
  assert.match(commandPalette, /className="m-seg"/);
  assert.match(commandPalette, /className=\{scope === entry\.scope \? "is-on" : ""\}/);
  // 行只有一种：分段视图与「全部」视图走同一个 `m-sheet-row` + `m-sheet-row-desc`。
  assert.match(commandPalette, /className=\{`m-sheet-row\$\{index === active \? " is-on" : ""\}`\}/);
  assert.match(commandPalette, /className="m-sheet-row-desc"/);
  // 底部键位条（帧 A-2 / B / C 的 `.m-pickbar` 内容）仍在。
  assert.match(commandPalette, /className="m-kbd"/);
  // 弹层不是新页面：走 `PwaComposerSheet` 的 `.m-sheet` + `.m-scrim`。
  assert.match(commandPalette, /<PwaComposerSheet/);
});

test("M-08 帧 A-2：「最近搜索」在第一屏，且不与结果共用同一个下标空间", () => {
  /* 帧 A 的硬要求：「打开后第一屏先给最近搜索与快捷入口」。这一组此前画在
     `rows.length === 0` 那一支里，而命令表（`SETTINGS_SECTIONS` 全量）恒非空 ⇒
     真机上从未出现过。更糟的是历史行的 `setActive(index)` 写的是**结果列表**的
     下标：悬停第 2 条历史会点亮第 2 条结果、回车打开的也是它。
     现在手机静息态把两组接成一张表：`historyOffset` 是历史占掉的长度，
     `active` 在 `[历史 … 结果]` 这一个下标空间里走。桌面那一支不动（D-22 不在本轮范围）。 */
  assert.match(commandPalette, /const historyVisible = isMobile && !trimmed && history\.length > 0;/);
  assert.match(commandPalette, /const historyOffset = historyVisible \? history\.length : 0;/);
  assert.match(commandPalette, /const navigableLength = historyOffset \+ rows\.length;/);
  // 历史组在结果**之前**，且不再被 `rows.length === 0` 包着。
  const mobile = commandPalette.slice(commandPalette.indexOf("if (isMobile) {"));
  const historyAt = mobile.indexOf("{historyVisible && (");
  const rowsAt = mobile.indexOf("rows.length === 0 ? (");
  assert.ok(historyAt > 0 && rowsAt > historyAt, "最近搜索那一组必须在结果之前");
  // 行内下标全部加了偏移，游标才落在同一张表上。
  assert.match(mobile, /className=\{`m-sheet-row\$\{historyOffset \+ index === active \? " is-on" : ""\}`\}/);
  assert.match(mobile, /onMouseEnter=\{\(\) => setActive\(historyOffset \+ index\)\}/);
  assert.match(mobile, /onClick=\{\(\) => pick\(index\)\}/, "结果行的点击仍用结果自己的下标");
  // 分组标题的判据必须留在**结果自己的下标**里：`rows[index - 1]` 只在
  // `index === 0` 短路之后才取。曾经写成 `historyOffset + index === 0`，
  // 历史组一出现短路就失效 → `rows[-1].kind` 抛 TypeError → 整棵根布局崩进
  // `error.tsx`（实测：任何非空历史 + 打开面板 = 必崩）。这条钉住。
  assert.match(mobile, /\{\(index === 0 \|\| rows\[index - 1\]\.kind !== row\.kind\) && \(/);
  assert.doesNotMatch(mobile, /historyOffset \+ index === 0 \|\|/);
  // 组标题：历史那行照帧 A-2 写「标签 · 条数」。
  assert.match(mobile, /className="m-rowlabel">\{`\$\{t\("palette\.recent"\)\} · \$\{history\.length\}`\}/);
  // 行结构照帧 A-2：`clock` 图标 + 等宽标题（带前缀）+ `.m-sheet-row-desc`。
  assert.match(mobile, /data-ico="clock"/);
  assert.match(mobile, /className="m-setrow-t m-mono"/);
});
