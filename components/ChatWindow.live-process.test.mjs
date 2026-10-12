import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

/*
 * fork:process-live-2 — a running turn must stay on the grouped renderer.
 *
 * The live tail used to render every message flat and only the in-flight one
 * reached `ProcessGroup`, so with "process display: steps" the timeline was
 * visible for one message and flipped back to the flat list as soon as the
 * turn's first tool call was committed to `messages` — then flipped again when
 * the turn finished. The turn is now one timeline from start to finish.
 *
 * fork:upstream-0.12-chat-parity（PR-7c）—— 组装那段从 `ChatWindow` 顶层搬进了
 * `<StreamingReply>`（它自己订阅 store，所以每个片段不再让整棵树重渲染）。契约没变：
 * 本轮已提交的步骤 + 在飞块合并成**一个**组，组当回答消息的 `prefix`。
 */
const LIVE_TAIL_START = "const isLiveTail =";
const LIVE_TAIL_END = "const finalAssistant = messages[finalAssistantIdx]";
const liveTail = source.slice(
  source.indexOf(LIVE_TAIL_START),
  source.indexOf(LIVE_TAIL_END),
);

const REPLY_START = "const StreamingReply = memo(";
const streamingReply = source.slice(
  source.indexOf(REPLY_START),
  source.indexOf("export function ChatWindow("),
);

test("the running turn is rendered as one timeline instead of the flat list", () => {
  assert.ok(liveTail.length > 0, "the live-tail branch moved; update this test with it");
  assert.ok(streamingReply.length > 0, "StreamingReply moved; update this test with it");
  // 时间线是唯一渲染器（2026-09-21 删掉平铺列表与标签视图后不再有 `!grouped` 分支），
  // 所以运行中的一轮只会构建一个组：本轮的已提交步骤 + 在飞块。
  assert.match(streamingReply, /const blocks: ProcessContentBlock\[\] = \[\]/);
  assert.match(streamingReply, /\.\.\.committed\.blocks, \.\.\.streamingProcess\.blocks/);
  assert.match(streamingReply, /<ProcessGroup/);
  // 顶层那一支把工作交给它，自己只留下锚点行（位置与原来「作为最后一块 push」等价）。
  assert.match(liveTail, /rendered\.push\(renderMessage\(userIdx\)\)/);
  assert.match(
    source,
    /rendered\.slice\(startIndex\)\}[\s\S]{0,300}?<StreamingReply/,
    "流式那一块必须在列表之后渲染，才与原来「push 进 rendered 的最后一块」等价",
  );
});

test("the in-flight message is converted once and shared by both call sites", () => {
  assert.match(source, /const streamingProcess = useMemo\(\(\) => \{/);
  // 不再有「legacy 时不算」的早退；grouped 恒真。
  assert.doesNotMatch(source, /processDisplayMode === "legacy"/);
});

test("the streaming block contributes only the answer once the timeline exists", () => {
  const streaming = source.slice(source.indexOf("if (!isStreaming || !hasStreamingContent || !streamingProcess"));
  assert.ok(streaming.length > 0, "the streaming block moved; update this test with it");
  // 已经发出去的时间线**复用**而不是重建（这就是「只补回答」的形状）：
  // groupNode 先取 rangeGroup，空才自己建；有回答块时把它当 prefix 交给 MessageView。
  assert.match(streaming, /let groupNode: ReactNode = rangeGroup;/);
  assert.match(
    streaming,
    /if \(streamingProcess\.blocks\.length === 0 && !rangeGroup\)/,
  );
  assert.match(streaming, /prefix=\{groupNode\}/);
  assert.doesNotMatch(streaming, /if \(liveTurnTimeline\) return answerView;/,
    "旧形状（活时间线存在就直接退回回答视图）已改成把时间线当 prefix 复用");
});
