// fork:mobile-action-panel（2026-10-03）—— 手机动作宫格的接线锁定。
//
// 这里补的是 `scripts/check-icons.mjs` 的一个**已知盲区**（DIVERGENCE AF-5 记过）：
// 那个门禁只扫字面量 `data-ico="name"`，扫不到「图标名作为数据传进去」的写法，
// 而命中失败时 `icons.js` 是**静默返回空字符串** —— 格子里会是个空图标，不报错。
// 宫格的九个图标名正是以 `icon: "history"` 这种形式传的，所以在这里单独钉住。
//
// 另外两条：面板只在窄屏出现（桌面形态一字不变），以及「同一块屏不摆第二个入口」
// 那条裁定（压缩上下文 / 会话信息不许进宫格）。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appShell = readFileSync(join(ROOT, "components/AppShell.tsx"), "utf8");
const chatInput = readFileSync(join(ROOT, "components/ChatInput.tsx"), "utf8");
const panel = readFileSync(join(ROOT, "components/fork/MobileActionPanel.tsx"), "utf8");

/** `icons.js` 的可用名（与 check-icons.mjs 同一套提取规则）。 */
function knownIcons() {
  const src = readFileSync(join(ROOT, "design/pi-web-design/assets/icons.js"), "utf8");
  const body = src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1);
  const known = new Set();
  for (const m of body.matchAll(/^\s*"([a-z0-9-]+)":/gm)) known.add(m[1]);
  return known;
}

/** 面板那一段源码（到下一个顶层注释块为止），免得扫到别处的 `icon:`。 */
function panelSource() {
  const start = appShell.indexOf("const renderMobileActionPanel = () => {");
  assert.ok(start > 0, "AppShell 里应有 renderMobileActionPanel");
  const end = appShell.indexOf("\n  /* fork:trace-menu", start);
  return appShell.slice(start, end > 0 ? end : start + 6000);
}

test("每一个格子用的图标名都真的存在（check:icons 扫不到这一处）", () => {
  const known = knownIcons();
  const names = [...panelSource().matchAll(/\bicon:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(names.length >= 6, `期望至少 6 个格子，实际 ${names.length}`);
  for (const name of names) {
    assert.ok(known.has(name), `图标名 "${name}" 不在 icons.js 里 —— 渲染出来是个空图标，且不报错`);
  }
});

test("宫格的类名是画板里登记过的那两个（判据⑦）", () => {
  const board = readFileSync(join(ROOT, "design/pi-web-design/assets/board.css"), "utf8");
  assert.match(board, /\.pw-actgrid\s*\{/);
  assert.match(board, /\.pw-actcell\s*\{/);
  assert.match(panel, /className="pw-actgrid"/);
  assert.match(panel, /className="pw-actcell"/);
  // 画板 60 帧 E 必须画着它 —— 新类不许只活在组件里。
  const board60 = readFileSync(join(ROOT, "design/pi-web-design/60-mobile-pwa.html"), "utf8");
  assert.match(board60, /pw-actgrid/);
  assert.match(board60, /pw-actcell/);
});

test("面板只在**手机形态**出现，且触发钮不是把 `+` 换掉", () => {
  // 触发钮的渲染条件：有内容 **且** 是手机形态（fork:action-panel-phone-only，
  // 用户 2026-10-06）。早先它挂在 `narrowControls` 上，而那一项含 `shellNarrow`
  // —— 桌面上聊天列被右栏挤窄也会变 true，于是宫格在电脑的输入框旁边凭空冒出来。
  assert.match(chatInput, /const showActionPanel = Boolean\(actionPanel\) && isMobile;/);
  assert.match(chatInput, /\{showActionPanel && \(/);
  // 宫格不再跟着 `narrowControls` 走（两行控件条的判据仍是它）。
  assert.doesNotMatch(chatInput, /actionPanel && narrowControls/);
  // `+`（附件）还在，而且是独立的按钮 —— 面板另给一枚 grid-2x2。
  assert.match(chatInput, /onClick=\{\(\) => fileInputRef\.current\?\.click\(\)\}/);
  assert.match(chatInput, /data-ico="grid-2x2"/);
});

test("压缩上下文与会话信息不进宫格（同一块屏不摆第二个入口）", () => {
  const src = panelSource();
  for (const id of ["compact", "stats", "info"]) {
    assert.doesNotMatch(src, new RegExp(`id: "${id}"`), `宫格里不该再有 "${id}" 这一格`);
  }
});

test("异步格子（生成标题）跑起来时变忙，不能连点两次", () => {
  assert.match(panel, /aria-busy=\{cell\.busy \? "true" : undefined\}/);
  assert.match(panel, /const blocked = cell\.disabled \|\| cell\.busy;/);
  assert.match(panel, /if \(blocked\) return;/);
  assert.match(panelSource(), /busy: namingBusy/);
});
