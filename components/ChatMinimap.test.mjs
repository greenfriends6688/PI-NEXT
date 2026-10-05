import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
const { AssistantOutline, countToolCalls } = await jiti.import("./ChatMinimap.tsx");
const source = await readFile(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");

test("renders math in headings without disabling heading navigation", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssistantOutline, {
      markdown: String.raw`# Inline $f_{k,t+1}$

## Parentheses \(x^2 + y^2\)`,
      onHeadingClick() {},
    }),
  );

  assert.match(html, /class="katex"/);
  assert.match(html, /data-preview-heading-index="0"/);
  assert.match(html, /data-preview-heading-index="1"/);
  assert.doesNotMatch(html, /disabled=""/);
});

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

test("renders the load-earlier row before the loaded turns", () => {
  assert.match(source, /hasEarlierMessages: boolean/);
  assert.match(source, /loadingEarlier: boolean/);
  assert.match(source, /onLoadEarlier: \(\) => void \| Promise<void>/);

  // The preview panel must render the row even when no turn is loaded yet,
  // otherwise a page that ends inside one huge turn has no affordance at all.
  assert.match(source, /minimapHovered && \(allNodes\.length > 0 \|\| hasEarlierMessages\)/);

  const previewBox = source.slice(
    source.indexOf("data-minimap-preview-box"),
    source.indexOf("{allNodes.map((node) =>"),
  );
  assert.match(previewBox, /hasEarlierMessages && \(/);
  assert.match(previewBox, /data-minimap-load-earlier/);
  assert.match(previewBox, /disabled=\{loadingEarlier\}/);
  assert.match(previewBox, /void onLoadEarlier\(\)/);
});

test("labels the load-earlier row from i18n and shows progress while it loads", () => {
  assert.match(source, /t\("chatMinimap\.loadEarlier"\)/);
  assert.match(source, /loadingEarlier \? t\("i18n\.loading"\) : t\("chatMinimap\.loadEarlier"\)/);
});

// fork:minimap-board53（2026-10-05 用户裁定）—— 面板与导轨的 DOM 退回画板 53
// （v0.1.8 那一版）。D-03e 的 `d-minimap` / `d-mm-node` / `d-mm-pin` / `d-mm-turn` /
// `d-trow` 那一套已退场，两枚 `.d-mm-*` 标记随之退役：它们只是
// `minimapHovered + nearestNodeIndex` 派生的可视标记，没有独立状态、也没有交互，
// 导轨换回圆点后无处安放。行为（props / 悬停拖拽 / 定位锁 / 加载更早 / 大纲点击跳转 /
// data-minimap-* 钩子）一律不变。
test("导航面板与导轨保持画板 53（0.1.8）的 DOM —— d-* 那套已退场", () => {
  assert.match(source, /className="pw-minimap-rail"/, "导轨是 board.css 的 .pw-minimap-rail");
  assert.match(source, /className="pw-minimap-pop"/, "浮层是 .pw-minimap-pop");
  assert.doesNotMatch(
    source,
    /className=[^\n]*\b(d-minimap|d-mm-node|d-mm-pin|d-mm-turn|d-trow|fork-minimap-panel|fork-minimap-rail)\b/,
    "组件里不再有任何 d-* / fork-* 迷你地图类",
  );

  // 导轨节点：6px 圆点 + 当前轮 `.on` + 标题轮 `.heading`（`kind` 仍是前端派生）。
  assert.match(source, /className=\{`node\$\{node\.kind === "heading" \? " heading" : ""\}\$\{activeIndex === node\.index \? " on" : ""\}`\}/);
  // 头行：图钉图标 + 文案开关钮（aria-pressed）+ ✕ 关闭钮，两枚都在 div.pin 内。
  assert.match(source, /className=\{`pin\$\{previewPinned \? " on" : ""\}`\}/);
  assert.match(source, /aria-pressed=\{previewPinned\}/, "固定开关仍有 aria-pressed");
  assert.match(source, /className="load-earlier"/, "加载更早行回到 .load-earlier");
  assert.match(source, /className=\{`turn\$\{isLocated \? " on" : ""\}`\}/, "轮行回到 .turn/.on");
  assert.match(source, /className="gutter"/);
  assert.match(source, /className="no anchor"/, "回答锚点回到 .no.anchor");
  assert.match(source, /className="u"/, "用户行回到 .u");
  assert.match(source, /className="a"/, "回答块回到 .a");
  // 工具数徽标在 tooltip 与轮行里都是 pw-badge count / .tool，不是 d-badge。
  assert.match(source, /className="pw-badge count"/);
  assert.match(source, /className="tool"/);
  assert.match(source, /className="pw-card"/, "tooltip 回到 .pw-card 工具卡");
});

test("关闭钮仍取消固定并立刻收起面板（D-03e 那版带进来的动作没丢）", () => {
  const close = source.slice(source.indexOf("data-minimap-close"));
  assert.match(close, /setPreviewPinned\(false\)/);
  assert.match(close, /setMinimapHovered\(false\)/);
  assert.match(close, /setMouseYRatio\(null\)/);
});
