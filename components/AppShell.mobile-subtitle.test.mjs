// fork:no-tb-sub-everywhere（2026-10-07 用户第二次裁定）—— 顶栏副行**不存在**的接线锁定。
//
// 历史：fork:mobile-tb-subtitle（2026-10-03）在窄屏渲染「cwd · 上下文 %」；
// fork:no-tb-sub（2026-10-05）把桌面那一行撤掉；fork:v6-landing（2026-10-07 上午）
// 又按画板把它在桌面恢复（`desktopTopBarSubtitle`）。用户当天实拍顶栏标题下的
// 「PI NEXT」直接问「你啥时候加的副标题啊」并要求去掉 —— 两条一起删。
//
// 这份测试从此是**反向**的：钉住「副行没有回来」。任何一条
// `.m-t-xs.m-t-faint` / `.d-tb-sub` / `topBarSubtitle` 的重新引入都会红。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const appShell = readFileSync(join(ROOT, "components/AppShell.tsx"), "utf8");
const systemCss = readFileSync(join(ROOT, "design/v5/web/system.css"), "utf8");

test("顶栏没有副行：取值函数、两条渲染点、两个类名都不在", () => {
  assert.doesNotMatch(appShell, /const topBarSubtitle/);
  assert.doesNotMatch(appShell, /const desktopTopBarSubtitle/);
  assert.doesNotMatch(appShell, /\{subtitle && <span/);
  assert.doesNotMatch(appShell, /\{desktopTopBarSubtitle && <span/);
  assert.doesNotMatch(appShell, /className="d-tb-sub"/);
  assert.doesNotMatch(appShell, /className="m-t-xs m-t-faint"/);
});

test("标题仍然只有一处来源，且两种形态都还渲染它", () => {
  const start = appShell.indexOf("const renderSessionTitle");
  const body = appShell.slice(start, start + 2200);
  assert.match(body, /if \(isMobile\) \{/);
  assert.match(body, /className="m-top-title"/);
  // 桌面那一支：`.d-tb-stack` 仍在（画板 D-01/D-02 的身份块）。
  assert.match(appShell, /className="d-tb-stack"/);
});

test("a long title still ellipsises inside the stacked header", () => {
  // 列向 flex 里 `align-items: flex-start` 会让子项缩到内容宽，省略号就失效了；
  // `.d-tb-title` 自带 nowrap + ellipsis + min-width:0，`.d-tb-stack` 是列向容器。
  assert.match(systemCss, /\.d-tb-stack \{ display: flex; flex-direction: column; min-width: 0; \}/);
  assert.match(systemCss, /\.d-tb-title \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; \}/);
});

test("the phone header carries the board class pair", () => {
  // fork:v5-frame-audit（2026-10-05）—— 窄屏这一行不再是桌面那条 `.d-topbar`：
  // 它换成画板 M-01 帧 A 的 `.m-top`（绝对定位 + 渐隐底，浮在内容上），桌面那一支
  // 仍是 `main-workspace-header d-topbar`。所以断言改成「桌面那一对还在 + 手机
  // 那一支真的换成了 `.m-top`」。
  assert.match(appShell, /className=\{isMobile \? "m-top" : "main-workspace-header d-topbar"\}/);
  assert.match(appShell, /className="d-tb-stack"/);
});
