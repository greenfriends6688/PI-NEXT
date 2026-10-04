import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { createJiti } from "jiti";
import ts from "typescript";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ChatInput, ModelErrorBanner, ModelScopeWarningBanner, canClearBuiltinCommandInput, canRestoreUserMessage, canRunBuiltinSlashCommandWhileStreaming, compressImageFile, cycleListIndex, filterModelOptions, getUpwardMenuMaxHeight, getUserMessageText, getUserMessageDraftImages, isExactSlashCommand, modelSupportsImageInput, replaceLinksWithMarkdown, shouldCompressImageFile } = await jiti.import("./ChatInput.tsx");
const { ModelSelector } = await jiti.import("./ModelSelector.tsx");
const { clearDraft, getDraft, mergeRestoredSubmissionDraft, mergeRestoredSubmissionText, rekeyDraft, setDraft } = await jiti.import("@/lib/draft-store.ts");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

test("preserves pasted HTML links as Markdown without changing plain text layout", () => {
  const link = (label, href, occurrence = 0) => ({ label, href, occurrence });

  assert.equal(
    replaceLinksWithMarkdown(
      "Jobs:\nEngineer\nEngineer\nDone",
      [link("Engineer", "https://example.com/1"), link("Engineer", "https://example.com/2", 1)],
    ),
    "Jobs:\n[Engineer](https://example.com/1)\n[Engineer](https://example.com/2)\nDone",
  );
  assert.equal(
    replaceLinksWithMarkdown("Read [this]", [link("[this]", "https://example.com/a_(b)")]),
    "Read [\\[this\\]](https://example.com/a_\\(b\\))",
  );
  assert.equal(
    replaceLinksWithMarkdown("Engineer and Engineer", [link("Engineer", "https://example.com/job", 1)]),
    "Engineer and [Engineer](https://example.com/job)",
  );
  assert.equal(replaceLinksWithMarkdown("plain text", [link("missing", "https://example.com")]), null);
});

test("follow-up shortcuts preserve newline, IME, mobile and completion behavior", () => {
  const source = ts.createSourceFile("ChatInput.tsx", readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function findHandler(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "handleKeyDown") {
      return node.initializer.arguments[0];
    }
    return ts.forEachChild(node, findHandler);
  }
  // Execute the component's actual callback without mounting the rest of the UI.
  const script = new Script(ts.transpileModule(findHandler(source).getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText);
  // fork:send-key（G6）—— `enterSendMode: "enter"` 是默认档；Ctrl+Enter 档在
  // ChatInput.enter-send-mode.test.mjs 里单独驱动。
  const cases = [
    // 2026-10-02 用户裁定 —— 流式中发送一律排队（followUp），不再有「引导」分支。
    ["Enter queues while streaming", {}, {}, "followup"],
    ["Alt+Enter also queues", { altKey: true }, {}, "followup"],
    ["idle Alt+Enter sends", { altKey: true }, { isStreaming: false }, "send"],
    ["Shift+Enter inserts a newline", { shiftKey: true }, {}, "native"],
    ["Alt+Shift+Enter keeps native behavior", { altKey: true, shiftKey: true }, {}, "native"],
    ["composition ref blocks sending", { altKey: true }, { isComposingRef: { current: true } }, "native"],
    ["native composition blocks sending", { altKey: true, nativeEvent: { isComposing: true } }, {}, "native"],
    ["IME keyCode blocks sending", { altKey: true, nativeEvent: { keyCode: 229 } }, {}, "native"],
    ["composition grace blocks sending", { altKey: true }, { lastCompositionEndAtRef: { current: 950 } }, "prevented"],
    ["mobile Alt+Enter keeps native behavior", { altKey: true }, { isMobile: true }, "native"],
    ["mobile composition grace cannot send", { altKey: true }, { isMobile: true, lastCompositionEndAtRef: { current: 950 } }, "native"],
    ["mobile Ctrl+Alt+Enter follows up", { altKey: true, ctrlKey: true }, { isMobile: true }, "followup"],
    ["mobile Cmd+Alt+Enter follows up", { altKey: true, metaKey: true }, { isMobile: true }, "followup"],
    ["mobile modified Enter respects composition grace", { altKey: true, ctrlKey: true }, { isMobile: true, lastCompositionEndAtRef: { current: 950 } }, "prevented"],
    ["Enter sends when there is no follow-up channel", {}, { onFollowUp: undefined }, "send"],
    ["Alt+Enter also sends when there is no follow-up channel", { altKey: true }, { onFollowUp: undefined }, "send"],
    ["slash completion takes priority", { altKey: true }, { slashMenuOpen: true, slashQuery: "help" }, "slash"],
    ["available built-in commands take priority", { altKey: true }, { slashMenuOpen: true, slashQuery: "copy", value: "/copy", displayedSlashCommands: [{ name: "copy", source: "builtin", availableWhileStreaming: true }] }, "send"],
    ["file completion takes priority", { altKey: true }, { atMenuOpen: true, atQuery: {} }, "file"],
    // fork:gap06-references — 引用菜单（& / # / ~）与 @ 菜单同级，且在它之前判定
    ["reference completion takes priority", { altKey: true }, { referenceMenuOpen: true, referenceQuery: {} }, "reference"],
    ["reference menu wins over the file menu when both are open", { altKey: true }, { referenceMenuOpen: true, referenceQuery: {}, atMenuOpen: true, atQuery: {} }, "reference"],
    ["history selection takes priority", { altKey: true }, { historyMenuOpen: true }, "history"],
  ];
  for (const [name, keys, state, expected] of cases) {
    let action = "native";
    const handler = script.runInNewContext({
      Date: { now: () => 1000 },
      COMPOSITION_END_ENTER_GRACE_MS: 100,
      isMobile: false, isStreaming: true, enterSendMode: "enter",
      isComposingRef: { current: false }, lastCompositionEndAtRef: { current: 0 },
      historyMenuOpen: false, inputHistory: ["previous"], historyActiveIndex: 0,
      slashMenuOpen: false, slashQuery: null, displayedSlashCommands: [{}], slashActiveIndex: 0,
      atMenuOpen: false, atQuery: null, atMatches: [{}], atActiveIndex: 0,
      // fork:gap06-references
      referenceMenuOpen: false, referenceQuery: null, referenceItems: [{}], referenceActiveIndex: 0,
      onSteer() {}, onFollowUp() {},
      sendQueued() { action = "followup"; }, handleSend() { action = "send"; },
      applySlashCommand() { action = "slash"; },
      isExactSlashCommand, value: "", setSlashMenuOpen() {},
      applyAtCompletion() { action = "file"; },
      applyReferenceCompletion() { action = "reference"; },
      applyHistoryInput() { action = "history"; },
      ...state,
    });
    handler({
      key: "Enter", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
      nativeEvent: { isComposing: false, keyCode: 13 },
      preventDefault() { action = "prevented"; },
      ...keys,
    });
    assert.equal(action, expected, name);
  }
});

test("file mention arrows wrap around the match list", () => {
  const source = ts.createSourceFile("ChatInput.tsx", readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function findHandler(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "handleKeyDown") {
      return node.initializer.arguments[0];
    }
    return ts.forEachChild(node, findHandler);
  }
  const script = new Script(ts.transpileModule(findHandler(source).getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText);

  function move(key, atActiveIndex, length) {
    let next = null;
    const handler = script.runInNewContext({
      Date: { now: () => 1000 },
      COMPOSITION_END_ENTER_GRACE_MS: 100,
      isMobile: false, isStreaming: false, enterSendMode: "enter",
      isComposingRef: { current: false }, lastCompositionEndAtRef: { current: 0 },
      historyMenuOpen: false, inputHistory: [], historyActiveIndex: 0,
      slashMenuOpen: false, slashQuery: null, displayedSlashCommands: [], slashActiveIndex: 0,
      atMenuOpen: true, atQuery: {}, atMatches: Array.from({ length }, () => ({})), atActiveIndex,
      // fork:gap06-references — 这个用例只驱动 @ 菜单，但 handleKeyDown 会先看引用菜单
      referenceMenuOpen: false, referenceQuery: null, referenceItems: [], referenceActiveIndex: 0,
      applyReferenceCompletion() {},
      onSteer() {}, onFollowUp() {},
      sendQueued() {}, handleSend() {},
      applySlashCommand() {},
      isExactSlashCommand() { return false; }, value: "@file",
      setSlashMenuOpen() {}, setAtMenuOpen() {},
      applyAtCompletion() {},
      applyHistoryInput() {},
      cycleListIndex,
      setAtActiveIndex(update) {
        next = typeof update === "function" ? update(atActiveIndex) : update;
      },
    });
    handler({
      key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
      nativeEvent: { isComposing: false, keyCode: 0 },
      preventDefault() {},
    });
    return next;
  }

  assert.equal(move("ArrowDown", 0, 3), 1);
  assert.equal(move("ArrowDown", 2, 3), 0);
  assert.equal(move("ArrowUp", 0, 3), 2);
  assert.equal(move("ArrowUp", 1, 3), 0);
  assert.equal(move("ArrowDown", 0, 1), 0);
  assert.equal(move("ArrowDown", 0, 0), 0);
});

// fork:gap06-references — `&` 会话 / `#` MCP / `~` 待办 共用一个列表导航
test("reference menu arrows wrap around its match list", () => {
  const source = ts.createSourceFile("ChatInput.tsx", readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function findHandler(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "handleKeyDown") {
      return node.initializer.arguments[0];
    }
    return ts.forEachChild(node, findHandler);
  }
  const script = new Script(ts.transpileModule(findHandler(source).getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText);

  function move(key, referenceActiveIndex, length) {
    let next = null;
    const handler = script.runInNewContext({
      Date: { now: () => 1000 },
      COMPOSITION_END_ENTER_GRACE_MS: 100,
      isMobile: false, isStreaming: false, enterSendMode: "enter",
      isComposingRef: { current: false }, lastCompositionEndAtRef: { current: 0 },
      historyMenuOpen: false, inputHistory: [], historyActiveIndex: 0,
      slashMenuOpen: false, slashQuery: null, displayedSlashCommands: [], slashActiveIndex: 0,
      atMenuOpen: false, atQuery: null, atMatches: [], atActiveIndex: 0,
      applyAtCompletion() {},
      referenceMenuOpen: true, referenceQuery: {}, referenceItems: Array.from({ length }, () => ({})), referenceActiveIndex,
      onSteer() {}, onFollowUp() {},
      sendQueued() {}, handleSend() {},
      applySlashCommand() {},
      isExactSlashCommand() { return false; }, value: "&se",
      setSlashMenuOpen() {}, setAtMenuOpen() {},
      applyHistoryInput() {},
      applyReferenceCompletion() {},
      cycleListIndex,
      setReferenceActiveIndex(update) {
        next = typeof update === "function" ? update(referenceActiveIndex) : update;
      },
    });
    handler({
      key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
      nativeEvent: { isComposing: false, keyCode: 0 },
      preventDefault() {},
    });
    return next;
  }

  assert.equal(move("ArrowDown", 0, 3), 1);
  assert.equal(move("ArrowDown", 2, 3), 0);
  assert.equal(move("ArrowUp", 0, 3), 2);
  assert.equal(move("ArrowUp", 1, 3), 0);
  assert.equal(move("ArrowDown", 0, 0), 0);
});

test("cycleListIndex wraps in both directions", () => {
  assert.equal(cycleListIndex(0, 3, 1), 1);
  assert.equal(cycleListIndex(2, 3, 1), 0);
  assert.equal(cycleListIndex(0, 3, -1), 2);
  assert.equal(cycleListIndex(1, 3, -1), 0);
  assert.equal(cycleListIndex(0, 1, 1), 0);
  assert.equal(cycleListIndex(4, 0, 1), 0);
  assert.equal(cycleListIndex(-1, 4, 1), 0);
});

test("流式中不再渲染「引导 / 后续消息」按钮（2026-10-02 用户裁定）", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(ChatInput, {
      onSend() {}, onAbort() {}, onFollowUp() {}, isStreaming: true,
    })),
  );

  // 画板 20 帧 B（流式中）的右端只有「2 条排队」徽标 + 上下文环 + 停止键，
  // 从来没有这两个按钮。现在流式中发送一律自动排队，不再让用户二选一。
  assert.doesNotMatch(html, />Steer</);
  assert.doesNotMatch(html, />Follow-up</);
  assert.doesNotMatch(html, /aria-keyshortcuts="Alt\+Enter"/);
  assert.doesNotMatch(html, /Interrupt the current run/);
});

test("流式中这一格随草稿在 ⏸ 与 ↑ 之间切换（fork:send-stop-one-slot）", () => {
  const shell = (props) => renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(ChatInput, {
      onSend() {}, onAbort() {}, onFollowUp() {}, isStreaming: true, ...props,
    })),
  );

  // 判据抄 ZCode（ConversationComposer.tsx:1135）：
  //   const showStopControl = canStop && !hasDraftToSubmit;
  // 「同一格」是硬要求：⏸ 与 ↑ 永不同时出现（用户 2026-10-05 裁定，
  // 否决了 fork:zc-queue-2026-10-04 那个并排两枚的实验）。
  const empty = shell({});
  assert.match(empty, /class="d-send stop"/);
  assert.doesNotMatch(empty, /class="d-send"/);

  // 有草稿 → ⏸ 让位给 ↑，点了就是排队（不是静默无反应）。
  // 草稿从 `lib/draft-store` 按 draftKey 读（不是 initialDraft prop），所以要先写再渲染。
  const draftKey = "session-send-stop-one-slot";
  clearDraft(draftKey);
  setDraft(draftKey, { value: "接着说", images: [] });
  const draft = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(ChatInput, {
      onSend() {}, onAbort() {}, onFollowUp() {}, isStreaming: true, draftKey,
    })),
  );
  clearDraft(draftKey);
  assert.match(draft, /class="d-send"/);
  assert.doesNotMatch(draft, /class="d-send stop"/);

  const source = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(source, /isStreaming && !hasDraftToSubmit \? stopButton : sendButton/);
  // 「有草稿」不能只看文本：只挂了引用、没打字的草稿同样能发，
  // 只排文本会把那枚本该能点的 ↑ 错判掉。
  assert.match(source, /selectionContexts\.length/);
  assert.match(source, /sessionReferences\.length/);
  assert.match(source, /onClick=\{isStreaming && onFollowUp \? sendQueued : handleSend\}/);
  // 三个渲染位（compact / 窄屏 / 桌面）都走同一个量，不留旧的二选一写法。
  // 先剥掉注释：ChatInput.tsx 的说明里**故意**引用了那个旧表达式作为对照，
  // 直接全文匹配会被自己的文档判成「旧写法还在」。
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /isStreaming \? stopButton : sendButton/);
  // 一处定义 + 三处渲染位（compact / 窄屏 / 桌面）= 4，且三个渲染位都只经由它。
  assert.equal(code.match(/\bcomposerSendCluster\b/g)?.length, 4);
});

test("renders the upstream model error", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ModelErrorBanner, {
        error: "Invalid models.json schema:\nproviders.custom.models.0.id must not be empty",
      }),
    ),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Model error/);
  assert.match(html, /providers\.custom\.models\.0\.id must not be empty/);
});

test("does not render an empty model error", () => {
  assert.equal(
    renderToStaticMarkup(
      React.createElement(I18nProvider, null, React.createElement(ModelErrorBanner, { error: null })),
    ),
    "",
  );
});

test("renders enabledModels scope warnings", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ModelScopeWarningBanner, {
        warnings: ['No models match pattern "ghost-gateway/*"'],
      }),
    ),
  );

  assert.match(html, /Model scope warning/);
  assert.match(html, /ghost-gateway/);
  assert.equal(
    renderToStaticMarkup(
      React.createElement(I18nProvider, null, React.createElement(ModelScopeWarningBanner, { warnings: [] })),
    ),
    "",
  );
});

test("keeps the model selector visible when a model error leaves no options", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        modelError: "Invalid models.json schema",
        modelList: [],
        modelNames: {},
      }),
    ),
  );

  assert.match(html, />No models</);
  assert.match(html, /title="No available models"/);
});

test("renders the read-only tool preset as the active selection", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onToolPresetChange() {},
        isStreaming: false,
        toolPreset: "read-only",
      }),
    ),
  );

  // fork:design-components —— 控件上印的是画板的短标签（Read only），
  // 不再是内部枚举名 read-only。
  assert.match(html, /title="Change tool preset: Read only"/);
  assert.match(html, />Read only<\/span>/);
});

test("renders the empty tool preset as Chat only", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onToolPresetChange() {},
        isStreaming: false,
        toolPreset: "none",
      }),
    ),
  );

  assert.match(html, /title="Change tool preset: Chat only"/);
  assert.match(html, />Chat only<\/span>/);
});

test("renders the compact composer with the standard Send button and no session controls", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        isStreaming: false,
        compact: true,
      }),
    ),
  );

  assert.match(html, /<textarea/);
  assert.match(html, /aria-label="Send"/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /type="file"|Attach image|Change tool preset/);
});

test("renders a quoted context strip without putting the quote into the textarea", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        isStreaming: false,
        initialSelectionContexts: [{ id: "selection-1", text: "A selected assistant passage", label: "Selected text" }],
      }),
    ),
  );

  assert.match(html, /Quoted context/);
  assert.match(html, /A selected assistant passage/);
  assert.doesNotMatch(html, /Edit quoted context/);
  assert.match(html, /Remove quoted context/);
  assert.match(html, /<textarea[^>]*><\/textarea>/);
});

test("shows and locks the optimistic model while a switch is pending", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
        modelList: [{ provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
        modelSwitching: true,
      }),
    ),
  );

  assert.match(html, /title="Switching model"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, />DeepSeek V4 Flash</);
  // fork:motion-spin-2026-10-01 —— spinner 周期从写死的 0.8s 改成 var(--motion-spin)
  // （画板 tokens.css 的 900ms）。全系统曾有三套周期（0.8 / 0.9 / Tailwind 的 1s）。
  assert.match(html, /animation:spin var\(--motion-spin\) linear infinite/);
  assert.doesNotMatch(html, /animation:spin \d/, "spinner 周期必须走 token，不许写死");
});

test("filters model options by name and id", () => {
  const options = [
    { provider: "ollama", modelId: "qwen3:latest", name: "Qwen 3" },
    { provider: "anthropic", modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { provider: "openai", modelId: "gpt-5.4", name: "GPT-5.4" },
  ];

  assert.deepEqual(filterModelOptions(options, "QWEN"), [options[0]]);
  assert.deepEqual(filterModelOptions(options, "claude-sonnet"), [options[1]]);
  assert.equal(filterModelOptions(options, "OpenAI").length, 0);
  assert.equal(filterModelOptions(options, "anthropic/claude").length, 0);
  assert.equal(filterModelOptions(options, "missing").length, 0);
  assert.equal(filterModelOptions(options, "  "), options);
});

test("renders the shared field model selector as a disabled gray control", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ModelSelector, {
        options: [{ provider: "openai", modelId: "gpt-5.6-sol", name: "GPT-5.6 Sol" }],
        value: null,
        onChange() {},
        onClear() {},
        emptyLabel: "Parent default",
        ariaLabel: "Model override",
        disabled: true,
        variant: "field",
      }),
    ),
  );

  assert.match(html, /aria-label="Model override"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /background:var\(--bg-panel\)/);
  assert.match(html, />Parent default</);
});

test("caps an upward menu to the visible space above its anchor", () => {
  assert.equal(getUpwardMenuMaxHeight(343, 36), 299);
  assert.equal(getUpwardMenuMaxHeight(40, 36), 0);
  // Composer sitting under a 36px top bar with only ~160px of air: a 400px
  // file list would paint through the bar and hide the leading matches.
  assert.equal(getUpwardMenuMaxHeight(200, 36), 156);
  assert.ok(getUpwardMenuMaxHeight(200, 36) < 400);
});

test("file mention menu applies the measured upward height cap", () => {
  const source = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const start = source.indexOf("{atMenuOpen && atQuery !== null && (() => {");
  assert.notEqual(start, -1);
  const block = source.slice(start, start + 4000);
  assert.match(block, /ref=\{atMenuRef\}/);
  assert.match(block, /min\(48vh, 400px, \$\{atMenuMaxHeight\}px\)/);
  assert.match(block, /flexDirection: "column"/);
  assert.match(block, /minHeight: 0/);
  assert.equal(block.includes("maxHeight: \"min(48vh, 400px)\""), false);
});

test("file mention menu remeasures when its layout container shifts the anchor", () => {
  const source = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const start = source.indexOf("function subscribeUpwardMenuMaxHeight");
  assert.notEqual(start, -1);
  const block = source.slice(start, start + 1800);
  assert.match(block, /const layoutContainer = parent\?\.parentElement;/);
  assert.match(block, /anchorObserver\?\.observe\(layoutContainer\)/);
});

test("compresses large images while preserving small images and GIFs", async () => {
  assert.equal(shouldCompressImageFile({ size: 1024 * 1024, type: "image/png" }), false);
  assert.equal(shouldCompressImageFile({ size: 1024 * 1024 + 1, type: "image/png" }), true);
  assert.equal(shouldCompressImageFile({ size: 2 * 1024 * 1024, type: "image/gif" }), false);

  const originals = {
    FileReader: globalThis.FileReader,
    createImageBitmap: globalThis.createImageBitmap,
    document: globalThis.document,
  };
  let bitmapCalls = 0;
  let closed = false;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: "", fillRect() {}, drawImage() {} }),
    toDataURL: () => "data:image/jpeg;base64,COMPRESSED",
  };

  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = "data:image/png;base64,ORIGINAL";
      this.onload();
    }
  };
  globalThis.createImageBitmap = async () => {
    bitmapCalls += 1;
    return { width: 2048, height: 1024, close() { closed = true; } };
  };
  globalThis.document = { createElement: () => canvas };

  try {
    assert.deepEqual(await compressImageFile({ size: 1024, type: "image/png" }), {
      data: "ORIGINAL",
      mimeType: "image/png",
    });
    assert.deepEqual(await compressImageFile({ size: 2 * 1024 * 1024, type: "image/png" }), {
      data: "COMPRESSED",
      mimeType: "image/jpeg",
    });
    assert.equal(bitmapCalls, 1);
    assert.equal(canvas.width, 1024);
    assert.equal(canvas.height, 512);
    assert.equal(closed, true);
  } finally {
    globalThis.FileReader = originals.FileReader;
    globalThis.createImageBitmap = originals.createImageBitmap;
    globalThis.document = originals.document;
  }
});

test("recognizes exact slash commands for one-Enter submission", () => {
  const builtin = { name: "copy", description: "", source: "builtin" };
  assert.equal(isExactSlashCommand("/copy", builtin), true);
  assert.equal(isExactSlashCommand("  /copy  ", builtin), true);
  assert.equal(isExactSlashCommand("/co", builtin), false);
  assert.equal(isExactSlashCommand("/copy extra", builtin), false);
  assert.equal(isExactSlashCommand("/copy", { ...builtin, source: "extension" }), false);
});

test("clears a completed built-in only while its submitted input is unchanged", () => {
  assert.equal(canClearBuiltinCommandInput("/copy", 0, "/copy"), true);
  assert.equal(canClearBuiltinCommandInput("new follow-up", 0, "/copy"), false);
  assert.equal(canClearBuiltinCommandInput("/copy", 1, "/copy"), false);
});

test("locks built-in command submission until it settles", async () => {
  const sourceText = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("ChatInput.tsx", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function findCallback(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "runBuiltinCommand") {
      return node.initializer.arguments[0];
    }
    return ts.forEachChild(node, findCallback);
  }
  const callback = new Script(ts.transpileModule(findCallback(source).getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText).runInNewContext({
    attachedImages: [],
    attachedImagesRef: { current: [] },
    builtinCommandPendingRef: { current: false },
    canClearBuiltinCommandInput,
    clearInput() {},
    onBuiltinCommand: async () => new Promise((resolve) => { callback.resolve = resolve; }),
    setBuiltinCommandPending(value) { callback.pendingStates.push(value); },
    valueRef: { current: "/reload" },
  });
  callback.pendingStates = [];

  const first = callback("/reload");
  assert.deepEqual(callback.pendingStates, [true]);
  assert.equal(await callback("/reload"), true);
  assert.deepEqual(callback.pendingStates, [true]);
  callback.resolve({ handled: true });
  assert.equal(await first, true);
  assert.deepEqual(callback.pendingStates, [true, false]);
  assert.match(sourceText, /<fieldset\s+disabled=\{builtinCommandPending\}\s+aria-busy=\{builtinCommandPending\}/);
});

test("keeps only read-only built-ins available while a run is active", () => {
  assert.equal(canRunBuiltinSlashCommandWhileStreaming("/copy"), true);
  assert.equal(canRunBuiltinSlashCommandWhileStreaming("/session"), true);
  assert.equal(canRunBuiltinSlashCommandWhileStreaming("/compact"), false);
  assert.equal(canRunBuiltinSlashCommandWhileStreaming("/reload"), false);
});

test("restores text and base64 images when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "text", text: "Review this image @src/example.ts " },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ],
  };

  assert.equal(getUserMessageText(message), "Review this image @src/example.ts ");
  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/png" },
  ]);
});

test("restores legacy flat image entries when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", data: "AQID", mimeType: "image/jpeg" },
    ],
  };

  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/jpeg" },
  ]);
});

test("does not restore a historical message over a pending image attachment", () => {
  assert.equal(canRestoreUserMessage("", 0, 0), true);
  assert.equal(canRestoreUserMessage("", 1, 0), false);
  assert.equal(canRestoreUserMessage("", 0, 1), false);
  assert.equal(canRestoreUserMessage("draft", 0, 0), false);
});

test("restores a cleared submission using the queued React state", () => {
  let value = "failed submission";
  const updates = [
    () => "",
    (current) => mergeRestoredSubmissionText("failed submission", current),
  ];

  for (const update of updates) value = update(value);

  assert.equal(value, "failed submission");
  assert.equal(
    mergeRestoredSubmissionText("failed submission", "new draft"),
    "failed submission\n\nnew draft",
  );
  assert.equal(
    mergeRestoredSubmissionText("failed submission", "failed submission"),
    "failed submission\n\nfailed submission",
  );
});

test("keeps a failed first submission recoverable across a composer remount", () => {
  const image = { data: "AQID", mimeType: "image/png" };
  const restored = mergeRestoredSubmissionDraft(
    "failed submission",
    [image],
    "",
    [],
  );

  assert.deepEqual(restored, {
    value: "failed submission",
    images: [image],
  });
  assert.deepEqual(
    mergeRestoredSubmissionDraft("failed submission", [image], "new draft", []),
    {
      value: "failed submission\n\nnew draft",
      images: [image],
    },
  );
});

test("preserves duplicate image attachments when restoring a submission", () => {
  const image = { data: "AQID", mimeType: "image/png" };
  const restored = mergeRestoredSubmissionDraft("", [image, image], "", [image]);

  assert.deepEqual(restored.images, [image, image, image]);
});

test("moves a provisional new-session draft to the real session key", () => {
  const provisionalKey = "new:/tmp/rekey-test";
  const sessionKey = "session-rekey-test";
  clearDraft(provisionalKey);
  clearDraft(sessionKey);
  setDraft(provisionalKey, { value: "queued while preflight ran", images: [] });

  assert.deepEqual(rekeyDraft(provisionalKey, sessionKey), {
    value: "queued while preflight ran",
    images: [],
  });
  assert.equal(getDraft(provisionalKey), null);
  assert.deepEqual(getDraft(sessionKey), {
    value: "queued while preflight ran",
    images: [],
  });

  clearDraft(sessionKey);
});

test("rekey keeps a synchronously restored draft when React state is still empty", () => {
  const provisionalKey = "new:/tmp/rekey-race";
  const sessionKey = "session-rekey-race";
  clearDraft(provisionalKey);
  clearDraft(sessionKey);
  setDraft(provisionalKey, { value: "restored before state flush", images: [] });

  assert.deepEqual(
    rekeyDraft(provisionalKey, sessionKey, { value: "", images: [] }),
    { value: "restored before state flush", images: [] },
  );
  assert.equal(getDraft(provisionalKey), null);
  assert.deepEqual(getDraft(sessionKey), {
    value: "restored before state flush",
    images: [],
  });

  clearDraft(sessionKey);
});

test("renders compact errors above the input as a wrapping alert", () => {
  const error = "Compaction failed: OpenAI API error (403): <html>request forbidden</html>";
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onCompact() {},
        isStreaming: false,
        compactError: error,
      }),
    ),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Compaction failed: OpenAI API error/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
  assert.match(html, /white-space:pre-wrap/);
  assert.ok(html.indexOf('role="alert"') < html.indexOf("<textarea"));
});

test("modelSupportsImageInput warns only when modality info is known and lacks image", () => {
  const modelList = [
    { id: "text-only", name: "Text Only", provider: "ollama", input: ["text"] },
    { id: "vision", name: "Vision", provider: "anthropic", input: ["text", "image"] },
    { id: "unknown", name: "Unknown", provider: "custom", input: undefined },
  ];

  assert.equal(modelSupportsImageInput({ provider: "ollama", modelId: "text-only" }, modelList), false);
  assert.equal(modelSupportsImageInput({ provider: "anthropic", modelId: "vision" }, modelList), true);
  // Unknown modality info never blocks the user.
  assert.equal(modelSupportsImageInput({ provider: "custom", modelId: "unknown" }, modelList), true);
  // Model missing from the list is treated as unknown.
  assert.equal(modelSupportsImageInput({ provider: "x", modelId: "missing" }, modelList), true);
  assert.equal(modelSupportsImageInput(null, modelList), true);
  assert.equal(modelSupportsImageInput({ provider: "ollama", modelId: "text-only" }, undefined), true);
});

test("renders image warnings for known text-only defaults without an explicit model selection", () => {
  const draftKey = "new:/tmp/image-warning-default";
  const modelList = [
    { id: "text-only", name: "Text Only", provider: "custom", input: ["text"] },
    { id: "vision", name: "Vision", provider: "custom", input: ["text", "image"] },
    { id: "unknown", name: "Unknown", provider: "custom" },
  ];
  setDraft(draftKey, {
    value: "Describe this image",
    images: [{ data: "aW1hZ2U=", mimeType: "image/png" }],
  });

  try {
    for (const [modelId, warningExpected] of [["text-only", true], ["vision", false], ["unknown", false], [null, false]]) {
      const html = renderToStaticMarkup(
        React.createElement(
          I18nProvider,
          null,
          React.createElement(ChatInput, {
            onSend() {},
            onAbort() {},
            isStreaming: false,
            isAutoModelSelection: true,
            model: modelId ? { provider: "custom", modelId } : null,
            modelList,
            draftKey,
          }),
        ),
      );

      assert.match(html, /<img/);
      assert.equal(html.includes("Images may not be sent"), warningExpected, `default model: ${modelId}`);
      if (warningExpected) {
        assert.match(html, /The selected model \(Text Only\) does not support image input/);
        assert.ok(html.indexOf('role="alert"') < html.indexOf("<textarea"));
      }
    }
  } finally {
    clearDraft(draftKey);
  }
});

// fork:context-pop-portal —— 上下文明细浮窗必须脱离输入框那棵子树。
//
// `.chat-input-shell.pw-composer` 有 `overflow-x: clip`（工具条芯片不许横着溢出卡片，
// 那条规则要留着）。浮窗宽 680px、又右对齐在这条工具条里，留在子树里就会被祖先
// 裁掉一长条；portal 到 body 之后它没有任何裁切祖先。
test("the context detail popover is portaled out of the clipped composer subtree", () => {
  const source = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const forkCss = readFileSync(new URL("../app/fork-ui.css", import.meta.url), "utf8");

  assert.match(source, /<PortalDropdown[\s\S]*?className="d-pop is-open composer-ring-pop"/);
  // 环本身只留圆环按钮，明细不再作为它的子节点。
  assert.doesNotMatch(source, /className="d-pop is-open composer-ring-pop"[^>]*style=/);
  // 可见性由状态驱动（portal 之后 CSS 的 :hover 够不着 panel）。
  assert.match(source, /onMouseEnter=\{\(\) => setRingHovered\(true\)\}/);
  assert.match(source, /onMouseLeave=\{\(\) => setRingHovered\(false\)\}/);
  assert.match(source, /const contextRingOpen = ringHovered \|\| ringPinned;/);
  // 点「外部」关掉钉住的浮窗时，浮窗已在 body 上，必须连它一起算。
  assert.match(source, /!ringPopRef\.current\?\.contains\(target\)/);

  // 工具条那条 clip 规则仍在（它管的是芯片，不是浮窗）。
  assert.match(
    forkCss,
    /\.chat-input-shell\.pw-composer \{\s*overflow-x: clip;\s*overflow-y: visible;/,
  );
  // :hover / .is-pinned 不能再控制 panel 的显隐——它已经不在那棵子树里。
  assert.doesNotMatch(forkCss, /\.composer-ring:hover \.composer-ring-pop/);
  assert.doesNotMatch(forkCss, /\.composer-ring\.is-pinned \.composer-ring-pop/);
  // panel 只剩自身规格（画布 / 描边 / 层级），位置由 PortalDropdown 那段 JS 算。
  assert.doesNotMatch(forkCss, /\.composer-ring-pop \{[^}]*position: absolute/);
});

// fork:transcript-proc-head —— 「展开/收起」必须贴到过程卡片的右缘。
//
// button 的 `width: auto` 是 shrink-to-fit，`display: flex` 也不会撑满；那一个
// `<span class="grow">` 因此没有空间可分配，「已完成」徽章和「展开」会紧跟在
// 摘要文字后面（实测卡片 718px 宽、按钮只有 355px）。0-2-0 的 reset 层给一条
// `width: 100%` 就够了。
test("the process head button fills its card so the expand toggle sits at the right edge", () => {
  const forkCss = readFileSync(new URL("../app/fork-ui.css", import.meta.url), "utf8");

  const reset = forkCss.slice(
    forkCss.indexOf("@layer fork-reset {"),
    forkCss.indexOf("}", forkCss.indexOf("button.pw-side-foot { display: flex")),
  );
  assert.match(reset, /button\.pw-proc-head,[\s\S]*?\{[^}]*width: 100%;/);

  // 宽度给足之后，`.grow` 才有空间把徽章和开关推到右端。
  const board = readFileSync(
    new URL("../design/pi-web-design/assets/board.css", import.meta.url),
    "utf8",
  );
  assert.match(board, /\.pw-proc-head \.grow \{ flex: 1; \}/);
});

// fork:design-components —— composer 剩下的自绘盒全部换成画板基件：
// 通知条 = .pw-alert（画板 50 四态）、附件芯片 = .pw-chips / .pw-chip（画板 20）、
// 输入历史与 / 命令浮窗 = .pw-pop + .pw-pop-title / .pw-pop-search + .pw-prow（画板 21），
// 图标一律 <i data-ico>（画板图标集），文件里不再留手绘内联 <svg>。
test("the composer's notices, chips and popover headers ride on the board components", () => {
  const source = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");

  // 通知条：error 基态 + warn / ok / info 三个变体（画板 50 的 .d-banner 四态）。
  assert.match(source, /className=\{`d-banner\$\{tone === "error" \? " err" : " warn"\}`\}/);
  assert.match(source, /className="d-banner warn"/);
  assert.match(source, /className="d-banner ok"/);
  assert.match(source, /className="d-banner info"/);
  assert.match(source, /className="d-banner err"\n\s+style=\{\{\n\s+marginBottom: "var\(--nx-sp-2\)",\n\s+\/\/ 错误正文原样换行不断词/);

  // 附件芯片：容器 .d-chips，非图片附件是 .d-chipbtn，芯片末尾的移除钮是 data-ico="x"。
  assert.equal((source.match(/<div className="d-chips">/g) ?? []).length, 2);
  assert.match(source, /<span key=\{chip\.path\} className="d-chipbtn"/);
  assert.match(source, /<i data-ico=\{attachmentChipIcon\(chip\.kind\)\} data-size="12"><\/i>/);
  assert.match(source, /className="d-iconbtn"\n\s+onClick=\{\(\) => removeReferenceAttachment\(chip\.path\)\}/);

  // 队列：画板 20 的 .d-queue / .d-queue-head / .d-queue-body，行是 .d-queue-row。
  // （原先还有「引导 / 后续消息」两枚按钮，2026-10-02 用户裁定删除 —— 流式中发送一律排队。）
  assert.match(source, /<div className="d-queue">/);
  assert.match(source, /<div className="d-queue-head">/);
  assert.match(source, /<div className="d-queue-body">/);
  assert.match(source, /className=\{`d-queue-row\$\{kind === "steer" \? " steer" : ""\}`\}/);
  assert.doesNotMatch(source, /sendQueued\("steer"\)/);
  assert.doesNotMatch(source, /sendQueued\("followup"\)/);

  // 输入历史浮窗：头是 .d-pop-title，行是 .d-menu-row（当前项 is-on）。
  assert.match(source, /<div className="d-pop-title" style=\{\{ display: "flex", alignItems: "center", gap: "var\(--s2\)", flexShrink: 0 \}\}>\s*<i data-ico="history"/);
  assert.match(source, /className=\{`d-menu-row\$\{active \? " is-on" : ""\}`\}/);

  // / 命令菜单补画板 21 的搜索头（slash 图标 + 查询），分组小标题仍是 .d-pop-title。
  assert.match(source, /className="d-searchfield"/);
  assert.match(source, /<i data-ico="slash" data-size="14"><\/i>/);
  // 七个弹层头都挂画板 21 的 .d-pop-title：输入历史 / 收藏 / @ 文件 / / 命令分组 /
  // 思考档 / 工具档 / 权限档。
  assert.equal((source.match(/className="d-pop-title"/g) ?? []).length, 7);
  assert.match(source, /<div className="d-pop-title">\{t\("chat\.permissionTitle"\)\}<\/div>/);
  assert.match(source, /className="d-pop-title"\n\s+style=\{\{\n\s+position: "sticky",/);

  // 图标仍零手绘：保留的 <svg> 只有两条输入卡运行光带（都需要 pathLength 的环绕闭环）——
  // 宽屏是画板 D-27 帧 B 的 .d-loader-svg，窄屏是 PWA 库的 .m-loader-svg
  // （fork:v5-landing-close 补齐窄屏那一半），除此之外一条都不许有。
  assert.equal((source.match(/<svg/g) ?? []).length, 2);
  assert.match(source, /className="d-loader-svg"/);
  assert.match(source, /className="m-loader-svg"/);
  assert.match(source, /className="m-loader-glow"/);
  // 光带只在运行中挂：两个形态都是 isStreaming 时才渲染，不改行为。
  assert.equal((source.match(/isStreaming \? " m-loader"/g) ?? []).length, 1);
});

test("the model notices render as board alerts with a leading icon", () => {
  const error = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(ModelErrorBanner, { error: "boom" })),
  );
  assert.match(error, /class="d-banner err"/);
  assert.match(error, /data-ico="circle-alert"/);
  assert.match(error, /role="alert"/);
  assert.doesNotMatch(error, /class="d-banner warn"/);

  const warning = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ModelScopeWarningBanner, { warnings: ['No models match pattern "ghost/*"'] }),
    ),
  );
  assert.match(warning, /class="d-banner warn"/);
  assert.match(warning, /data-ico="triangle-alert"/);
  assert.match(warning, /role="alert"/);
});

test("a finished compaction reports through the ok alert", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onCompact() {},
        isStreaming: false,
        compactResult: { reason: "manual", tokensBefore: 12000, estimatedTokensAfter: 4000 },
      }),
    ),
  );

  assert.match(html, /class="d-banner ok"/);
  assert.match(html, /data-ico="circle-check"/);
  assert.ok(html.indexOf('class="d-banner ok"') < html.indexOf("<textarea"));
});

test("queued rows offer 移至输入框 (move back to the input box)", () => {
  // fork:queue-edit —— 每一条排队消息两个动作：立即发送 / 移至输入框（可再编辑），
  // 外加删除。按钮由 onEdit 决定是否渲染，避免没有回填入口时画一枚死按钮。
  const queueSource = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(queueSource, /editTitle=\{t\("chat\.queueEditToInput"\)\}/);
  assert.match(queueSource, /onEdit=\{onQueueEdit \? \(\) => onQueueEdit\("steer", i, text\) : undefined\}/);
  assert.match(queueSource, /onEdit=\{onQueueEdit \? \(\) => onQueueEdit\("followUp", i, text\) : undefined\}/);
});

/* fork:v5-wave-n1 —— D-27 帧 A / D-27 帧 F / D-28 帧 C 的两条「值被替换」反馈。
 *
 * ① 翻卡（.d-flap + .is-fall / .is-rise）：推理档位芯片的图标位。两段都带 forwards，
 *    所以**必须清场** —— 断言里盯着 380ms 那一段把状态收回 ""。
 * ② 标签上下交换（.d-label-out / .d-label-in）：权限档的状态词。两个标签必须叠在
 *    同一格里（板内原话「否则会看见框在长高」），所以旧值绝对定位、流内那枚是新值。
 *
 * 两条都必须**只在宽屏那一支**出现：窄屏（PWA 形态）走 `.m-sheet-row` 的能力面板，
 * 库里没有 m-flap / m-label-* 对应件，不许把 d-* 泄进 PWA 分支。 */
test("推理档位用画板 D-28 帧 C 的翻卡，权限状态词用同帧的标签上下交换", () => {
  const source = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");

  // 翻卡：外壳只包那枚图标，两段接力 150ms → 380ms 清场，减弱动效不起接力。
  assert.match(source, /className=\{`d-flap\$\{flapPhase \? ` \$\{flapPhase\}` : ""\}`\}/);
  assert.match(source, /<span className=\{`d-flap\$\{flapPhase \? ` \$\{flapPhase\}` : ""\}`\}>\s*<i data-ico="brain" data-size="13"><\/i>\s*<\/span>/);
  assert.match(source, /setFlapPhase\("is-fall"\)/);
  assert.match(source, /window\.setTimeout\(\(\) => setFlapPhase\("is-rise"\), 150\)/);
  assert.match(source, /window\.setTimeout\(\(\) => setFlapPhase\(""\), 380\)/);
  assert.match(source, /prefers-reduced-motion: reduce/);

  // 标签交换：旧值 absolute 盖在流内的新值上，220ms 后收场。
  assert.match(source, /className="d-label-out"/);
  assert.match(source, /className=\{permissionLabelOut !== null \? "d-label-in" : undefined\}/);
  assert.match(source, /position: "absolute"/);
  assert.match(source, /setPermissionLabelOut\(previous\)/);
  assert.match(source, /window\.setTimeout\(\(\) => setPermissionLabelOut\(null\), 220\)/);
  // 两种反馈不许同时用在同一处：翻卡在思考芯片，标签交换在权限芯片。
  assert.ok(source.indexOf("d-flap") < source.indexOf("d-label-out"));
});

test("翻卡与标签交换不泄进窄屏分支（窄屏走 m-* 基件）", () => {
  const source = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  // 两处渲染都在 `!narrowControls` 的文字分支之外 / 之内：翻卡包的是图标（宽屏表单才有），
  // 标签交换整段挂 `!narrowControls`。这里只钉住「库里没有的 m-flap / m-label-* 没被自造」。
  assert.doesNotMatch(source, /\bm-flap\b/);
  assert.doesNotMatch(source, /\bm-label-(out|in)\b/);
});
