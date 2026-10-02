import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// fork:upstream-2e66e40（#1008 移植的另一半）—— 压缩控件在**流式期间**的露出条件。
// 手动压缩从空闲会话起，旧守卫 `!isStreaming` 看着没问题；自动压缩是一轮跑到一半
// 才开始（旧守卫下按钮整轮都不渲染，用户只剩一个笼统的「停止」），所以把
// `disabled={isStreaming && !isCompacting}` 写在按钮上却永远不生效 —— 那条 disabled
// 本来就自相矛盾：只有「压缩中也要够得着」才说得通。

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
      React.createElement(ChatInput, { onSend() {}, onAbort() {}, onCompact() {}, ...props }),
    ),
  );
}

test("mid-turn auto-compaction still offers the compaction control", () => {
  const html = render({ isStreaming: true, isCompacting: true });
  assert.match(html, /aria-label="Stop compaction"/);
  // 「停止压缩」必须可点：不能被 disabled / not-allowed 挡住（上游把这两条死分支删掉）。
  assert.doesNotMatch(html, /aria-label="Stop compaction"[^>]*\sdisabled/);
});

test("a streaming turn that is not compacting does not render the compact control", () => {
  const idle = render({ isStreaming: false, isCompacting: false });
  assert.match(idle, /aria-label="Compact context"/);
  assert.doesNotMatch(render({ isStreaming: true, isCompacting: false }), /aria-label="Compact context"/);
});

test("an idle session keeps the manual compaction control", () => {
  const html = render({ isStreaming: false, isCompacting: false });
  assert.match(html, /aria-label="Compact context"/);
});