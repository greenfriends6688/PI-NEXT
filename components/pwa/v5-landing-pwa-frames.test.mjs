// PWA 逐帧落地（M-01 A / M-03 A / M-05 A / M-12 A，2026-10-06 · fork:v5-pwa-frames）
//
// 这四条都是**几何与形状**的守卫，不是拼写守卫。2026-10-06 逐帧量板面与产品时
// 才发现：类名早就在 system.css 里、land-status 报 99%，但产品仍然「不像板面」——
// 四个根因每一个都能静默回归，所以每一条都钉在**会算错的那一格**上。
//
// 钉法说明：这一波之前，板面与产品的偏差全靠人眼比截图。截图只能存证，
// 不能当门禁 —— 所以这里的断言都写成「板面值出现在产品、且只出现在该出现的那一支」。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const appShell = read("components/AppShell.tsx");
const chatWindow = read("components/ChatWindow.tsx");
const chatInput = read("components/ChatInput.tsx");
const settingsPanel = read("components/SettingsPanel.tsx");
const settingsCss = read("app/settings.css");
const pwaSystemCss = read("design/v5/pwa/system.css");
const explorerPanel = read("components/ExplorerPanel.tsx");
const rightPanelsMobile = read("components/pwa/RightPanelsMobile.tsx");

test("M-01 A / M-02 A~C：横向内距归 `.m-scroll` 一处，产品不许再把它清零", () => {
  // 板面原文：`.m-scroll { padding: 108px 18px 140px }` —— 那 18px 就是横向留白。
  assert.match(pwaSystemCss, /\.m-scroll \{[^}]*padding: 108px 18px 140px;/);
  // 产品这一层被内联 `paddingLeft: 0` 打掉过一次：转录顶到屏幕边，17px 正文满宽，
  // 看着比板面大一圈。清零只准留在桌面那一支（`isPwa` 的 false 分支）。
  assert.match(
    chatWindow,
    /isPwa\s*\n\s*\? \{ visibility: pendingScrollRestore \? "hidden" : undefined \}\s*\n\s*: \{ visibility: pendingScrollRestore \? "hidden" : undefined, paddingLeft: 0, paddingRight: 0 \}/,
    "窄屏滚动区不得清零横向内距（板面是 18px）",
  );
  // 另一支：`.d-chat-inner` 在 PWA 下必须是 padding 0，否则与上面那份叠成 34px。
  assert.match(chatWindow, /style=\{isPwa\s*\n\s*\? \{ maxWidth: CHAT_COLUMN_MAX_WIDTH, padding: 0 \}/);
});

test("M-03 A：`.m-composer-wrap` 只有一层，且窄屏 fieldset 不再垫第二份内距", () => {
  // 板面里这一类只有一个（ChatInput 那一枚，直接托着 `.m-composer`）。产品此前
  // ChatWindow 的定位层也挂了同名，两份 `padding: 0 12px 12px` 叠成 24px，再叠
  // fieldset 的 16px —— 输入卡从板面的 366px 缩到 310px。
  assert.equal((chatInput.match(/className="m-composer-wrap"/g) ?? []).length, 1);
  assert.doesNotMatch(
    chatWindow,
    /isPwa \? "m-composer-wrap"/,
    "ChatWindow 不能再挂 `.m-composer-wrap`：它只是定位层（fork-composer-anchor）",
  );
  assert.match(chatWindow, /isPwa \? "fork-composer-anchor" : "d-composer-wrap relative shrink-0"/);
  assert.match(chatInput, /padding: compact \|\| isMobile \? 0 : "0 16px 8px"/);
});

test("M-05 A：手机设置是整页，不是缩一圈的弹窗；顶栏出口在左、搜设置项在右", () => {
  // 桌面弹窗值（12px 内缩 + 2xl 圆角 + 边 + 投影）不得漏到窄屏。
  const mobileBlock = settingsCss.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/);
  assert.ok(mobileBlock, "settings.css 缺窄屏块");
  const mobile = mobileBlock[0];
  assert.match(mobile, /\.settings-dialog-surface \{[\s\S]*?width: 100vw;[\s\S]*?height: 100dvh;/);
  assert.match(mobile, /\.settings-dialog-surface \{[\s\S]*?border: 0;[\s\S]*?border-radius: 0 !important;[\s\S]*?box-shadow: none !important;/);
  // 帧 A 的 `.m-pop-float`：`.m-doc-label` 当输入框 + 每个命中一行 `.m-menu-row`。
  assert.match(settingsPanel, /className="m-pop-float is-open fork-settings-find"[\s\S]*?className="m-doc-label"/);
  assert.match(settingsPanel, /className="m-menu-row"/);
  assert.doesNotMatch(settingsPanel, /translate\("files\.showPanel"\)/);
});

test("M-12 A：六块常驻，一块一行，不按已打开的页签数增减", () => {
  // 板面六行：轨迹 / 文件 / 终端 / 浏览器 / Git / 审查。
  // 产品此前以 `panelTabs` 为准（开着什么列什么），手机上常常只剩两行 ——
  // 「六项常驻」写在选单脚注上，行却不到六块。
  for (const key of [
    "TRACE_TAB_ID", "FILE_PANEL_TAB_ID", "TERMINAL_BLOCK_KEY",
    "BROWSER_BLOCK_KEY", "GIT_GRAPH_TAB_ID", "REVIEW_BLOCK_KEY",
  ]) {
    assert.match(appShell, new RegExp(`const ${key} = "`), `缺块 key ${key}`);
  }
  assert.doesNotMatch(
    appShell,
    /items\.push\(\.\.\.panelTabs\.map/,
    "M-12 选单不再以 panelTabs 为准 —— 那让行数随页签漂移",
  );
  // 六块都进得来：每一块都要有 onSelect（开着的切过去、没开的先开）。
  assert.equal((appShell.match(/onSelect: /g) ?? []).length >= 6, true);
  // 六枚图标字形名必须在图标库里真的存在 —— 不存在的名字 hydrate 时**不报错**，
  // 只是画不出东西，于是那一格是个空的圆按钮（实测「调用轨迹」那一枚：icon 写的是
  // `route`，库里没有；`check-v5` 与所有单测都绿，因为那是「拼写对、看着空」）。
  const icons = read("design/pi-web-design/assets/icons.js");
  const block = appShell.slice(
    appShell.indexOf("const mobileRightPanelItems"),
    appShell.indexOf("renderTabContentRef.current = renderTabContent"),
  );
  assert.ok(block.length > 0, "取不到 mobileRightPanelItems 那段源码");
  for (const [, icon] of block.matchAll(/icon: "([a-z0-9-]+)"/g)) {
    assert.match(icons, new RegExp(`"${icon}"\\s*:`), `图标库里没有 ${icon}（那一格会画成空圆）`);
  }
  // 「审查」与 M-06 帧 E 同一入口：树里那一节，靠 signal 展开，不另画一块正文。
  assert.match(explorerPanel, /openChangesSignal\?: number;/);
  assert.match(explorerPanel, /if \(openChangesSignal\) setChangesCollapsed\(false\);/);
  assert.match(explorerPanel, /onReviewCountChange\?: \(count: number\) => void;/);
  assert.match(appShell, /openChangesSignal=\{changesSignal\}/);
  assert.match(appShell, /onReviewCountChange=\{setReviewCount\}/);
  /* M-12 帧 B 的硬判据是「切块只换这一层内容」—— 反过来说，**切不切都得有内容**。
     key 一旦跟着页签变，`openKey` 就再也找不到那一行，整层渲染成空白（实测：切到
     终端是一片空白，连键排都没有）。所以六行的 key 恒为块 id。 */
  assert.doesNotMatch(appShell, /key: terminalTab\?\.id/);
  assert.doesNotMatch(appShell, /key: browserTab\?\.id/);
  assert.match(appShell, /key: TERMINAL_BLOCK_KEY,/);
  assert.match(appShell, /key: BROWSER_BLOCK_KEY,/);
});

test("M-12 选单那层仍然是选单：底部面板只选，全屏层才装正文", () => {
  // M-12 帧 A → 帧 B 的纪律：选完即走，正文在同一个全屏层里换。
  // 守卫的是「不要把六行做成六个常驻页签」—— 那正是脚注里否掉的形态。
  assert.match(rightPanelsMobile, /const \[openKey, setOpenKey\] = useState<string \| null>\(null\);/);
  assert.match(rightPanelsMobile, /const \[sheetOpen, setSheetOpen\] = useState/);
});

test("M-12 帧 B：六块共用一层，pane 正文不得再自称整层（盖掉切换条）", () => {
  const traceFrame = read("components/TraceFrame.tsx");
  /* 帧 B 的硬判据：「顶部六项横滚…是这一层唯一的入口」。此前「调用轨迹」这一块
     在 PWA 挂 `.m-viewer`（库里的 `position:absolute; inset:0`），从 `.m-panel-scroll`
     里逃出去铺满视口（实测 390×844 z=100），把六项切换条整条盖掉 —— 点进轨迹就
     再也切不回别的块。本组件在产品里只有一个渲染点，就是 pane 正文。 */
  assert.doesNotMatch(
    traceFrame,
    /"m-viewer is-open"/,
    "TraceFrame 是 pane 正文，不能再挂整层浮起类（会盖掉 M-12 的六项切换条）",
  );
  /* fork:trace-pane-width（2026-10-06）—— 根现在**两边都是** `fork-trace-pane`：
     桌面原来挂 `.d-panel`，而那是 D-05 的右栏壳（库里 `width: 320px; flex: 0 0 auto`），
     在 `.file-panel-main` 里把 iframe 压成 319px、右边留 220px 空白（用户反馈
     「右边有部分区域是空白」）。断言改成钉「根不许再挂任何带固定宽度的面板类」。 */
  assert.match(traceFrame, /<div className="fork-trace-pane"/);
  assert.doesNotMatch(
    traceFrame,
    /className=\{isPwa \? "fork-trace-pane" : "d-panel"\}/,
    "根不能再挂 .d-panel（width: 320px）—— 那是右栏壳，不是 pane 正文",
  );
  assert.match(traceFrame, /isPwa \? "fork-trace-bar" : "d-panel-head"/);
  // 接线层那两块壳必须在，否则上面两个类名是死的。
  const forms = read("app/design/v5-forms.css");
  assert.match(forms, /\.fork-trace-pane \{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-height: 0;/);
  assert.match(forms, /\.fork-trace-bar \{[\s\S]*?flex: 0 0 auto;/);
});

test("M-12 帧 B：「文件」那一块在 pane 里不再叠第二条顶栏", () => {
  /* 同一类问题：FileExplorer 无条件画 `.m-top`（绝对定位 + 渐隐底 + 状态栏让位），
     于是 pane 里上下两条顶栏，390×844 吃掉约 200px。画板帧 B 的 pane 只有一层内容。 */
  const fileExplorer = read("components/FileExplorer.tsx");
  assert.match(fileExplorer, /inPanel\?: boolean;/);
  assert.match(fileExplorer, /inPanel \? "fork-pane-bar" : "m-top"/);
  assert.match(fileExplorer, /\{inPanel \? null : <div className="m-fade" aria-hidden="true" \/>\}/);
  assert.match(explorerPanel, /inPanel=\{inPanel\}/);
  // 接线层那块壳必须在，否则 `fork-pane-bar` 是死的。
  assert.match(read("app/design/v5-forms.css"), /\.fork-pane-bar \{[\s\S]*?flex: 0 0 auto;/);
  // 窄屏一律算「在 pane 里」：手机上这棵树永远在另一条顶栏底下。
  assert.match(appShell, /inPanel=\{isMobile\}/);
});

test("SW 缓存版本必须逐构建变化（否则装到主屏的 PWA 一直吃旧 chunk）", () => {
  /* 2026-10-06 用户反馈「改的没效果」，两层原因：
     ① 服务端构建早就是新的，但主屏上那个 PWA 还在跑旧界面 —— SW 缓存版本取的是
        package.json 版本号，只在发版时才变，于是几十次构建共用同一个缓存桶。
        改成「包版本 + 源码指纹」。 */
  const config = read("next.config.mjs");
  // 指纹必须**逐构建变化**：只叠 git sha 是死值（HEAD 不动 + 工作区一直脏 → 串不变）。
  assert.match(config, /const buildStamp = Date\.now\(\)\.toString\(36\);/);
  assert.match(config, /const appVersion = `\$\{version\}\+\$\{sourceStamp \|\| "nogit"\}\.\$\{buildStamp\}`;/);
  assert.match(config, /NEXT_PUBLIC_APP_VERSION: appVersion,/);
  assert.match(config, /"rev-parse", "--short", "HEAD"/);
  // 打包产物里没有 .git，所以两条 git 调用都得容错。
  assert.match(config, /catch \{ \/\* not a git checkout \(packaged build\)/);
  // sw.js 确实是从 URL 的 ?v= 取版本；PwaRegistration 确实传的是那个变量。
  assert.match(read("public/sw.js"), /searchParams\.get\("v"\)/);
  assert.match(read("components/PwaRegistration.tsx"), /NEXT_PUBLIC_APP_VERSION/);
  // ② 同一份 `.next` 上常有另一个进程在构建，两份构建互删产物 → `next start`
  //    起来后 `/_next/static/**` 全 500、页面空白，服务端“新构建”其实取不到。
  //    验证那份产物要能挪到别处（默认 `.next` 一个字节都不变）。
  assert.match(config, /const distDir = process\.env\.NEXT_DIST_DIR \|\| "\.next";/);
  assert.match(config, /^\s*distDir,$/m);
});

test("M-06 帧 A：pane 里的底部动作条要顶满 pane（否则三项折成两行）", () => {
  /* 板面：`.m-vbar` 是 `.m-phone-inner` 的直接子元素，满 390 宽，三项各 119px +
     两个 6px 间距 + 20px 内距 = 389，正好一行。产品里它被 `.m-panel-scroll` 的
     12px 内距缩到 366，三项各 111px，「复制路径」放不下就折行，整条从一行变两行。
     负边距正好等于容器自己的那一格，所以落点就是 pane 边缘，不溢出。 */
  assert.match(read("app/design/v5-forms.css"), /\.m-panel-scroll \.m-vbar \{[\s\S]*?margin-left: calc\(-1 \* var\(--nx-sp-3\)\);[\s\S]*?margin-right: calc\(-1 \* var\(--nx-sp-3\)\);/);
  // 板面第三项是「更多」两字；桌面那条 `chat.moreControls` 是四字，390 宽放不下。
  assert.match(read("components/FileExplorer.tsx"), /t\("files\.moreActions"\)/);
  assert.doesNotMatch(read("components/FileExplorer.tsx"), /t\("chat\.moreControls"\)/);
});
