import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ProcessGroup, buildProcessSteps, liveStepVariant } = await jiti.import("./ProcessGroup.tsx");
const { messageToProcessContentBlocks } = await jiti.import("@/lib/process-content");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderGroup(messages) {
  const blocks = messages.flatMap((message, messageIndex) => messageToProcessContentBlocks(message, {
    messageIndex,
    entryId: `entry-${messageIndex}`,
    phase: "process",
  }));
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ProcessGroup, { blocks, reveal: true }),
    ),
  );
}

test("renders custom content arrays and standalone image blocks", () => {
  const html = renderGroup([
    {
      role: "custom",
      customType: "status",
      display: true,
      content: [
        { type: "text", text: "Scanning the workspace" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } },
      ],
    },
    {
      role: "assistant",
      provider: "test",
      model: "test",
      content: [
        { type: "image", source: { type: "url", url: "https://example.com/shot.png" } },
      ],
    },
  ]);

  assert.match(html, /Scanning the workspace/);
  assert.doesNotMatch(html, /\[object Object\]/);
  assert.match(html, /data:image\/png;base64,abc123/);
  assert.match(html, /https:\/\/example\.com\/shot\.png/);
});

/*
 * fork:zm-02 — streaming entrance. The component must stay inert wherever the
 * motion preference is unknown (SSR / jsdom), and the stagger slot must come
 * from the stable per-turn step ordinal rather than the render array index.
 */

function renderStreaming(messages) {
  const blocks = messages.flatMap((message, messageIndex) => messageToProcessContentBlocks(message, {
    messageIndex,
    entryId: `entry-${messageIndex}`,
    phase: "process",
  }));
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ProcessGroup, { blocks, isStreaming: true, reveal: true }),
    ),
  );
}

function assistantWithToolCalls(toolCallIds) {
  return {
    role: "assistant",
    provider: "test",
    model: "test",
    content: toolCallIds.map((id) => ({
      type: "toolCall",
      toolCallId: id,
      toolName: "read",
      input: { file_path: `${id}.ts` },
    })),
  };
}

test("SSR never emits the entrance scope, marker or delay variable", () => {
  const html = renderStreaming([assistantWithToolCalls(["call-a", "call-b"])]);

  // The motion preference is unknown on the server, so nothing animation-related
  // may leave the server render: the scope attribute, the per-row marker and the
  // delay variable only appear once a mounted browser reported no-preference.
  assert.doesNotMatch(html, /data-fork-stream-animate/);
  assert.doesNotMatch(html, /data-fork-enter/);
  assert.doesNotMatch(html, /--fork-enter-delay/);
});

test("step sequences are stable while the turn grows", () => {
  const firstBlocks = messageToProcessContentBlocks(assistantWithToolCalls(["call-a", "call-b"]), {
    messageIndex: 0,
    entryId: "entry-0",
    phase: "process",
  });
  const t = (key) => key;
  const first = buildProcessSteps(firstBlocks, t);
  assert.deepEqual(first.map((step) => step.sequence), [0], "consecutive same-tone calls group into one step");

  const grownBlocks = messageToProcessContentBlocks(assistantWithToolCalls(["call-a", "call-b", "call-c"]), {
    messageIndex: 0,
    entryId: "entry-0",
    phase: "process",
  });
  const grown = buildProcessSteps(grownBlocks, t);
  assert.equal(grown[0].sequence, 0, "the existing step keeps its slot");
  assert.equal(grown[0].count, 3);

  const mixed = buildProcessSteps([
    ...messageToProcessContentBlocks(assistantWithToolCalls(["call-a"]), {
      messageIndex: 0,
      entryId: "entry-0",
      phase: "process",
    }),
    {
      id: "entry-0:1",
      origin: { phase: "process", placement: "inline", sourceMessageIndex: 0 },
      type: "text",
      text: "done",
    },
  ], t);
  assert.deepEqual(mixed.map((step) => step.sequence), [0, 1]);
});

test("the entrance delay reads step.sequence, never the render index", async () => {
  const source = await readFile(new URL("./ProcessGroup.tsx", import.meta.url), "utf8");
  assert.match(source, /--fork-enter-delay/);
  assert.match(source, /streamEnterDelay\(step\.sequence\)/);
  assert.match(source, /data-fork-stream-animate/);
  assert.match(source, /data-fork-enter/);
});

test("fork:think-variants —— 在飞的那一步真的渲染出四变体 DOM，历史步骤仍是静态图标", () => {
  const blocks = messageToProcessContentBlocks(assistantWithToolCalls(["call-a"]), {
    messageIndex: 0,
    entryId: "entry-0",
    phase: "process",
  });
  const streaming = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ProcessGroup, { blocks, reveal: true, isStreaming: true }),
    ),
  );
  assert.match(streaming, /d-think-dots/, "在飞的那一步的图标位换成动画指示器");

  const settled = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ProcessGroup, { blocks, reveal: true }),
    ),
  );
  assert.doesNotMatch(settled, /d-think-dots/, "一轮结束后回到静态图标");
});

test("fork:think-variants —— 在飞的那一步按「正在做什么」选四变体", () => {
  /* 画板 D-27 帧 C 的四个标签：正在推理 / 正在检索 / 正在起草 / 正在搜索。
     这四个变体此前在产品里没有任何可见的落点（唯一调用点在**已结束**的一轮里），
     用户 2026-10-06 实拍「这个动效没给我加上，我没看到」。 */
  const step = (over) => ({
    id: "s",
    sequence: 0,
    label: "",
    icon: "toolbox",
    targets: [],
    blocks: [],
    ...over,
  });

  assert.equal(liveStepVariant(step({ thinking: true })), "wave", "推理");
  assert.equal(liveStepVariant(step({ tone: "document_search" })), "spin", "检索");
  assert.equal(liveStepVariant(step({ tone: "document_read" })), "spin");
  assert.equal(liveStepVariant(step({ tone: "document_change" })), "stars", "起草");
  assert.equal(liveStepVariant(step({ tone: "command_execution" })), "wave", "其余回落推理档");
  assert.equal(
    liveStepVariant(step({
      tone: "document_search",
      blocks: [{ type: "toolCall", toolCallId: "t", toolName: "browser_navigate", input: {} }],
    })),
    "comet",
    "联网工具压过 tone",
  );
});
