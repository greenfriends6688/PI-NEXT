// fork:mobile-tb-subtitle（2026-10-03）—— 手机顶栏会话身份副行的接线锁定。
//
// 锁三件事：只在手机渲染、只放「别处看不到」的两项、长标题仍然会省略。
// 第二条是这轮的重点：副行的价值全在「不重复屏幕上已有的读数」，
// 所以 model / thinking / 运行中**不许**再进来（否则就是 AGENTS.md 反复记过的那种
// 「同一块屏上摆两枚同一个读数」）。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const appShell = readFileSync(join(ROOT, "components/AppShell.tsx"), "utf8");
const systemCss = readFileSync(join(ROOT, "design/v5/web/system.css"), "utf8");

/** 副行那一段源码（到下一个顶层注释块为止），免得扫到别处的 cwd / model。 */
function subtitleSource() {
  const start = appShell.indexOf("const topBarSubtitle = (() => {");
  assert.ok(start > 0, "AppShell 里应有 topBarSubtitle");
  const end = appShell.indexOf("const renderSessionTitle", start);
  return appShell.slice(start, end);
}

test("the subtitle is one value, rendered once per form (never twice on desktop)", () => {
  // fork:v5-frame-audit —— 判据从「先把 subtitle 按形态取空」改成**结构上先分支**：
  //   `if (isMobile) return …` 那一支只渲染 `.m-top-title` + `.m-t-xs.m-t-faint`，
  //   桌面那一支返回 `.d-tb-stack`。所以「副行不会漏进桌面」这条约束现在钉在
  //   **分支位置**上，而不是钉在某个三元表达式上（同一个值不必先取两遍）。
  const start = appShell.indexOf("const renderSessionTitle");
  const body = appShell.slice(start, start + 2200);
  const mobileBranch = body.slice(body.indexOf("if (isMobile) {"), body.indexOf('className="d-tb-stack"'));
  assert.match(body, /if \(isMobile\) \{/);
  assert.match(mobileBranch, /className="m-top-title"/);
  assert.match(mobileBranch, /\{subtitle && <span className="m-t-xs m-t-faint">\{subtitle\}<\/span>\}/);
  // 桌面那一支：`.d-tb-stack` 仍在（画板 D-01/D-02 的两行身份块）。
  assert.match(appShell, /className="d-tb-stack"/);
});

test("the subtitle carries only the two readings that exist nowhere else", () => {
  const src = subtitleSource();
  assert.match(src, /parts\.push\(pathBasename\(selectedSession\.cwd\)\)/);
  assert.match(src, /sessionStats\?\.contextUsage\?\.percent/);
  // 这两项已经在输入区常驻（模型选择器 / 思考芯片），副行不许再放一份。
  for (const dup of ["modelId", "thinkingLevel", "provider"]) {
    assert.doesNotMatch(src, new RegExp(dup), `副行不该出现 ${dup}（输入区已经常驻）`);
  }
});

test("an empty reading list means no subtitle element at all", () => {
  assert.match(subtitleSource(), /return parts\.length > 0 \? parts\.join\(" · "\) : null;/);
  // fork:no-tb-sub（2026-10-05 用户裁定）—— 桌面顶栏不再渲染副行，所以「空值时
  // 不出副行」这条约束改钉在**唯一还在渲染副行的那一支**（手机 `.m-top`）上。
  assert.match(appShell, /\{subtitle && <span className="m-t-xs m-t-faint">\{subtitle\}<\/span>\}/);
  assert.doesNotMatch(appShell, /className="d-tb-sub"/);
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
