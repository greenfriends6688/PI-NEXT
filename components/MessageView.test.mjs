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
  rowUsageOf,
  getModelDisplayName,
  getTokenEstimateText,
  getToolCallInputText,
  replaceUserMessageText,
  countOutputLines,
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

// fork:remove-turn-end（用户裁定 2026-10）—— 回合结束行整行删除：身份行的
// `.d-plan-meta` 与统计浮窗已经交代本轮耗时 / token，这条重复行连同截断徽章一起去掉。
test("renders no turn-end row for any stopReason", () => {
  for (const stopReason of ["stop", "toolUse", "length", "aborted", "error"]) {
    const html = renderMessage({
      role: "assistant",
      provider: "anthropic",
      model: "claude-test",
      content: [{ type: "text", text: "done" }],
      stopReason,
    });
    assert.doesNotMatch(html, /d-turn-end/, `stopReason=${stopReason} 仍然画了回合结束行`);
    assert.doesNotMatch(html, /tok/, `stopReason=${stopReason} 仍然画了用量格`);
  }
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
  // fork:v5-frame-audit —— 行就是一行文本（画板 D-03d 帧 C / D-03 帧 B 的
  // `<span class="d-diff-line del">- 40   …`）：行号与 +/− 符号是行文本的一部分。
  // 此前是两个空壳 span（`.no` / `.sign` 在 v5 库里一条规则都没有），已合并。
  assert.doesNotMatch(html, /<span class="no">/);
  assert.doesNotMatch(html, /<span class="sign">/);
  assert.match(html, /class="d-diff-line"[^>]*>38 const \[width/);
  assert.match(html, /class="d-diff-line del"[^>]*>39 − /);
  // diff 卡外面挂画板 D-03d 的 .d-tool-body（顶部发丝线 + 面板底）。
  assert.match(html, /class="d-tool-body"/);
  // fork:v5-wave-n1 —— 分栏本体 = 画板 D-03d 帧 C「分栏」那一段：
  // .d-diff-split › 左栏（.d-diff-head + .d-diff）› .d-sep-v › 右栏（同构）。
  assert.match(html, /class="d-diff-split"/, "分栏外壳是画板的 .d-diff-split");
  assert.match(html, /class="d-sep-v"/, "两栏之间是那一竖条 .d-sep-v");
  assert.equal(
    (html.match(/class="d-diff"/g) ?? []).length,
    2,
    "两侧各自一块 .d-diff（各自横滚，板上原话）",
  );
  assert.doesNotMatch(html, /--n-border-subtle/, "旧的 v1 分隔线令牌不再出现在这一段");

  // 两份文件时才起表头（板上分栏帧是单文件起头；产品沿用「多文件才起头」的既有判定），
  // 表头逐字是画板那一枚：`<i data-ico="chevron-left|right">` + 路径。
  const twoFiles = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [{
      type: "toolCall",
      toolCallId: "call-apply-2",
      toolName: "apply_patch",
      input: {
        input: [
          "*** Begin Patch",
          "*** Update File: hooks/a.ts",
          "-const a = 1;",
          "+const a = 2;",
          "*** Update File: hooks/b.ts",
          "-const b = 1;",
          "+const b = 2;",
          "*** End Patch",
        ].join("\n"),
      },
    }],
  }, { expandedToolIds: new Set(["call-apply-2"]), onToggleTool() {} });

  assert.match(twoFiles, /<i data-ico="chevron-left" data-size="12"/, "左栏表头带 chevron-left");
  assert.match(twoFiles, /<i data-ico="chevron-right" data-size="12"/, "右栏表头带 chevron-right");
  assert.match(twoFiles, /hooks\/a\.ts/, "左栏表头是改前路径");
  assert.match(twoFiles, /hooks\/b\.ts/, "右栏表头是改后路径");
});

test("fork:v5-wave-n1 —— 压缩卡 / 扩展消息卡在窄屏走 m-card 三件（d-* 在 ≤640px 是零样式）", () => {
  assert.match(source, /className=\{isPwa \? "m-card" : "d-card"\}/, "卡壳按形态换");
  assert.match(source, /className=\{isPwa \? "m-card-head" : "d-card-head"\}/, "卡头按形态换");
  assert.match(source, /className=\{isPwa \? "m-card-body" : "d-card-body"\}/, "卡体按形态换");
  assert.match(source, /className=\{isPwa \? "m-code" : "d-term plain"\}|<div className="m-code">/, "details JSON 在窄屏走 .m-code");
});

test("fork:v5-wave-n1 —— 终端卡带 $ 提示符行与 .d-terminfo 尾条（M-02 那套 m-* 同源）", () => {
  // 画板 D-03 帧 B / D-03d 帧 D 的终端卡体：
  //   .d-tool-body › .d-term › <div><span class="d-term-prompt">$</span> 命令</div> › .d-terminfo
  // 窄屏同一段抄 M-02 帧 B：.m-code › .m-code-head（含 .m-term-ok）› .m-code-body（含 .m-term-prompt）。
  assert.match(source, /<span className="d-term-prompt">\$<\/span>/, "命令行的 $ 是 .d-term-prompt");
  assert.match(source, /<div className="d-terminfo">/, "尾部那条信息是 .d-terminfo");
  assert.match(source, /className="d-term" style=\{\{ minHeight: 0 \}\}/, "输出块是 .d-term（min-height:0 是板上原话）");
  assert.match(source, /className="m-term-prompt"/, "窄屏那一行是 M-02 的 .m-term-prompt");
  assert.match(source, /className="m-term-ok"/, "窄屏卡头右格是 M-02 的 .m-term-ok");
  // 只有「用户自己敲的命令」那张卡带尾条（agent 的工具调用拿不到退出码/截断位）。
  assert.match(
    source,
    /<ToolCallBlock block=\{block\} result=\{result\} terminal=\{\{/,
    "BashExecutionView 把终端信息递给同一张工具卡",
  );
  assert.equal(countOutputLines("a\nb\nc\n"), 3, "尾部「几行」不把结尾换行算成一行");
  assert.equal(countOutputLines("only"), 1);
  assert.equal(countOutputLines(""), 0);
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

// fix:turn-stats 二轮（用户裁定：「应该是 ai 每轮任务的时候，从每轮思考一直到本轮结束的
// 时间吧……你看像输入、输出，以及金额，不也是这么算的吗」）：身份行的 `.d-plan-meta`
// 与回合结束行共用**本轮**口径；回合结束行删除后，这套聚合只剩身份行一个消费者。
test("the identity row reads the whole-turn aggregate ChatWindow computed", async () => {
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
  // 最后一条：本轮 20.4s、输入 19,564、输出 1,061、费用 $0.010 —— 一个口径。
  assert.equal(last.elapsedSec, 20.4);
  // 渲染路径：TurnStats / AgentUsage 两个来源都先归一到 RowUsage，再进同一套格式化。
  // 本轮口径：两步入（17,564 + 2,000 = 19,564）与两路出（161 + 900 = 1,061）合起来。
  assert.deepEqual(rowUsageOf(last, messages[3].usage), {
    input: 19564, output: 1061, cacheRead: 0, cacheWrite: 0, costTotal: 0.01,
  });
  assert.deepEqual(rowUsageOf(undefined, messages[3].usage), {
    input: 2000, output: 900, cacheRead: 0, cacheWrite: 0, costTotal: 0.01,
  }, "没有本轮快照时退回这条消息自己的 usage");
  assert.equal(rowUsageOf(undefined, undefined), null);
  // 中间那条只见到自己那一步（8.2s），不借用后面的数据。
  assert.equal(stats.get(1).elapsedSec, 8.2);
  // ChatWindow 必须把快照传下来（每个助手消息一份）。
  const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(chatWindow, /const turnStatsByIndex = useMemo\(\(\) => computeTurnStats\(messages\), \[messages\]\)/);
  assert.match(chatWindow, /turnStats=\{turnStatsByIndex\.get\(idx\)\}/);
  // 身份行的 `.d-plan-meta`（耗时 · token）是本轮唯一的行内读数。
  assert.match(source, /const headDurationSec = turnStats\?\.elapsedSec \?\? stepDurationSec;/);
  assert.match(source, /const headPlanMeta = isStreaming \|\| headDurationSec === null \|\| !headRowUsage/);
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

// fork:v5-landing —— 转录区的四个活标记（画板 D-03 帧 B / D-03d 帧 A / D-27 帧 A/B、
// M-02 帧 A、M-11 帧 D/E）。四件都只挂在「还在长的那一块」上，所以分两条钉：
// 一条渲染（桌面形态在 SSR 里就是确定的），一条源码（窄屏分支由 usePwaSkin 在
// hydration 之后才翻，SSR 拿不到 —— 与仓库里其余 m-* 用例同一口径）。
test("流式正文段 = 画板的 .d-stream + 单字光标 .d-caret（稳定前缀照旧走 .d-md）", () => {
  const html = renderMessage({
    role: "assistant",
    content: [{ type: "text", text: "first paragraph.\n\nsecond is still coming" }],
  }, { isStreaming: true });

  // 已经落定的段落仍是 markdown 正文（.d-md > p），没有被拖进流式段。
  assert.match(html, /<div class="d-md"><p>first paragraph\.<\/p><\/div>/);
  // 还在长的那一段才是流式段：光标紧跟句子末尾，与画板
  // `<p class="d-stream">…<span class="d-caret"></span></p>` 同形。
  assert.match(html, /<p class="d-stream">second is still coming<span class="d-caret" aria-hidden="true"><\/span><\/p>/);
});

test("非流式消息不带光标：.d-stream / .d-caret 只在 isStreaming 的尾块上", () => {
  const html = renderMessage({
    role: "assistant",
    content: [{ type: "text", text: "settled answer" }],
  });
  assert.doesNotMatch(html, /d-stream/);
  assert.doesNotMatch(html, /d-caret/);
});

test("窄屏的流式段 / 实时文字 / 思考行走 m-*（M-02 帧 A、M-11 帧 D/E）", () => {
  // 窄屏分支与画板逐字对齐：`.m-stream` + `.m-caret`、`.m-run > .m-text-live`、
  // `.m-think-row`（图案 + 文案 + grow + 等宽秒数）。
  assert.match(source, /className=\{isPwa \? "m-stream" : "d-stream"\}/);
  assert.match(source, /className=\{isPwa \? "m-caret" : "d-caret"\}/);
  assert.match(source, /<div className="m-run">/);
  assert.match(source, /<span className="m-text-live">\{t\("chat\.running"\)\}<\/span>/);
  assert.match(source, /<div className="m-think-row">/);
  assert.match(source, /className="m-mono m-t-xs m-t-faint">\{formatDuration\(liveSeconds\)\}/);
});

test("思考行 = 画板 D-03d 帧 A / D-27 帧 A 的 .d-think-row（点阵 + 流光标签 + 秒表）", () => {
  assert.match(source, /<div className="d-think-row">/);
  assert.match(source, /<span className="d-shimmer">\{t\("i18n\.thinking"\)\}<\/span>/);
  assert.match(source, /<span className="d-think-timer d-num">\{formatDuration\(liveSeconds\)\}<\/span>/);
  // 秒表是真的在走：1s 心跳，非流式不建定时器。
  assert.match(source, /function useLiveSeconds\(active: boolean\): number \{/);
  assert.match(source, /if \(!active\) \{[\s\S]{0,80}setSeconds\(0\)/);
});

test("todo 工具结果画成画板 D-03 帧 C 的计划卡（真实步骤 → .d-plan-rail）", () => {
  assert.match(source, /import \{ PlanDocumentCard, PlanRail, type PlanRailStep \} from "\.\/fork\/PlanDocumentCard"/);
  assert.match(source, /const todo = !result\?\.isError && isTodoDetails\(result\?\.details\) \? result\.details : null;/);
  // 「进行中」= 最老的一条未完成项（todo 工具没有 current 字段，与 TodoChip 同口径）。
  assert.match(source, /const activeId = todo\.todos\.find\(\(item\) => !item\.done\)\?\.id \?\? null;/);
  assert.match(source, /<span className="d-grow">\{t\("chat\.todos"\)\}<\/span>/);
  assert.match(source, /<PlanRail steps=\{todoSteps\} \/>/);
});

test("思考行只画在尾块上：isStreamingTail 由 AssistantMessageView 逐块算，不各自另算", () => {
  assert.match(source, /const streamingTailIndex = blockItems\.length > 0 \? blockItems\[blockItems\.length - 1\]\.originalIndex : -1;/);
  assert.match(source, /isStreamingTail=\{isStreaming && originalIndex === streamingTailIndex\}/);
  assert.match(source, /live=\{isStreamingTail\}/);
});

test("fork:prefix-once —— 过程组（prefix）只画一次（画两遍会点不开）", () => {
  // 两个 fork:turn-head-order 注释各留了一份 `{prefix}`，于是同一父节点里出现两个
  // 带**同一个 React key** 的过程组卡：重复 key 的协调会让其中一份在重绘时被
  // 拆掉重建，点「展开 / 收起」的状态写在被丢弃的 fiber 上 —— 表现是点卡片没反应，
  // 同时一屏出现两张一样的摘要卡、间距翻倍。
  const occurrences = source.match(/^\s*\{prefix\}\s*$/gm) ?? [];
  assert.equal(occurrences.length, 1, `prefix 应只渲染一次，实际 ${occurrences.length} 次`);
});
