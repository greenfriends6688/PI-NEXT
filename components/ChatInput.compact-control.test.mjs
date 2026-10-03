import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// fork:upstream-2e66e40（#1008 移植的另一半）—— 压缩控件在**流式期间**的露出条件。
// 2026-10-03 用户裁定 —— 工具条上那枚「压缩」芯片**删除**（上下文环的浮窗底部已有同一
// 动作），所以这里守的不再是「工具条上有按钮」，而是「压缩中必须仍有一个够得着的
// 停止口」：上游 #1008 的理由是自动压缩可能在一轮跑到一半才开始，那时
// `!isStreaming` 的旧守卫让按钮整轮都不渲染，用户只剩一个笼统的「停止」。

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ChatInput } = await jiti.import("./ChatInput.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, { onSend() {}, onAbort() {}, ...props }),
    ),
  );
}

test("the toolbar no longer duplicates the ring's compaction entry", () => {
  for (const props of [
    { isStreaming: false, isCompacting: false },
    { isStreaming: true, isCompacting: true },
  ]) {
    const html = render(props);
    assert.doesNotMatch(html, /aria-label="Compact context"/);
    assert.doesNotMatch(html, /data-ico="minimize-2"/);
  }
});

test("the composer's compact prop still exists (the ring popover owns the action)", () => {
  // 环浮窗（contextRing）拿的就是同一个 `onCompact` / `onAbortCompaction`，
  // 所以这里只钉住 props 形状没有随芯片一起被删。
  const html = render({ onCompact() {}, onAbortCompaction() {} });
  assert.match(html, /composer-ring|pw-ring|chat-input-toolbar/);
});