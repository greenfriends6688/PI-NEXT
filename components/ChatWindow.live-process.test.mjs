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
 */

// The branch runs from its guard to the point where it reports that the turn's
// timeline has been emitted; the assignment below sits in the middle of it and
// would cut the slice short.
// fork:v5-landing —— 变量从 `liveTurnTimeline` 改名为 `liveTurnGroup`：它存的是**节点**
// （有回答可挂时挂 `prefix`，没有时自己渲染），不是一个布尔。契约没变。
const LIVE_TAIL_END = "liveTurnGroup = liveGroupNode;";
const liveTail = source.slice(
  source.indexOf("const isLiveTail ="),
  source.indexOf(LIVE_TAIL_END) + LIVE_TAIL_END.length,
);

test("the running turn is rendered as one timeline instead of the flat list", () => {
  assert.ok(liveTail.length > 0, "the live-tail branch moved; update this test with it");
  // 时间线是唯一渲染器（2026-09-21 删掉平铺列表与标签视图后不再有 `!grouped` 分支），
  // 所以运行中的一轮只会构建一个组：本轮的已提交步骤 + 在飞块。
  assert.match(liveTail, /const liveBlocks: ProcessContentBlock\[\] = \[\]/);
  assert.match(liveTail, /liveBlocks\.push\(\.\.\.streamingProcess\.blocks\)/);
  assert.match(liveTail, /<ProcessGroup/);
  assert.match(liveTail, /liveTurnGroup = liveGroupNode/);
});

test("the in-flight message is converted once and shared by both call sites", () => {
  assert.match(source, /const streamingProcess = useMemo\(\(\) => \{/);
  // 不再有「legacy 时不算」的早退；grouped 恒真。
  assert.doesNotMatch(source, /processDisplayMode === "legacy"/);
});

test("the streaming block contributes only the answer once the timeline exists", () => {
  const streaming = source.slice(source.indexOf("streamState.isStreaming && hasStreamingContent"));
  assert.ok(streaming.length > 0, "the streaming block moved; update this test with it");
  // 已经发出去的时间线**复用**而不是重建（这就是「只补回答」的形状）：
  // groupNode 先取 liveTurnGroup，空才自己建；有回答块时把它当 prefix 交给 MessageView。
  assert.match(streaming, /let groupNode: ReactNode = liveTurnGroup;/);
  assert.match(
    streaming,
    /if \(!streamingProcess \|\| \(streamingProcess\.blocks\.length === 0 && !liveTurnGroup\)\)/,
  );
  assert.match(streaming, /prefix=\{groupNode\}/);
  assert.doesNotMatch(streaming, /if \(liveTurnTimeline\) return answerView;/,
    "旧形状（活时间线存在就直接退回回答视图）已改成把时间线当 prefix 复用");
});
