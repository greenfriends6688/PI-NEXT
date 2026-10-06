// M-09 / M-10 / M-11 逐帧落地的源码守卫（2026-10-06 · fork:v5-pwa-m0911）
//
// 这一批与同目录另外两个守卫分工不同：
//   · `v5-landing-e4.test.mjs`      守「类名存在 / 形态不串味」（拼写级）
//   · `v5-landing-pwa-frames.test.mjs` 守 M-01/M-02/M-05/M-12 的**已修 bug 不回归**
//   · 本文件                          守 M-09/M-10/M-11 这一批的**几何与规格**，
//     并且每条断言都指明画板哪一帧的哪一行。
//
// 为什么这些断言长这样（不是「源码里出现过某个字符串」这种弱判定）：
// 2026-10-06 逐帧用真浏览器量板面与产品的 computed style，发现
// `land-status` 报 99%、`check-v5` 全绿、单测全绿，但产品**仍然不像板面** ——
// 类名全在、几何全错。所以这里的每一条都写成「会算错的那一格」：
// 令牌值、伪元素归属、以及板面原文里那段 DOM 的存在性。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");

const pwaSystem = await read("design/v5/pwa/system.css");
const pwaTokens = await read("design/v5/pwa/tokens.css");
const forms = await read("app/design/v5-forms.css");
const pwaSettings = await read("app/pwa-settings.css");
const automation = await read("components/fork/AutomationPanel.tsx");
const usage = await read("components/fork/UsageStatsPanel.tsx");
const providerUsage = await read("components/ProviderUsageSummary.tsx");
const installPrompt = await read("components/fork/InstallPromptBanner.tsx");
const trustSheet = await read("components/pwa/PwaTrustSheet.tsx");
const gestures = await read("components/pwa/MobileGestures.tsx");
const errorStates = await read("components/pwa/ErrorStates.tsx");
const appError = await read("app/error.tsx");
const globalError = await read("app/global-error.tsx");
const boards = {
  m09: await read("design/v5/pwa/boards/M-09-store-cron-usage.html"),
  m10: await read("design/v5/pwa/boards/M-10-install-update-trust.html"),
  m11: await read("design/v5/pwa/boards/M-11-gestures-states.html"),
};
// 这三个在下面几条断言里要用，先读出来（测试回调里不能 await）。
const appShell = await read("components/AppShell.tsx");
const fileExplorer = await read("components/FileExplorer.tsx");
const sessionMenu = await read("components/fork/SessionActionsMenu.tsx");
const phonePush = await read("components/fork/PhoneAndPushPanel.tsx");
const charts = await read("components/fork/usage-charts.tsx");
const dirPicker = await read("components/pwa/PwaDirectoryPicker.tsx");

/* ═══════════════════════════════════════════════════════════════════════════
 * 一 · M-11 帧 C / D 的规格：**触控下限 44 / 48 / 56 是不是真的**
 *
 * 帧 C 是规格表不是界面，它的判据写成一句话：「44px 是命中区，不是视觉高度。
 * 一个 28px 的小钮可以四周补 padding 凑到 44，但它自己永远不许小于 44」。
 * 所以断言要分两层：**盒子**回板面、**命中区**达 44。
 * ═══════════════════════════════════════════════════════════════════════════ */

test("M-11 帧 C：`.m-switch` 的盒子回板面 29px，命中区仍达 44", () => {
  /* 板面原文（`pwa/system.css` §6 表单）：`.m-switch` 是**写死 height: 29px**
     的小件。29 不是任何一枚 `--nx-ctl-*`（28/36/44），所以修法只能「撤
     min-height 让库那条 height 生效」，不能改写成令牌值。 */
  assert.match(
    pwaSystem,
    /\.m-switch \{ width: 48px; height: 29px;[^}]*position: relative;/,
    "库里的 `.m-switch` 必须仍是写死的 29px（帧 C 的 44 档说的是命中区，不是盒子）",
  );
  assert.match(pwaTokens, /--nx-touch-min: 44px;/, "PWA 档的触控下限必须仍是 44px");

  /* 根因：`app/globals.css` 的 DSN-04 在 ≤640px 给每个 `button` 补
     `min-height: var(--control-touch)`，而本仓 `--control-touch` = 36px。
     `min-height` 只压高不碰宽 —— 于是这枚 48×29 的开关在手机上变成 48×36。
     接线层必须把它撤掉（只给 `<button>`；`PwaSwitchRow` 那枚是
     `<span aria-hidden>`，行本体 `.m-setrow` 已经 44，不该跟着改）。 */
  /* 这一段住在 `app/pwa-settings.css`（手机档分区补丁），不在 `v5-forms.css`：
     2026-10-06 实测那一段的最后一块在 `v5-forms.css` 里**根本没进产物**（PostCSS
     把一个嵌套注释当成了语法错误，规则连同整段一起丢），而放这里既稳、语义也对 ——
     这枚开关只出现在设置里的两个分节（定时任务 / 手机与推送）。 */
  assert.match(
    pwaSettings,
    /@media \(max-width: 640px\) \{[\s\S]*?button\.m-switch,[\s\S]*?span\.d-switch \{[\s\S]*?min-height: 0;/,
    "≤640px 必须撤掉 DSN-04 补在 `button.m-switch` 上的 min-height（否则盒子是 36 不是板面的 29）",
  );

  /* 命中区外扩只能用 `::before`：`.m-switch::after` 已经被库占用（那是 24×24
     的圆钮，`system.css:456`）。抢 `::after` 会把滑块抹掉 —— 这是这条修复
     最容易写错的一格，所以单独断言。 */
  assert.match(
    pwaSystem,
    /\.m-switch::after \{ content: ""; position: absolute; top: 2\.5px; left: 2\.5px; width: 24px; height: 24px;/,
    "滑块那一格必须仍是 `::after`（守卫测试据此判断接线层有没有抢错伪元素）",
  );
  /* 命中区外扩**已撤**（2026-10-06 用户实拍）：`::before` 那一半从头到尾没量到
     过真实命中数，却在技能页里把开关画坏了（一个 ~40px 的灰圆压在「85/87」计数器上，
     开关本身也偏出行的右缘）。等价约束改成两条：
       ① 盒子必须是板面的 48×29（这一半是验过的，保留）；
       ② `::before` 不许回来。
     要补命中区，正确落点是让**整行**成为开关的点击目标，不是给 29px 的小件
     套一个 44px 的透明盒。 */
  // 两种标签都要覆盖：分组总开关是 `<span class="m-switch">`，只写 button 会漏掉它
  // （2026-10-06 用户实拍：那一枚渲染成灰圆压在「85/87」上）。
  assert.match(pwaSettings, /button\.m-switch,\s*\n\s*span\.m-switch,\s*\n\s*button\.d-switch,\s*\n\s*span\.d-switch \{[\s\S]*?min-height: 0;/);
  assert.doesNotMatch(
    pwaSettings,
    /\.m-switch::before/,
    "开关的 `::before` 命中区外扩已撤 —— 它会破坏开关本身的渲染，不要加回来",
  );
  assert.doesNotMatch(
    forms,
    /button\.m-switch::after \{/,
    "接线层不许改写 `.m-switch::after` —— 那是库的滑块",
  );
});

test("M-11 帧 C：三档触控类真的在库里，且没有第四档", () => {
  for (const [cls, expr] of [
    ["m-touch-44", "min-width: var(--nx-touch-min); min-height: var(--nx-touch-min);"],
    ["m-touch-48", "min-width: var(--nx-ctl-lg); min-height: var(--nx-ctl-lg);"],
    ["m-touch-56", "min-width: calc(var(--nx-ctl-lg) + var(--nx-sp-2)); min-height: calc(var(--nx-ctl-lg) + var(--nx-sp-2));"],
  ]) {
    assert.ok(
      pwaSystem.includes(`.${cls} { ${expr} }`),
      `.${cls} 必须与帧 C 那一行同值（${expr}）`,
    );
  }
  // 帧 C 说「密集相邻时还要再加 8px 间距」—— `.m-cats.compact` 的 chip 档就是这一格。
  assert.match(
    pwaSystem,
    /\.m-cats\.compact \.m-cat \{[^}]*height: var\(--nx-touch-min\); min-width: var\(--nx-touch-min\);/,
    "六项横滚切换条是主导航，chip 必须达 44（帧 C 的 44 档）",
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 二 · M-09 三帧（商店 / 定时 / 用量）
 * ═══════════════════════════════════════════════════════════════════════════ */

test("M-09 帧 B：定时卡的 DOM 是板面那一段，且开关挂在卡头末位", () => {
  /* 板面帧 B 的 `.m-croncard-head` 原文顺序：图标 › `.m-setrow-body`（名字 / 目录）
     › `.m-badge`（调度档）› `.m-switch`。产品照抄，顺序不能变。 */
  const headStart = automation.indexOf('<div className="m-croncard-head">');
  assert.ok(headStart > 0, "缺 `.m-croncard-head`");
  const head = automation.slice(headStart, automation.indexOf("</div>\n              <div className=\"m-cronhist\">", headStart));
  const order = ["data-ico", "m-setrow-body", "m-badge", "m-switch"].map((token) => head.indexOf(token));
  assert.ok(
    order.every((index) => index >= 0) && order.every((index, i) => i === 0 || index > order[i - 1]),
    `卡头顺序必须与板面一致（图标 › 名字 › 徽章 › 开关），实测 ${JSON.stringify(order)}`,
  );
  // 「只回答两件事」：`.m-cronhist` 里既有上次成没成（`.m-dot` + `.m-err`），也有下次什么时候。
  assert.match(automation, /<div className="m-cronhist">/);
  assert.match(automation, /className=\{`m-dot \$\{runDot\(run\.status\)\}`\}/);
  assert.match(automation, /run\.status === "error" \? "m-err" : undefined/);
  assert.match(automation, /t\("automation\.nextRun"\)/);
});

test("M-09 帧 C：热力图按周排（18 列 × 7 行）、柱状按日排，两者接同一份 days", () => {
  /* 帧 C 的判据是「热力图按周排、柱状按日排，两者同源」。库里的 `.m-heat` 是
     `repeat(18, 1fr)` —— 18 **列** = 18 周，所以行必须是星期、列必须是周。 */
  assert.match(pwaSystem, /\.m-heat \{ display: grid; grid-template-columns: repeat\(18, 1fr\);/);
  assert.match(charts, /const MOBILE_HEAT_COLUMNS = 18;\nconst MOBILE_HEAT_ROWS = 7;/);
  /* 按周排的算法：格子序号 = column * ROWS + row（列优先 = 一列是一周）。 */
  assert.match(charts, /const index = column \* MOBILE_HEAT_ROWS \+ row - windowLead;/);
  /* 柱状是按天的：直接遍历 days（不是 18 周窗口）。 */
  assert.match(charts, /<span className="m-bars" role="img" aria-label=\{label\}>\s*\n\s*\{days\.map/);
  /* 三块图读同一个 summary.days —— 「同源」这条不许退化成各拉各的。 */
  assert.match(usage, /<UsageDailyBars days=\{summary\.days\}/);
  assert.match(usage, /<UsageHeatmap\s*\n\s*days=\{heatmapDays\}/);
});

test("M-09 帧 D：`.m-card` / `.m-statgrid` / `.m-bar` 三件有活宿主（不是死代码）", () => {
  /* 帧 D 是「通用卡 / 统计格 / 用量条」。2026-10-06 逐帧时发现
     `components/fork/ProviderUsageCards.tsx` 里也有一套同名 DOM，但那个组件
     **当前源码零引用**（只有 release/ 打包产物还在 import）—— 也就是说
     `.m-card` + `.m-statgrid` 若只挂在它上面，帧 D 在产品里根本到不了。
     活宿主是 `ProviderUsageSummary`（模型 › 供应商 › 用量摘要），必须三件都在。 */
  assert.match(
    providerUsage,
    /<div className="m-card">\s*\n\s*<div className="m-card-head">/,
    "帧 D 的通用卡必须在活宿主里（`.m-card` › `.m-card-head`）",
  );
  assert.match(providerUsage, /<div className="m-card-body">/);
  assert.match(providerUsage, /<div className="m-statgrid">/);
  assert.match(providerUsage, /className="m-stat"/);
  assert.match(providerUsage, /<span className="m-bar">/);
  // 库侧：两列（帧 C/D 都写了「手机上两列，四列每格不到 85px 数字会折行」）。
  assert.match(
    pwaSystem,
    /\.m-statgrid \{ display: grid; grid-template-columns: repeat\(2, 1fr\);/,
    "统计格在 PWA 档必须是两列（帧 D 的原话）",
  );
  assert.match(pwaSystem, /\.m-bar > i \{ display: block; height: 100%;/);
  // 帧 D 的用量条夹在 `.m-setrow-body` 里（名字 → 条 → 一行口径），不是独立行。
  assert.match(providerUsage, /m-setrow-body[\s\S]{0,400}?<span className="m-bar">/);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 三 · M-10 四帧（安装 / 更新离线 / 目录信任 / 首启）
 * ═══════════════════════════════════════════════════════════════════════════ */

test("M-10 帧 A：安装提示分平台，iOS 那条不许画假的「一键安装」", () => {
  /* 帧 A 的三条纪律：Android 握到 `beforeinstallprompt` 才给主按钮；
     iOS 一条话都不给按钮（只教「分享 → 添加到主屏幕」）；
     桌面入口在工具栏，**不许**在手机提示里写桌面平台。 */
  assert.match(installPrompt, /window\.addEventListener\("beforeinstallprompt", onPrompt\)/);
  assert.match(installPrompt, /const isIos = \/iphone\|ipod\/i\.test\(navigator\.userAgent\);/);
  // 有安装事件才给主按钮；iOS 分支只出 share-2 图标 + 一句话，**不给按钮**。
  const androidArm = installPrompt.slice(
    installPrompt.indexOf("{deferred ? ("),
    installPrompt.indexOf('data-ico="share-2"'),
  );
  assert.match(androidArm, /m-touch-48/, "Android 分支那枚主按钮按 M-11 帧 C 的 48 档（一级行动钮）");
  assert.match(androidArm, /installButton/);
  const iosArm = installPrompt.slice(
    installPrompt.indexOf('data-ico="share-2"'),
    installPrompt.indexOf("        )}\n        <button type=\"button\" className=\"m-iconbtn"),
  );
  assert.doesNotMatch(iosArm, /<button/, "iOS 分支不许给按钮（M-10 帧 A-1：没有一键安装这个能力）");
  assert.match(iosArm, /install\.iosBody/);
  assert.doesNotMatch(installPrompt, /install\.desktop/);
});

test("M-10 帧 B：更新浮条与断网条写清代价，且是兄弟（兄弟选择器才生效）", () => {
  /* 帧 B-2：断网条只写两行 —— 第一行状态、第二行代价。 */
  assert.match(installPrompt, /<div>\{copyOf\(OFFLINE_STATE, locale\)\}<\/div>/);
  assert.match(installPrompt, /<div>\{copyOf\(OFFLINE_COST, locale\)\}<\/div>/);
  assert.match(installPrompt, /"发送会排队，联网后自动续跑"/);
  /* 帧 B-1：更新浮条 = 图标 + `.m-setrow-body`（标题 + 代价）+ `.m-branch`「稍后」。
     「稍后」不是「关掉」，所以它只置本次会话的 deferred，不写 localStorage。 */
  assert.match(installPrompt, /<div className="m-update" role="status"/);
  assert.match(installPrompt, /className="m-branch" onClick=\{\(\) => setDeferred\(true\)\}/);
  assert.doesNotMatch(
    installPrompt,
    /setDeferred\(true\)[^;]*;[\s\S]{0,120}?localStorage/,
    "「稍后」只推迟不持久化 —— 写 localStorage 就变成「关掉」了（帧 B-1 原话）",
  );
  /* 兄弟关系：库里靠 `.m-offline ~ .m-trust { top: 30px }` 把信任条落到断网条下面，
     两者之间不许再包一层（那会让 `~` 失配，两条横幅叠在一起）。 */
  assert.match(pwaSystem, /\.m-offline ~ \.m-trust \{ top: 30px; \}/);
  assert.match(
    appShell,
    /\{isMobile && <PwaOfflineBanner \/>\}\s*\n\s*\{isMobile && renderProjectTrustWarning\(true\)\}/,
    "断网条与信任条必须挨着当兄弟，否则 `.m-offline ~ .m-trust` 失配、两条横幅叠在一起",
  );
  /* Toast 与更新条只差 12px，必须有抬升修饰（M-11 帧 E 注脚）。 */
  assert.match(pwaSystem, /\.m-toast\.above \{ bottom: calc\(168px \+ env\(safe-area-inset-bottom, 0px\)\); \}/);
});

test("M-10 帧 C：信任是常驻条（目录状态），就地询问是另一件事", () => {
  /* 帧 C 的核心判据：横幅标的是**目录状态**，就地 `.m-perm` 标的是**这一次动作**。
     两件必须是两个类，不许合并。 */
  assert.match(trustSheet, /className="m-trust"/);
  assert.match(trustSheet, /data-mobile-trust-banner="true"/);
  assert.match(trustSheet, /role=\{error \? "alert" : "status"\}/);
  // 就地询问（帧 C-1 那块 `.m-perm`）在目录选择器里，不在本文件 —— 这里只锁库类。
  assert.match(pwaSystem, /\.m-perm \{ border: 1px solid color-mix\(in srgb, var\(--nx-warning\) 40%, transparent\);/);
  assert.match(
    dirPicker,
    /<div className="m-perm" key=\{entry\.path\} role="alert">/,
    "就地询问必须用 `.m-perm`，且它与常驻的 `.m-trust` 是两件（帧 C：横幅管目录状态，就地询问管这一次）",
  );
  /* 帧 C-2 的三选项里「哪三类动作永远不放行」在产品里没有对应数据面 → 不画。
     守卫的是**别偷偷画上去**（画上去就是画死控件）。 */
  assert.doesNotMatch(trustSheet, /永不信任|neverTrust|trustForever/);
});

test("M-10 帧 D：首启是三步、三步各带开关，且关掉也能继续用", () => {
  /* 帧 D 的判据写得很硬：「三步、三步各带开关」+「首启不许把人挡在一屏说明前面」。
     `m-step-card` 三张 + 每张一个 `.m-switch`（`PwaSwitchRow` 是 `.m-setrow[role=switch]`）。 */
  const onboard = phonePush;
  assert.match(pwaSystem, /\.m-step-card \{ background: var\(--nx-panel\);/);
  assert.match(pwaSystem, /\.m-step-dot-lg \{ width: 26px; height: 26px;/);
  assert.match(onboard, /bodyClass="m-onboard"/);
  assert.match(onboard, /className="m-step-card"/);
  // `.m-onboard` 是首启那一屏的**滚动容器**，不是普通 `.m-settings`：
  // 它自己带 96px 顶让位，PwaPage 不再套 `.m-settings`。
  assert.match(pwaSystem, /\.m-onboard \{ flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 96px 22px 30px;/);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 四 · M-11 帧 A / B / E / F（能落地的部分）
 * ═══════════════════════════════════════════════════════════════════════════ */

test("M-11 帧 A：下拉三档由位置表达，侧滑只占左缘 28px", () => {
  /* 帧 A-1：三档（提示 / 到位 / 执行）只换图标不换位置。 */
  assert.match(gestures, /const PULL_ARM_PX = 24;/);
  assert.match(gestures, /export const PULL_TRIGGER_PX = 64;/);
  assert.match(gestures, /armed = scroller\.scrollTop <= 0;/, "「已经在顶才拉」是硬规则");
  assert.match(
    gestures,
    /busy \? "loader-circle" : pull >= PULL_ARM_PX \? "refresh-cw" : "arrow-down"/,
    "三档各换一次图标（帧 A-1 的三句话）",
  );
  assert.match(gestures, /style=\{\{ transform: `translateY\(\$\{pull\}px\)` \}\}/, "指示器跟着手指走（位置即状态）");
  /* 帧 A-2：只占左缘 28px。 */
  assert.match(pwaSystem, /\.m-swipe \{ position: absolute; left: 0; top: 0; bottom: 0; width: 28px;/);
  assert.match(gestures, /className=\{`m-swipe-hint\$\{hintOpen \? " is-open" : ""\}`\}/);
  assert.match(pwaSystem, /\.m-swipe:active \.m-swipe-edge \{ opacity: \.6; \}/);
});

test("M-11 帧 B：文件行长按走 `.m-menu-sheet`（会话行那条是登记在案的偏离）", () => {
  /* 帧 B-2：文件行长按 = 同一形态、不同条目。文件树确实发了 `.m-menu-sheet`。 */
  assert.match(fileExplorer, /className="m-menu-sheet is-open"/);
  assert.match(fileExplorer, /<div className="m-menu-sheet-title">\{contextMenu\.name\}<\/div>/);
  assert.match(fileExplorer, /className="m-menu-row"/);
  /* 帧 B-1 的会话行 12 项 / 3 段：条目清单照抄，但壳是 `.m-pop-float`（M-04 帧 C）
     —— 这条偏离写在 `ContextMenu.tsx` 的文件头注记里，守卫的是「12 项 3 段不许漂」。 */
  assert.equal((sessionMenu.match(/\{ type: "separator" \}/g) ?? []).length, 3, "会话菜单必须是 3 段");
  assert.equal(
    (sessionMenu.match(/^\s+label: t\(/gm) ?? []).length >= 12,
    true,
    "会话菜单必须 12 项（帧 B-1：置顶·重命名·归档·标记未读 ‖ 四项 ‖ 两项 ‖ 两项）",
  );
  assert.doesNotMatch(sessionMenu, /shareLink|复制分享链接/, "帧 B-1：不含「复制分享链接」");
});

test("M-11 帧 E：四种反馈各归各位，`.m-toast` 4 秒自退", () => {
  assert.match(pwaSystem, /\.m-banner \{ display: flex; align-items: center; gap: 8px;/);
  assert.match(pwaSystem, /\.m-perm \{/);
  assert.match(pwaSystem, /\.m-run \{ display: flex; align-items: center; gap: 8px;/);
  assert.match(pwaSystem, /\.m-run > i:first-child \{ animation: nx-spin 1400ms linear infinite; \}/);
  assert.match(pwaSystem, /\.m-toast \{ position: absolute; left: 50%;/);
  /* Toast 只确认已经发生的事，不放按钮 —— 产品那条也真的只是个 span。 */
  const toastBlock = appShell.slice(
    appShell.indexOf('className={isMobile ? "m-toast"'),
    appShell.indexOf("</div>\n    ) : null}", appShell.indexOf('className={isMobile ? "m-toast"')),
  );
  assert.doesNotMatch(toastBlock, /<button/, "`.m-toast` 里不许出现按钮（帧 E：需要回答的事就该待在原地等你）");
  assert.match(appShell, /setToast\(null\), 3000\)/, "Toast 3s 自退（M-11 帧 D ⑦ 与帧 E 同值）");
});

test("M-11 帧 F：两级错误页都必须给「重试」，根级不许用 m-* 类", () => {
  /* 帧 F-1（段级，带主题 token）：`.m-empty` 四件 + `.m-code`（digest）+ 两颗钮。 */
  assert.match(errorStates, /className="m-empty" role="alert"/);
  assert.match(errorStates, /className="m-empty-ico" style=\{\{ color: "var\(--nx-danger\)" \}\}/);
  assert.match(errorStates, /<div className="m-code" style=\{\{ width: "100%" \}\}>/);
  assert.match(errorStates, /className="m-code-head"/);
  assert.match(errorStates, /className="m-code-body m-mono"/);
  assert.match(errorStates, /const touch = action\.variant === "primary" \? "m-touch-48" : "m-touch-44";/);
  /* 段级宿主真的给它两枚动作（含重试）。 */
  assert.match(appError, /\{ key: "retry", label: t\("error\.boundaryRetry"\), icon: "rotate-cw", variant: "primary"/);
  assert.match(appError, /\{ key: "reload", label: t\("error\.boundaryReload"\), icon: "refresh-cw"/);
  /* 帧 F-2（根级）：这一层不接全局样式，所以**不许**换 m-* 类 —— 用它们渲染错误页
     等于用可能正是出问题的那套东西去渲染错误页。这条不许被「顺手统一」掉。 */
  assert.doesNotMatch(globalError, /className="m-/, "global-error 不许用 m-* 类（帧 F-2 的原话）");
  assert.match(globalError, /minHeight: 44/, "根级那两颗钮仍然要 44 命中");
  assert.match(globalError, /应用启动失败 \/ Failed to start/);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 五 · 板面原文仍在（画板是唯一通道，别让它悄悄被改）
 * ═══════════════════════════════════════════════════════════════════════════ */

test("板面原文仍在：这一批断言引用的每一段 DOM 都还写在画板上", () => {
  for (const [name, html, needles] of [
    ["M-09", boards.m09, ['class="m-croncard"', 'class="m-croncard-head"', 'class="m-cronhist"', 'class="m-heat"', 'class="m-bars"', 'class="m-statgrid"', 'class="m-bar"', 'class="m-storecard"']],
    ["M-10", boards.m10, ['class="m-update"', 'class="m-offline"', 'class="m-trust"', 'class="m-onboard"', 'class="m-step-card"']],
    ["M-11", boards.m11, ['class="m-pull"', 'class="m-swipe"', 'class="m-menu-sheet"', 'class="m-touch-44"', 'class="m-touch-48"', 'class="m-touch-56"', 'class="m-banner"', 'class="m-perm"', 'class="m-run"', 'class="m-toast"']],
  ]) {
    for (const needle of needles) {
      assert.ok(html.includes(needle), `${name} 板上找不到 ${needle} —— 画板被改了，先对画板`);
    }
  }
  // 帧 C 的三档方块用的是那三个类（板面注记里说「落地时建议补成三个类，让规格与实现同源」，
  // 已经补了），所以规格与实现真的是同一份 —— 这条就是那条建议的守卫。
  for (const cls of ["m-touch-44", "m-touch-48", "m-touch-56"]) {
    assert.ok(boards.m11.includes(`class="${cls}"`), `帧 C 的三档方块应当已用 .${cls}（规格与实现同源）`);
  }
  assert.ok(boards.m11.includes("--nx-touch-min"), "帧 C 仍声明三档与 `--nx-touch-min` / `--nx-ctl-lg` 一一对应");
});