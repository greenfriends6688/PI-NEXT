import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  MessageView,
  ThinkingBlock,
  getModelDisplayName,
  getTokenEstimateText,
  getToolCallInputText,
  replaceUserMessageText,
} = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { splitFinalAssistantBlocks } = await jiti.import("@/lib/message-display");

function renderMessage(message, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, { message, ...props }),
    ),
  );
}

test("updates a reused message when its written files change", () => {
  const props = { message: { role: "assistant", content: [] } };
  assert.equal(MessageView.compare(props, props), true);
  assert.equal(MessageView.compare(props, { ...props, writtenFiles: [{ path: "/tmp/result.txt" }] }), false);
});

test("matches response model aliases and otherwise includes the provider", () => {
  const names = {
    "gateway:claude-sonnet-5": "Sonnet 5",
    "custom-api:GLM-5.3": "GLM 5.3",
  };

  assert.equal(getModelDisplayName("gateway", "anthropic/claude-sonnet-5", names), "Sonnet 5");
  assert.equal(getModelDisplayName("CUSTOM-API", "glm-5.3", names), "GLM 5.3");
  assert.equal(getModelDisplayName("gateway", "unknown-model", names), "gateway/unknown-model");
});

test("previews the first thinking line and reveals the full text with the saved default", () => {
  const previousWindow = globalThis.window;
  try {
    for (const expanded of [false, true]) {
      globalThis.window = { localStorage: { getItem: () => String(expanded) } };
      const html = renderToStaticMarkup(React.createElement(
        I18nProvider,
        null,
        React.createElement(ThinkingBlock, {
          block: { type: "thinking", thinking: "**Independent reasoning**\n\nDetailed second line." },
          blockIndex: 2,
          duration: 3,
        }),
      ));
      assert.match(html, new RegExp(`aria-expanded="${expanded}"`));
      assert.equal((html.match(/>[^<]*Independent reasoning[^<]*</g) ?? []).length, 1);
      assert.equal(html.includes("Detailed second line."), expanded);
      assert.match(html, /aria-label="Thinking: /);
      assert.match(html, /3s/);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("shows deferred thinking previews without loading the full content", () => {
  const html = renderMessage({
    role: "assistant",
    content: [{ type: "thinking", thinking: "Historical first line", deferred: true }],
  });
  assert.match(html, />Historical first line<\/span>/);
  assert.match(html, /aria-expanded="false"/);
});

test("marks only the matched text block after splitting thinking and the final answer", () => {
  const message = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "" },
      { type: "thinking", thinking: "Thinking about the result" },
      { type: "text", text: "Process text" },
      { type: "toolCall", toolCallId: "read-1", toolName: "read", input: {} },
      { type: "text", text: "First answer" },
      { type: "text", text: "Matched pi-cwd-spark answer" },
    ],
  };
  const { processBlocks, answerBlocks } = splitFinalAssistantBlocks(message);
  for (const index of [2, 4, 5]) {
    const searchBlock = message.content[index];
    for (const content of [processBlocks, answerBlocks]) {
      const html = renderMessage({ ...message, content }, { searchBlock });
      assert.equal((html.match(/data-search-target="true"/g) ?? []).length, content.includes(searchBlock) ? 1 : 0);
      if (content.includes(searchBlock)) {
        assert.match(html, new RegExp(`data-search-target="true">(?:(?!data-message-text)[\\s\\S])*${searchBlock.text}`));
      }
    }
  }
});

test("keeps streamed tool input out of collapsed markup while counting it", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-write-1",
    toolName: "write",
    input: {},
    rawInput: '{"path":"/tmp/file","content":"secret-stream-fragment',
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, { isStreaming: true });

  assert.match(html, /write/);
  assert.match(html, /Generating parameters/);
  assert.doesNotMatch(html, /secret-stream-fragment/);
  assert.equal(getToolCallInputText(block), block.rawInput);
  assert.equal(getTokenEstimateText(block), block.rawInput);
});

test("renders subagents as standard tool calls with only an extra session button", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-agent-1",
    toolName: "Agent",
    input: {
      subagent_type: "Explore",
      prompt: "Find the parser",
      description: "Find parser",
    },
  };
  const result = {
    role: "toolResult",
    toolCallId: block.toolCallId,
    content: [{ type: "text", text: "Parser is in lib/parser.ts" }],
    details: {
      kind: "pi-web-subagent",
      sessionId: "child-session",
      profile: "Explore",
      description: "Find parser",
      status: "completed",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, {
    toolResults: new Map([[block.toolCallId, result]]),
    onOpenSession() {},
  });

  // fork:design-components —— 工具卡收起态：透明时间轴行（border:none），不再是透明描边卡。
  assert.match(html, /border:none/);
  assert.match(html, />Agent</);
  assert.match(html, />Explore</);
  assert.match(html, /aria-label="Open sub-agent session"/);
  assert.doesNotMatch(html, />completed</);
  assert.doesNotMatch(html, />Find parser</);

  const ordinaryHtml = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [{ ...block, toolCallId: "call-extension-1", toolName: "extension_tool" }],
  }, {
    toolResults: new Map(),
    onOpenSession() {},
  });
  assert.doesNotMatch(ordinaryHtml, /Open sub-agent session/);
});

const COMPLETE_SKILL_EXPANSION = `<skill name="review" location="/skills/review/SKILL.md">
References are relative to /skills/review.

Review the supplied files.
</skill>

src/main.ts`;

test("renders a provider error when the assistant message has no content", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    stopReason: "error",
    errorMessage: "OpenAI API error (403): <html>request forbidden</html>",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /Error: OpenAI API error \(403\)/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
});

test("renders a turn-end row for stopReason length", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [{ type: "thinking", thinking: "Long reasoning chain" }],
    stopReason: "length",
  });

  // fork:design-system PR-11 — length 不再是告警块，改由回合结束行的徽章表达。
  assert.match(html, />length</);
  assert.match(html, /output limit/i);
  assert.match(html, /follow-up/i);
});

test("renders a turn-end row for thinking-only messages with stopReason length", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [],
    stopReason: "length",
  });

  assert.match(html, />length</);
  assert.match(html, /output limit/i);
});

test("renders partial assistant content before the provider error", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Partial response" }],
    stopReason: "error",
    errorMessage: "Connection closed",
  });

  assert.match(html, /Partial response/);
  assert.match(html, /Error: Connection closed/);
});

test("marks persisted assistant messages with their source entry", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Select this response" }],
  }, { entryId: "assistant-entry" });

  assert.match(html, /data-message-role="assistant"/);
  assert.match(html, /data-entry-id="assistant-entry"/);
});

test("renders a complete SDK skill expansion as a compact command", () => {
  const html = renderMessage({
    role: "user",
    content: COMPLETE_SKILL_EXPANSION,
  });

  assert.match(html, /\/skill:review/);
  assert.match(html, /src\/main\.ts/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Review the supplied files/);
});

test("renders user messages as right-aligned prompt bubbles", () => {
  const html = renderMessage({
    role: "user",
    content: "Make the conversation match the Codex layout.",
  });

  assert.match(html, /align-items:flex-end/);
  assert.match(html, /justify-content:flex-end/);
  // fork:design-components —— 用户气泡直接用画板 .pw-msg-user（右对齐 78% / 发丝边框 /
  // 面板底 / radius-6，board.css 承担视觉），不再有 inline 的背景与盒样式。
  assert.match(html, /class="pw-msg-user"/);
  assert.doesNotMatch(html, /background:var\(--user-bg\)/);
  assert.doesNotMatch(html, /max-width:88%/);
});

test("does not collapse incomplete skill-looking user text", () => {
  const html = renderMessage({
    role: "user",
    content: '<skill name="review" location="/skills/review/SKILL.md">\nordinary user text',
  });

  assert.match(html, /ordinary user text/);
  assert.doesNotMatch(html, /aria-expanded/);
});

test("keeps attached images when restoring a compact command for editing", () => {
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJDRA==" },
  };
  const restored = replaceUserMessageText({
    role: "user",
    content: [{ type: "text", text: COMPLETE_SKILL_EXPANSION }, image],
  }, "/skill:review src/main.ts");

  assert.deepEqual(restored.content, [
    { type: "text", text: "/skill:review src/main.ts" },
    image,
  ]);
});

test("renders user-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "user",
    content: [
      { type: "text", text: "inspect this" },
      { type: "image", data: "YWJj", mimeType: "image/png" },
    ],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("renders custom-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "custom",
    customType: "extension",
    content: [{ type: "image", data: "YWJj", mimeType: "image/png" }],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("shows tool-result images while the tool details stay collapsed", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-shot-1",
    toolName: "page_screenshot",
    input: { tabId: 7 },
  };
  const result = {
    role: "toolResult",
    toolCallId: block.toolCallId,
    content: [
      { type: "text", text: "captured-1280x720" },
      { type: "image", data: "YWJj", mimeType: "image/png" },
    ],
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, { toolResults: new Map([[block.toolCallId, result]]) });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
  assert.doesNotMatch(html, /captured-1280x720/);
  assert.doesNotMatch(html, /"tabId"/);
});

test("links the opt-in URL inside a provider error", () => {
  const message = {
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: 'OpenAI API error (403): {"type":"DataPolicyError","message":"This model collects data used to improve its quality and requires explicit opt in: https://opencode.ai/workspace/wrk_01KVXVWRFS6QMPTM29S0S8280B/go"}',
  };
  const html = renderMessage(message);

  assert.match(html, /<a [^>]*href="https:\/\/opencode\.ai\/workspace\/wrk_01KVXVWRFS6QMPTM29S0S8280B\/go"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /DataPolicyError/);
});

// fork:design-components —— 下面这些断言钉住「转录卡片由画板件承载」这条结构契约：
// DOM 抄自画板 10 / 11 / 12，类名与嵌套不得退回自绘形态。

test("renders the user action row as the board's pw-msg-acts with pw-btn members", () => {
  const html = renderMessage(
    { role: "user", content: "revert this turn", timestamp: Date.parse("2026-09-29T10:00:00Z") },
    {
      entryId: "user-entry",
      onNavigate: async () => true,
      onFork() {},
      onRewind() {},
    },
  );

  // 画板 10 B：整行 .pw-msg-acts，成员一律 .pw-btn.sm + .pw-ico + i[data-ico]
  assert.match(html, /class="pw-msg-acts"/);
  assert.doesNotMatch(html, /fork-msg-actions/);
  assert.match(html, /class="pw-btn sm"/);
  // 复制钮的字形由 fork/CopyStateIcon 提供（形变动画不在本轮范围），
  // 另三个动作按画板 10 B 抄 data-ico：编辑 / 分支 / 从此处回退。
  assert.match(html, /<i data-ico="pencil-line"/);
  assert.match(html, /<i data-ico="git-branch"/);
  assert.match(html, /<i data-ico="undo-2"/);
  // 行为零变化：四个动作仍然各是一个真 button，带 title。
  assert.equal((html.match(/<button[^>]+title="[^"]*"/g) ?? []).length >= 4, true);
});

// fork:design-components —— 类名改名时的同步守卫（2026-09-30 事故）。
//
// board.css 只给 `.pw-msg-acts` 一个 `opacity: 0`；显隐由 app/fork-ui.css 的
// 行为钩子按产品的真实结构（动作行是 [data-message-role] 的直接子节点）承担。
// 换肤把类名从 `.fork-msg-actions` 改成 `.pw-msg-acts` 时只改了 tsx、漏改了 CSS，
// 而旧断言只钉「HTML 里有 .pw-msg-acts」 —— 结果动作行恒为透明，没有任何测试变红。
// 这个守卫钉住「两边的类名是同一个」：任一例改名/倒退都会失败。
test("pw-msg-acts 的显隐钩子与组件类名同步（board.css 只给 opacity:0）", async () => {
  const css = await readFile(new URL("../app/fork-ui.css", import.meta.url), "utf8");
  assert.match(css, /\[data-message-role\]:hover > \.pw-msg-acts/);
  assert.match(css, /\.pw-msg-acts:focus-within/);
  // 注释里允许提旧名（要记历史）；**选择器**里不许再有它。
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /\.fork-msg-actions\b/);
  const boardCss = await readFile(
    new URL("../design/pi-web-design/assets/board.css", import.meta.url),
    "utf8",
  );
  assert.match(boardCss, /\.pw-msg-acts \{[^}]*opacity: 0/);
  assert.match(
    renderMessage({ role: "user", content: "再跑一次就好", timestamp: Date.parse("2026-09-30T10:00:00Z") }),
    /class="pw-msg-acts"/,
  );
});

test("carries the provider error in the board's pw-alert with its icon slot", () => {
  const html = renderMessage({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "upstream connection reset",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /class="pw-alert"/);
  assert.match(html, /<span class="pw-ico"><i data-ico="circle-x"/);
  // 错误原文仍在等宽块里（.pw-term），链接拆分照旧。
  assert.match(html, /class="pw-term"/);
  assert.match(html, /upstream connection reset/);
  // 旧的自绘错误框（danger-soft + radius-md 内联）不再出现。
  assert.doesNotMatch(html, /--danger-soft/);
});

test("offers the oversized-message reveal as a pw-alert button and a pw-term body", () => {
  const html = renderMessage({
    role: "user",
    content: "x".repeat(120_000),
  });

  // 画板 12 的提示条形态：整条可点，info 态 + info 图标。
  assert.match(html, /<button[^>]+class="pw-alert info"/);
  assert.match(html, /<i data-ico="info"/);
  assert.match(html, /Message content is very large/);
  // 未展开：原始正文不进 DOM（.pw-term 只在展开后出现）。
  assert.doesNotMatch(html, /class="pw-term"/);
});

test("renders a tool-call diff with the board's pw-diff head, body and lines", () => {
  const patch = [
    "--- a/hooks/useResizablePanel.ts",
    "+++ b/hooks/useResizablePanel.ts",
    "@@ -38,3 +38,3 @@",
    " const [width, setWidth] = useState(opts.initialWidth);",
    "-const clamp = (v) => Math.min(Math.max(v, 220), 480);",
    "+const clamp = (v) => Math.min(Math.max(v, opts.min), opts.max);",
  ].join("\n");
  const block = {
    type: "toolCall",
    toolCallId: "call-apply-1",
    toolName: "apply_patch",
    input: {},
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, {
    toolResults: new Map([[block.toolCallId, {
      role: "toolResult",
      toolCallId: block.toolCallId,
      toolName: block.toolName,
      content: [{ type: "text", text: "patched" }],
      details: { patch },
    }]]),
    expandedToolIds: new Set([block.toolCallId]),
    onToggleTool() {},
  });

  assert.match(html, /class="pw-diff-body"/);
  assert.match(html, /class="pw-diff-line/);
  assert.match(html, /class="pw-diff-line add"/);
  assert.match(html, /class="pw-diff-line del"/);
  assert.match(html, /<span class="no">/);
  assert.match(html, /<span class="sign">/);
  // diff 卡外面挂画板 11 的 .pw-card-body（顶部发丝线 + 面板底）。
  assert.match(html, /class="pw-card-body"/);
});

test("carries tool-result images in the board's pw-img frame", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-shot-2",
    toolName: "page_screenshot",
    input: { tabId: 9 },
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, { toolResults: new Map([[block.toolCallId, {
    role: "toolResult",
    toolCallId: block.toolCallId,
    toolName: block.toolName,
    content: [{ type: "image", data: "YWJj", mimeType: "image/png" }],
  }]]) });

  assert.match(html, /class="pw-img"/);
  assert.match(html, /class="pw-card-body"/);
  // 旧的自绘图片容器（720px 上限 + 内联 border）不再出现。
  assert.doesNotMatch(html, /min\(100%, 720px\)/);
});

test("carries a custom extension message in the board's pw-card head/body/foot", () => {
  const html = renderMessage({
    role: "custom",
    customType: "extension",
    content: "hello from the extension",
    display: true,
    details: { ok: true },
    timestamp: Date.parse("2026-09-29T10:00:00Z"),
  });

  assert.match(html, /class="pw-card"/);
  assert.match(html, /class="pw-card-head"/);
  assert.match(html, /class="pw-card-body"/);
  assert.match(html, /class="pw-card-foot"/);
  assert.match(html, /class="pw-btn sm"/);
  // 旧的自绘卡（fontWeight:650 的标题 + 内联 border）不再出现。
  assert.doesNotMatch(html, /font-weight:650/);
  assert.doesNotMatch(html, /fontWeight:650/);
});

test("carries a tool result body in the board's pw-term inside pw-card-body", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-echo-1",
    toolName: "bash",
    input: { command: "echo hi" },
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, {
    toolResults: new Map([[block.toolCallId, {
      role: "toolResult",
      toolCallId: block.toolCallId,
      toolName: block.toolName,
      content: [{ type: "text", text: "hi" }],
    }]]),
    expandedToolIds: new Set([block.toolCallId]),
    onToggleTool() {},
  });

  assert.match(html, /class="pw-card-body"/);
  assert.match(html, /class="pw-term"/);
  assert.match(html, /hi/);
});

test("renders no hand-drawn inline svg in the transcript", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [
      { type: "text", text: "answer" },
      { type: "thinking", thinking: "thought" },
      { type: "toolCall", toolCallId: "call-read-9", toolName: "read", input: { path: "a.ts" } },
    ],
    stopReason: "stop",
  }, {
    toolResults: new Map([["call-read-9", {
      role: "toolResult",
      toolCallId: "call-read-9",
      toolName: "read",
      content: [{ type: "text", text: "file body" }],
    }]]),
  });

  // MessageView 自己不再有任何手绘图标：工具卡首列与展开箭头都走 <i data-ico>
  // （客户端由 icons.js hydrate 成 lucide SVG）。
  assert.match(html, /<i data-ico="book-open"/);
  assert.match(html, /<i data-ico="chevron-down"/);
  assert.match(html, /class="pw-turn-end"/);
  // 工具卡图标槽是 <i data-ico>，不是内联 svg 路径。
  assert.doesNotMatch(html, /<span class="pw-ico"><svg/);
});
test("carries the thinking body in the board's pw-think and the duration in pw-dim", async () => {
  const source = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ThinkingBlock, {
        block: { type: "thinking", thinking: "first line of reasoning" },
        duration: 3,
      }),
    ),
  );

  // 思考块默认收起，正文不进 SSR 快照（同压缩卡那条用例的理由），
  // 所以正文结构在源码上钉，渲染侧只钉收起态的外壳没回退。
  assert.match(source, /className="fork-collapse-body pw-muted pw-think"/);
  assert.match(source, /className="pw-dim"/);
  assert.match(html, /aria-expanded="false"/);
});

test("carries the compaction file list in the board's pw-filecard rows", () => {
  // 压缩卡默认收起，正文不进 SSR 快照，所以文件清单的结构在源码上钉；
  // 渲染侧只钉外壳没回退。
  const html = renderMessage({
    role: "custom",
    customType: "compaction",
    content: "压掉 12 轮。\n\n<read-files>\ncomponents/MessageView.tsx\n</read-files>",
    display: true,
    timestamp: Date.parse("2026-09-29T10:00:00Z"),
  });
  assert.match(html, /class="pw-compact"/);

  // 文件清单 = .pw-list 容器 + 每行一张 .pw-filecard：file 图标 + .pw-fname 全路径 +
  // .pw-meta 后缀（画板 12 的「资源文件 / 兜底文件卡」形态）。
  assert.match(source, /<ul className="pw-list"/);
  assert.match(source, /<li key=\{file\} className="pw-filecard">/);
  assert.match(source, /className="pw-fname">\{file\}<\/span>/);
  assert.match(source, /className="pw-meta">\{fileExtension\(file\)\}/);
  assert.match(source, /<i data-ico="file" data-size="14"/);
  // 旧的自绘列表（compaction-file-list）不再挂载。
  assert.doesNotMatch(source, /className="compaction-file-list"/);
});
