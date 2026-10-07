import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { createJiti } from "jiti";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".module.css")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: "export default new Proxy({}, { get: (_, key) => String(key) });",
    };
  },
});

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { countToolCalls } = await jiti.import("./ChatMinimap.tsx");
const source = await readFile(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");
/* 「退场」类断言只查**代码**，不查注释：注释里为了说清楚「什么退场了」必然要提旧类名
   （口径与 design/v5/scripts/land-status.mjs 剥块注释一致）。 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "");

// fork:upstream-0.9.2-minimap-tools — #939 移植的计数单测
test("counts tool calls per assistant reply, including replies that also answer", () => {
  // A reply can both answer and call tools, so counting text-less messages
  // would undercount this turn.
  assert.equal(countToolCalls({
    role: "assistant",
    content: [
      { type: "text", text: "Let me check that file." },
      { type: "toolCall", toolCallId: "1", toolName: "read", input: {} },
      { type: "toolCall", toolCallId: "2", toolName: "grep", input: {} },
    ],
  }), 2);

  assert.equal(countToolCalls({
    role: "assistant",
    content: [{ type: "toolCall", toolCallId: "3", toolName: "bash", input: {} }],
  }), 1);

  assert.equal(countToolCalls({
    role: "assistant",
    content: [{ type: "text", text: "Done." }],
  }), 0);
});

test("counts no tool calls for non-assistant or string-content messages", () => {
  assert.equal(countToolCalls({ role: "user", content: "run the tests" }), 0);
  assert.equal(countToolCalls({ role: "assistant", content: "plain string" }), 0);
  assert.equal(countToolCalls({ role: "assistant" }), 0);
});

// fork:v6-landing（2026-10-07 用户实拍第二轮）—— 导轨 = 画板 D-32 / D-33 帧 D 的
// `.d-navrail` 细刻度（过去 done / 当前 now / 未来 far）+ `.d-navpop` 悬停卡。
// board 53 的 320px 大纲面板（`.pw-minimap-pop` / `.pin` / `.load-earlier` / `.turn` /
// `.gutter` / `.no.anchor`）与 `AssistantOutline` **整块退场**：用户实拍「这个浮窗，
// 你也没有按照设计的来」。「加载更早」本来就有「滚到顶自动加载」兜底（ChatWindow 的
// sentinel IntersectionObserver），大纲级跳转随面板一起退场。
test("导轨刻度与悬停卡是 V6 的 .d-navtick / .d-navpop，大纲面板已退场", () => {
  // 容器几何仍归 `.pw-minimap-rail`（grid 第二列的通高列），另挂 `.d-navrail` 表达
  // 「这一列现在是 V6 导航轨」（双类覆盖在 app/fork-ui.css，0-2-0）。
  assert.match(source, /className="pw-minimap-rail d-navrail"/, "导轨容器是 .pw-minimap-rail + .d-navrail");
  assert.doesNotMatch(code, /pw-minimap-pop|previewPinned|AssistantOutline|data-minimap-preview-box/, "320px 大纲面板已整块退场");
  assert.doesNotMatch(
    code,
    /className=[^\n]*\b(d-minimap|d-mm-node|d-mm-pin|d-mm-turn|d-trow|fork-minimap-panel|fork-minimap-rail)\b/,
    "组件里不再有任何旧 d-* / fork-* 迷你地图类",
  );

  // 刻度：`.d-navtick` 按与当前轮的关系分三档（过去 done / 当前 now / 未来 far）。
  assert.match(source, /className=\{activeIndex === null\s*\n\s*\? "d-navtick far"/);
  assert.match(source, /"d-navtick now mid"/);
  assert.match(source, /"d-navtick done near"/);
  assert.doesNotMatch(code, /className=\{`node\$/, "board 53 的圆点已退场");
  // `data-minimap-*` 钩子（e2e 与 verify-against-boards 按它们选元素）一个不能少。
  for (const hook of ["data-minimap-node-index", "data-minimap-node-kind", "data-minimap-node-active", "data-minimap-node-hover"]) {
    assert.ok(source.includes(hook), `${hook} 钩子不能少`);
  }
  // 悬停卡：画板 D-32 的 `.d-navpop` + `.d-navpop-t`，工具数徽标走 V5 的 `.d-badge.mute`。
  assert.match(source, /className="d-navpop"/, "悬停预览卡是 V6 的 .d-navpop");
  assert.match(source, /className="d-navpop-t"/, "预览卡头行是 .d-navpop-t");
  assert.match(source, /className="d-badge mute"/);
  // 悬停就出卡（不再要求「先钉住」）。
  assert.match(source, /const tooltipTurn = minimapHovered && nearestNode/);
});

// fork:v6-landing —— 刻度组**垂直居中**（画板 D-32/D-33 帧 D 的 `.d-navrail` 是
// `justify-content: center`）。用户实拍「这些横杆不是从顶部开始的，应该是上下居中」。
test("刻度组垂直居中，不再从轨道顶部起排", () => {
  assert.match(source, /const start = Math\.max\(MINIMAP_PADDING, \(height - span\) \/ 2\)/);
  assert.match(source, /topRatio: \(start \+ index \* gap\) \/ height/);
  assert.doesNotMatch(code, /topRatio: \(MINIMAP_PADDING \+ index \* gap\) \/ height/, "旧贴顶排法已退场");
  // 单轮会话那颗刻度落在正中。
  assert.match(source, /nodes: \[\{ \.\.\.allNodes\[0\], topRatio: 0\.5 \}\]/);
});
