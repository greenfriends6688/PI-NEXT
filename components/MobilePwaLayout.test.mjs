import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const settingsCssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const viewportHookSource = await readFile(new URL("../hooks/useViewportHeight.ts", import.meta.url), "utf8");

test("configures iOS standalone mode to use the full screen", () => {
  assert.match(layoutSource, /statusBarStyle: "black-translucent"/);
  assert.match(layoutSource, /viewportFit: "cover"/);
  assert.match(layoutSource, /interactiveWidget: "resizes-content"/);
  assert.match(cssSource, /@media \(display-mode: standalone\) \{[\s\S]*?--app-viewport-height: 100vh;/);
});

test("tracks the visual viewport while the software keyboard is open", () => {
  assert.match(appShellSource, /useViewportHeight\(\)/);
  assert.match(appShellSource, /paddingTop: "env\(safe-area-inset-top\)"/);
  assert.match(appShellSource, /paddingBottom: "env\(safe-area-inset-bottom\)"/);
  assert.match(appShellSource, /paddingLeft: "env\(safe-area-inset-left\)"/);
  assert.match(appShellSource, /paddingRight: "env\(safe-area-inset-right\)"/);
  assert.match(appShellSource, /height: "calc\(var\(--height-toolbar, 36px\) \+ env\(safe-area-inset-top\)\)"/);
  assert.match(appShellSource, /\/\* Right panel tab bar \*\/[\s\S]*?height: "calc\(var\(--topbar-height, 36px\) \+ env\(safe-area-inset-top\)\)"/);
  assert.match(appShellSource, /height: "var\(--app-viewport-height, 100dvh\)"/);
  assert.match(appShellSource, /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}/);
  assert.match(viewportHookSource, /window\.visualViewport/);
  assert.match(viewportHookSource, /window\.requestAnimationFrame\(update\)/);
  assert.match(viewportHookSource, /window\.addEventListener\("resize", scheduleUpdate\)/);
  assert.match(viewportHookSource, /window\.addEventListener\("focusout", scheduleUpdate\)/);
  assert.match(viewportHookSource, /--app-viewport-height/);
  assert.match(viewportHookSource, /window\.scrollTo\(0, 0\)/);
  assert.match(cssSource, /height: var\(--app-viewport-height, 100dvh\)/);
  assert.match(cssSource, /left: env\(safe-area-inset-left\)/);
  assert.match(chatWindowSource, /paddingBottom: "env\(safe-area-inset-bottom\)"/);
});

test("contains chat content and inputs within the mobile viewport", () => {
  assert.match(cssSource, /\.markdown-body \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: hidden;/);
  // 2026-09-30：markdown-code-* 家族已退役（代码块走画板 10 的 .pw-code，
  // 画板件自带 overflow 处理）；globals 侧只保留表格滚动容器这条守卫。
  assert.doesNotMatch(cssSource, /\.markdown-code-block \{/, "旧代码块家族不得回归");
  assert.match(cssSource, /\.markdown-table-wrap \{[\s\S]*?overflow-x: auto;/);
  assert.match(chatWindowSource, /overflow-x-hidden overflow-y-auto/);
  assert.match(chatWindowSource, /maxHeight: "min\(760px, 100%\)"/);
  assert.match(chatInputSource, /flex: compact \? "none" : 1,\s*minWidth: 0,\s*width: "100%",/);
});

/* 横向内距在窄屏**只能有一处**。两处都在时症状不是「偏一点」而是「明显不像画板」：
   转录顶到屏幕边（17px 满宽正文看着大一圈），输入卡两侧各被削掉十几 px。
   2026-10-06 实测：`paddingLeft: 0` 打掉画板 `.m-scroll` 的 18px、
   两层 `.m-composer-wrap` 叠成 24px + fieldset 16px → 输入卡 310px（画板 366px）。 */
test("keeps exactly one horizontal gutter on the mobile transcript and composer", () => {
  const scrollStyle = chatWindowSource.match(/className=\{`d-chat\$\{isPwa \? " m-scroll"[\s\S]*?\n          style=\{/);
  assert.ok(scrollStyle, "窄屏滚动区那处 style 断言锚点变了，更新本测试");
  // 归零横向内距只能出现在桌面那一支（isPwa 的三元 false 分支）。
  assert.match(chatWindowSource, /isPwa\s*\n\s*\? \{ visibility: pendingScrollRestore \? "hidden" : undefined \}\s*\n\s*: \{ visibility: pendingScrollRestore \? "hidden" : undefined, paddingLeft: 0, paddingRight: 0 \}/);

  // `.m-composer-wrap` 只归 ChatInput 一枚（它直接托着 `.m-composer`）。
  assert.equal(
    [...chatWindowSource.matchAll(/className=\{isPwa \? "([^"]*)"/g)].filter((m) => m[1].includes("m-composer-wrap")).length,
    0,
    "ChatWindow 不能再挂 .m-composer-wrap：画板里只有一层，两层会把输入卡横向再缩一圈",
  );
  assert.equal(chatInputSource.match(/className="m-composer-wrap"/g)?.length, 1);

  // fieldset 在窄屏让位给 `.m-composer-wrap` 的 `0 12px 12px`，桌面才留自己的 16px。
  assert.match(chatInputSource, /padding: compact \|\| isMobile \? 0 : "0 16px 8px"/);
  assert.match(chatInputSource, /paddingRight: compact \|\| isMobile \? 0 : 16/);
});

test("prevents iOS focus zoom from widening the layout", () => {
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?textarea,[\s\S]*?input,[\s\S]*?select \{\s*font-size: 16px !important;/);
});

test("keeps modal dialogs clear of the iOS status bar in standalone mode", () => {
  assert.match(settingsCssSource, /@supports \(-webkit-touch-callout: none\) \{[\s\S]*?@media \(display-mode: standalone\) \{/);
  assert.match(settingsCssSource, /padding-top: max\(59px, env\(safe-area-inset-top\)\);[\s\S]*?padding-right: max\(8px, env\(safe-area-inset-right\)\);[\s\S]*?padding-bottom: max\(24px, env\(safe-area-inset-bottom\)\);[\s\S]*?padding-left: max\(8px, env\(safe-area-inset-left\)\);/);
  assert.match(settingsCssSource, /@media \(display-mode: standalone\) and \(orientation: landscape\) \{[\s\S]*?padding-top: max\(8px, env\(safe-area-inset-top\)\);[\s\S]*?padding-right: max\(59px, env\(safe-area-inset-right\)\);[\s\S]*?padding-bottom: max\(8px, env\(safe-area-inset-bottom\)\);[\s\S]*?padding-left: max\(59px, env\(safe-area-inset-left\)\);/);
  assert.match(settingsCssSource, /\.settings-dialog-surface,[\s\S]*?\.config-panel-root\.is-modal > \.config-panel-surface \{[\s\S]*?max-width: 100%;[\s\S]*?max-height: 100%;/);
});
