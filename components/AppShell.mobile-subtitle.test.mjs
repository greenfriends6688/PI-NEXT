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

test("the subtitle only renders on mobile and never on the desktop top bar", () => {
  // 这一行在 renderSessionTitle 里（不在 topBarSubtitle 那一段），所以查整个文件。
  assert.match(appShell, /const subtitle = isMobile \? topBarSubtitle : null;/);
  // fork:v5-landing —— 标题两行 = 画板 D-01/D-02 的 `.d-tb-stack`。
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
  assert.match(appShell, /\{subtitle && <span className="d-tb-sub">\{subtitle\}<\/span>\}/);
});

test("a long title still ellipsises inside the stacked header", () => {
  // 列向 flex 里 `align-items: flex-start` 会让子项缩到内容宽，省略号就失效了；
  // `.d-tb-title` 自带 nowrap + ellipsis + min-width:0，`.d-tb-stack` 是列向容器。
  assert.match(systemCss, /\.d-tb-stack \{ display: flex; flex-direction: column; min-width: 0; \}/);
  assert.match(systemCss, /\.d-tb-title \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; \}/);
});

test("the phone header carries the board class pair", () => {
  assert.match(appShell, /className="main-workspace-header d-topbar"/);
});
