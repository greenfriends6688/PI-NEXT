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
  formatDuration,
  formatUsage,
  formatUsageCost,
  rowUsageOf,
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
      // 思考块头与回合结束行共用 formatDuration：≥ 1s 一位小数（3 → 3.0s）。
      assert.match(html, /3\.0s/);
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

  // fork:v5-landing — length 由回合结束行（画板 D-03c 的 .d-turn-end）表达。
  assert.match(html, /class="d-turn-end"/);
  assert.match(html, /length/);
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

  assert.match(html, /class="d-turn-end"/);
  assert.match(html, /length/);
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
  // fork:v5-landing —— 用户气泡直接用画板 D-03 A 的 .d-msg-user（右对齐 78% /
  // 强调底 / 右下小圆角，system.css 承担视觉）。
  assert.match(html, /class="d-msg-user"/);
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

test("renders the user action row as the board's d-msg-acts with d-btn members", () => {
  const html = renderMessage(
    { role: "user", content: "revert this turn", timestamp: Date.parse("2026-09-29T10:00:00Z") },
    {
      entryId: "user-entry",
      onNavigate: async () => true,
      onFork() {},
      onRewind() {},
    },
  );

  // 画板 D-03b 帧 A2：整行 .d-msg-acts，成员一律 .d-btn.sm + i[data-ico]
  assert.match(html, /class="d-msg-acts"/);
  assert.doesNotMatch(html, /fork-msg-actions/);
  assert.match(html, /class="d-btn sm"/);
  // 复制钮的字形由 fork/CopyStateIcon 提供（形变动画不在本轮范围），
  // 另三个动作按画板 10 B 抄 data-ico：编辑 / 分支 / 从此处回退。
  assert.match(html, /<i data-ico="pencil-line"/);
  assert.match(html, /<i data-ico="git-branch"/);
  assert.match(html, /<i data-ico="undo-2"/);
  // 行为零变化：四个动作仍然各是一个真 button，带 title。
  assert.equal((html.match(/<button[^>]+title="[^"]*"/g) ?? []).length >= 4, true);
});

// fork:v5-landing —— 动作行显隐守卫。
//
// 换皮后组件 DOM 只带 v5 类：`.d-msg-acts` 默认 `opacity: 0`。助手行在 `.d-msg-ai` 内部，
// 由 system.css 的 `.d-msg-ai:hover .d-msg-acts` 显隐；用户行是气泡的**兄弟**，
// 那条规则不成立，由 React 在 hover/focus 时挂 `.is-on`（同 ChatWorkspaceRow / SessionSidebar）。
// 旧的 app/fork-ui.css `.pw-msg-acts` 钩子不在组件上留残：组件不得再挂 pw-*。
test("d-msg-acts 显隐：v5 类 + React is-on，且不再挂 pw-msg-acts", async () => {
  const systemCss = await readFile(new URL("../design/v5/web/system.css", import.meta.url), "utf8");
  assert.match(systemCss, /\.d-msg-acts \{[^}]*opacity: 0/);
  assert.match(systemCss, /\.d-msg-ai:hover \.d-msg-acts, \.d-msg-user:hover \.d-msg-acts/);
  const source = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
  assert.ok(source.includes('d-msg-acts${actionsVisible ? " is-on" : ""}'), "用户行 hover/focus 挂 is-on");
  assert.ok(source.includes('d-msg-acts${actionsFocused ? " is-on" : ""}'), "助手行键盘焦点挂 is-on");
  assert.doesNotMatch(source, /pw-msg-acts/);
  assert.match(
    renderMessage({ role: "user", content: "再跑一次就好", timestamp: Date.parse("2026-09-30T10:00:00Z") }),
    /class="d-msg-acts"/,
  );
});

test("carries the provider error in the board's d-banner err with its icon slot", () => {
  const html = renderMessage({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "upstream connection reset",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /class="d-banner err"/);
  assert.match(html, /<i data-ico="circle-x"/);
  // 错误原文仍在等宽块里（.d-term.plain），链接拆分照旧。
  assert.match(html, /class="d-term plain"/);
  assert.match(html, /upstream connection reset/);
  // 旧的自绘错误框（danger-soft + radius-md 内联）不再出现。
  assert.doesNotMatch(html, /--danger-soft/);
});

test("offers the oversized-message reveal as a d-banner info button and a d-term body", () => {
  const html = renderMessage({
    role: "user",
    content: "x".repeat(120_000),
  });

  // 画板 D-03e 的提示条形态：整条可点，info 态 + info 图标。
  assert.match(html, /<button[^>]+class="d-banner info"/);
  assert.match(html, /<i data-ico="info"/);
  assert.match(html, /Message content is very large/);
  // 未展开：原始正文不进 DOM（.d-term 只在展开后出现）。
  assert.doesNotMatch(html, /class="d-term plain"/);
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

  assert.match(html, /class="d-diff"/);
  assert.match(html, /class="d-diff-line/);
  assert.match(html, /class="d-diff-line add"/);
  assert.match(html, /class="d-diff-line del"/);
  assert.match(html, /<span class="no">/);
  assert.match(html, /<span class="sign">/);
  // diff 卡外面挂画板 D-03d 的 .d-tool-body（顶部发丝线 + 面板底）。
  assert.match(html, /class="d-tool-body"/);
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

  assert.match(html, /class="d-placeholder"/);
  assert.match(html, /class="d-tool-body"/);
  // 旧的自绘图片容器（720px 上限 + 内联 border）不再出现。
  assert.doesNotMatch(html, /min\(100%, 720px\)/);
});

test("carries a custom extension message in the board's d-card head/body", () => {
  const html = renderMessage({
    role: "custom",
    customType: "extension",
    content: "hello from the extension",
    display: true,
    details: { ok: true },
    timestamp: Date.parse("2026-09-29T10:00:00Z"),
  });

  assert.match(html, /class="d-card"/);
  assert.match(html, /class="d-card-head"/);
  assert.match(html, /class="d-card-body"/);
  assert.match(html, /class="d-btn sm"/);
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

  assert.match(html, /class="d-tool-body"/);
  assert.match(html, /class="d-term plain"/);
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
  assert.match(html, /class="d-turn-end"/);
  // 工具卡图标槽是 <i data-ico>，不是内联 svg 路径。
  assert.doesNotMatch(html, /<span class="pw-ico"><svg/);
});
test("carries the thinking body in the board's d-think-body and the duration in d-think-timer", async () => {
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
  assert.match(source, /className={`fork-collapse-body d-think-body/);
  assert.match(source, /className="d-think-timer"/);
  assert.match(html, /aria-expanded="false"/);
});

test("carries the compaction file list in the board's d-row rows", () => {
  // 压缩卡默认收起，正文不进 SSR 快照，所以文件清单的结构在源码上钉；
  // 渲染侧只钉外壳没回退。
  const html = renderMessage({
    role: "custom",
    customType: "compaction",
    content: "压掉 12 轮。\n\n<read-files>\ncomponents/MessageView.tsx\n</read-files>",
    display: true,
    timestamp: Date.parse("2026-09-29T10:00:00Z"),
  });
  assert.match(html, /class="d-card"/);

  // 文件清单 = .d-col 容器 + 每行一条 .d-row.d-mono.d-t-xs：file 图标 + .d-grow 全路径 +
  // .d-t-xs.d-t-faint 后缀（画板 D-03 帧 C 的「已写文件」形态）。
  assert.match(source, /<ul className="d-col"/);
  assert.match(source, /<li key=\{file\} className="d-row d-mono d-t-xs">/);
  assert.match(source, /className="d-grow">\{file\}<\/span>/);
  assert.match(source, /className="d-t-xs d-t-faint">\{fileExtension\(file\)\}/);
  assert.match(source, /<i data-ico="file" data-size="14"/);
  // 旧的自绘列表（compaction-file-list）不再挂载。
  assert.doesNotMatch(source, /className="compaction-file-list"/);
});

// 亚秒耗时不能一律显示 0.0s：< 1s 走毫秒，< 1ms 兜底成 <1ms。
test("formats sub-second durations in milliseconds instead of 0.0s", () => {
  assert.equal(formatDuration(0), "<1ms");
  assert.equal(formatDuration(0.0004), "<1ms");
  assert.equal(formatDuration(0.012), "12ms");
  assert.equal(formatDuration(0.9994), "999ms");
  assert.equal(formatDuration(1), "1.0s");
  assert.equal(formatDuration(4.24), "4.2s");
  assert.equal(formatDuration(59.96), "60.0s");
  assert.equal(formatDuration(60), "1m00s");
  assert.equal(formatDuration(220), "3m40s");
});

// fix:turn-stats（用户 2026-10-01：「这个咋又是毫秒啊……统计的一点都不准」，
// 「后面的是输入、输出的 token 吗，本轮花多少金额咋没写啊」）。真数据：
// input=71 / cacheRead=240,830 / output=338 / 落盘比调用开始晚 6.2s。
test("the turn row counts the whole prompt (input + cache) and always shows a cost cell", () => {
  // 光报 usage.input 会显示「↑ 71」，而模型实际读了 24 万 —— 那才是不准。
  assert.equal(formatUsage({ input: 71, output: 338, cacheRead: 240830, cacheWrite: 0 }), "↑ 241k · ↓ 338 tok");
  assert.equal(formatUsage({ input: 8912, output: 1328, cacheRead: 0, cacheWrite: 0 }),
    "↑ 8,912 · ↓ 1,328 tok", "board 12's vocabulary still holds when there is no cache");
  assert.equal(formatUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), "");
  // 金额只在真的有费用时出现（用户裁定 2026-10-01「那就把这个金额去掉吧」：免费 / 不上报
  // 价格的模型常年一格 $0.000 是噪声）。
  assert.equal(formatUsageCost({ costTotal: 0.0212 }), "$0.021");
  assert.equal(formatUsageCost({ costTotal: 0 }), null, "free model → no amount cell");
});

// fix:turn-stats 二轮（用户裁定：「应该是 ai 每轮任务的时候，从每轮思考一直到本轮结束的
// 时间吧……你看像输入、输出，以及金额，不也是这么算的吗」）：四格必须是**本轮**口径。
test("the turn row reads the whole-turn aggregate ChatWindow computed", async () => {
  const { computeTurnStats } = await import("../lib/turn-stats.ts");
  const usage = (input, output, cost) => ({
    input, output, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  });
  const messages = [
    { role: "user", content: "hi", timestamp: 0 },
    { role: "assistant", content: [], model: "m", provider: "p", stopReason: "toolUse", timestamp: 2000, completedAt: 8200, usage: usage(17_564, 161, 0) },
    { role: "toolResult", toolCallId: "t1", content: [], timestamp: 9000 },
    { role: "assistant", content: [], model: "m", provider: "p", stopReason: "stop", timestamp: 10_000, completedAt: 20_400, usage: usage(2000, 900, 0.01) },
  ];
  const stats = computeTurnStats(messages);
  const last = stats.get(3);
  // 最后一行：本轮 20.4s、输入 19,564、输出 1,061、费用 $0.010 —— 一个口径。
  assert.equal(last.elapsedSec, 20.4);
  // 渲染路径：TurnStats / AgentUsage 两个来源都先归一到 RowUsage，再进同一套格式化。
  const row = rowUsageOf(last, messages[3].usage);
  assert.equal(formatUsage(row), "↑ 20k · ↓ 1,061 tok", "19,564 过万走紧凑");
  assert.equal(formatUsageCost(row), "$0.010");
  assert.deepEqual(rowUsageOf(undefined, messages[3].usage), {
    input: 2000, output: 900, cacheRead: 0, cacheWrite: 0, costTotal: 0.01,
  }, "没有本轮快照时退回这条消息自己的 usage");
  assert.equal(rowUsageOf(undefined, undefined), null);
  // 中间那行只见到自己那一步（3k 输入 / 1.4s），不借用后面的数据。
  assert.equal(stats.get(1).elapsedSec, 8.2);
  assert.equal(formatUsage(stats.get(1)), "↑ 18k · ↓ 161 tok", "中间那行只看得到自己那一步（17,564 过万走紧凑）");
  // ChatWindow 必须把快照传下来（每个助手消息一份）。
  const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(chatWindow, /const turnStatsByIndex = useMemo\(\(\) => computeTurnStats\(messages\), \[messages\]\)/);
  assert.match(chatWindow, /turnStats=\{turnStatsByIndex\.get\(idx\)\}/);
  assert.match(source, /const durationSec = turnStats\?\.elapsedSec \?\? stepDurationSec;/);
  // 单步 / 多步两条说明分开：多步才提“这一步模型 Xs”，单步不要留一个空尾巴。
  assert.match(source, /turnStats && turnStats\.steps > 1 && stepDurationSec !== null/);
  assert.match(source, /chat\.turnEnd\.durationHintTurnSteps/);
  assert.doesNotMatch(source, /step: ""/);
});

test("durations come from the entry append time, not the gap to the previous message", async () => {
  // message.timestamp = 调用开始；completedAt = 条目落盘（= 响应写完）。
  assert.match(source, /completedAt\?: number/);
  assert.match(source, /const stepDurationSec = message\.timestamp && generationEnd/);
  assert.match(source, /const toolStart = generationEnd \?\? message\.timestamp;/);
  assert.doesNotMatch(source, /const durationSec = prevTimestamp && message\.timestamp/);
  // 服务端与流式路径都要给出 completedAt。
  const reader = await readFile(new URL("../lib/session-reader.ts", import.meta.url), "utf8");
  assert.match(reader, /completedAt: parseEntryTimestamp\(entry\.timestamp\)/);
  const hook = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  assert.match(hook, /completedAt: Date\.now\(\)/);
});

test("fork:fix-user-line-breaks — 粘贴的纯文本每一行都在（#680 / #1015）", () => {
  const lines = [
    "第1题（看门狗）",
    "嵌入式系统中，看门狗（WatchDog）的基本工作原理是（ ）",
    "A. 监控系统温度，过热时自动降频",
    "B. 计数器自动计数，程序定期将其重置；若程序跑飞计数器溢出，则系统复位重启",
  ];
  const expected = `<p>${lines.join("<br/>")}</p>`;

  for (const lineEnding of ["\n", "\r\n", "\r"]) {
    const html = renderMessage({ role: "user", content: lines.join(lineEnding) });
    assert.ok(html.includes(expected), JSON.stringify(lineEnding));
    // Chrome 在 pre-wrap 下也把落单 \r 渲染成空格，所以文本里不能留 \r。
    assert.doesNotMatch(html, /\r/);
  }

  const listHtml = renderMessage({
    role: "user",
    content: [{ type: "text", text: "1. 看门狗的原理是（ ）\nA. 监控温度\nB. 计数器" }],
  });
  assert.match(listHtml, /<li>看门狗的原理是（ ）<br\/>A\. 监控温度<br\/>B\. 计数器<\/li>/);
}
);
