import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import { createJiti } from "jiti";
import ts from "typescript";

// fork:send-key（G6 · 上游 `5df8278` #1001）—— 发送键可配（Enter 直发 / Ctrl+Enter 才发）。
// 断言分两层：偏好 hook 的读写与回落，以及 handleKeyDown 在两种模式下的按键分流。

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  ENTER_SEND_MODE_DEFAULT,
  ENTER_SEND_MODE_STORAGE_KEY,
  parseEnterSendMode,
  setEnterSendMode,
} = await jiti.import("@/hooks/useEnterSendMode.ts");

const chatInputSource = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const settingSource = await readFile(new URL("./EnterSendModeSetting.tsx", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../hooks/useEnterSendMode.ts", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

test("the stored preference defaults to Enter and never guesses at a bad value", () => {
  assert.equal(ENTER_SEND_MODE_DEFAULT, "enter");
  assert.equal(parseEnterSendMode("ctrlEnter"), "ctrlEnter");
  assert.equal(parseEnterSendMode("enter"), "enter");
  assert.equal(parseEnterSendMode("Ctrl-Enter"), "enter");
  assert.equal(parseEnterSendMode(null), "enter");
  assert.equal(ENTER_SEND_MODE_STORAGE_KEY, "pi-enter-send-mode");
  // 形态与 useChatAppearance 同款：模块级快照 + 订阅者 + useSyncExternalStore。
  assert.match(hookSource, /useSyncExternalStore/);
  assert.match(hookSource, /window\.localStorage\.setItem\(ENTER_SEND_MODE_STORAGE_KEY, next\)/);
});

test("setEnterSendMode notifies subscribers and survives storage being unavailable", () => {
  const original = globalThis.window;
  const store = new Map();
  globalThis.window = {
    get localStorage() {
      return {
        getItem: (key) => store.get(key) ?? null,
        setItem(key, value) {
          if (key === "pi-enter-send-mode" && value === "boom") throw new Error("no storage");
          store.set(key, value);
        },
      };
    },
  };
  try {
    setEnterSendMode("ctrlEnter");
    assert.equal(store.get(ENTER_SEND_MODE_STORAGE_KEY), "ctrlEnter");
    // 存储不可用时不抛：偏好仍然生效到本次会话。
    assert.doesNotThrow(() => setEnterSendMode("enter"));
    assert.equal(store.get(ENTER_SEND_MODE_STORAGE_KEY), "enter");
  } finally {
    globalThis.window = original;
  }
});

test("settings exposes the send key as one board radio row in the chat block", () => {
  const chatStart = panelSource.indexOf('<PwBlock icon="message-square"');
  const chatSection = panelSource.slice(chatStart, panelSource.indexOf("</PwBlock>", chatStart));
  assert.match(chatSection, /<EnterSendModeSetting \/>/);
  // 行规格与主题 / 语言 / 密度同一套：`.pw-field` + `.pw-radio`，不自绘分段控件。
  assert.match(settingSource, /<PwField[\s\S]*?<PwRadio<EnterSendMode>/);
  assert.match(settingSource, /value: "ctrlEnter"/);
  assert.match(settingSource, /onChange=\{setEnterSendMode\}/);
  for (const key of ["sendKey", "sendKeyHint", "sendKeyEnter", "sendKeyCtrlEnter"]) {
    assert.match(settingSource, new RegExp(`t\\("settings\\.${key}"\\)`));
    assert.match(enSource, new RegExp(`"settings\\.${key}":`));
    assert.match(zhSource, new RegExp(`"settings\\.${key}":`));
  }
});

/** 把组件里真实的 handleKeyDown 拿到 VM 里跑一遍（与 ChatInput.test.mjs 同一手法）。 */
function loadKeyHandler(overrides) {
  const source = ts.createSourceFile(
    "ChatInput.tsx",
    chatInputSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findHandler = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "handleKeyDown") {
      return node.initializer.arguments[0];
    }
    return ts.forEachChild(node, findHandler);
  };
  const script = new Script(ts.transpileModule(findHandler(source).getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText);
  let action = "native";
  const handler = script.runInNewContext({
    Date: { now: () => 1000 },
    COMPOSITION_END_ENTER_GRACE_MS: 100,
    isMobile: false, isStreaming: false, enterSendMode: "enter",
    isComposingRef: { current: false }, lastCompositionEndAtRef: { current: 0 },
    historyMenuOpen: false, inputHistory: [], historyActiveIndex: 0,
    slashMenuOpen: false, slashQuery: null, displayedSlashCommands: [{}], slashActiveIndex: 0,
    atMenuOpen: false, atQuery: null, atMatches: [{}], atActiveIndex: 0,
    referenceMenuOpen: false, referenceQuery: null, referenceItems: [], referenceActiveIndex: 0,
    onSteer() {}, onFollowUp() {},
    sendQueued() { action = "queued"; }, handleSend() { action = "send"; },
    applySlashCommand() { action = "slash"; },
    isExactSlashCommand() { return false; }, value: "", setSlashMenuOpen() {},
    applyAtCompletion() { action = "file"; },
    applyReferenceCompletion() { action = "reference"; },
    applyHistoryInput() { action = "history"; },
    ...overrides,
  });
  return (keys) => {
    action = "native";
    handler({
      key: "Enter", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
      nativeEvent: { isComposing: false, keyCode: 13 },
      preventDefault() { action = "prevented"; },
      ...keys,
    });
    return action;
  };
}

test("Enter sends by default and Ctrl+Enter sends only in the other mode", () => {
  const enterMode = loadKeyHandler();
  assert.equal(enterMode({}), "send");
  assert.equal(enterMode({ ctrlKey: true }), "send");

  const ctrlEnterMode = loadKeyHandler({ enterSendMode: "ctrlEnter" });
  assert.equal(ctrlEnterMode({}), "native"); // Enter 交还给浏览器 = 换行（G10 接管它）
  assert.equal(ctrlEnterMode({ ctrlKey: true }), "send");
  assert.equal(ctrlEnterMode({ metaKey: true }), "send");
});

test("Shift+Enter is a newline in both modes and never sends", () => {
  assert.equal(loadKeyHandler()({ shiftKey: true }), "native");
  assert.equal(loadKeyHandler({ enterSendMode: "ctrlEnter" })({ shiftKey: true }), "native");
});

test("mobile keeps Ctrl/Cmd+Enter as the only send shortcut in either mode", () => {
  const mobileEnter = loadKeyHandler({ isMobile: true, isStreaming: true });
  assert.equal(mobileEnter({}), "native");
  assert.equal(mobileEnter({ ctrlKey: true }), "queued");
  const mobileCtrlEnter = loadKeyHandler({ isMobile: true, isStreaming: true, enterSendMode: "ctrlEnter" });
  assert.equal(mobileCtrlEnter({}), "native");
  assert.equal(mobileCtrlEnter({ metaKey: true }), "queued");
});

test("menus take plain Enter in both modes; the IME guard covers plain Enter too", () => {
  // Ctrl+Enter 模式下菜单仍用纯 Enter 选中项（上游 #1001 的修复）。
  assert.equal(loadKeyHandler({ enterSendMode: "ctrlEnter", atMenuOpen: true, atQuery: {} })({}), "file");
  assert.equal(
    loadKeyHandler({ enterSendMode: "ctrlEnter", referenceMenuOpen: true, referenceQuery: {}, referenceItems: [{}], referenceActiveIndex: 0 })({}),
    "reference",
  );
  assert.equal(
    loadKeyHandler({ enterSendMode: "ctrlEnter", historyMenuOpen: true, inputHistory: ["prev"], historyActiveIndex: 0 })({}),
    "history",
  );
  // 纯 Enter 在 Ctrl+Enter 模式下是「选中这条斜杠命令」，不是直接发送。
  const exact = { name: "copy", source: "builtin", availableWhileStreaming: true };
  assert.equal(
    loadKeyHandler({
      enterSendMode: "ctrlEnter", slashMenuOpen: true, slashQuery: "copy",
      displayedSlashCommands: [exact], value: "/copy",
      isExactSlashCommand: () => true,
    })({}),
    "slash",
  );
  assert.equal(
    loadKeyHandler({
      enterSendMode: "ctrlEnter", slashMenuOpen: true, slashQuery: "copy",
      displayedSlashCommands: [exact], value: "/copy",
      isExactSlashCommand: () => true,
    })({ ctrlKey: true }),
    "send",
  );
  // IME：合成刚结束时确认候选的那个 Enter 不能顺带发送或换行。
  assert.equal(loadKeyHandler({ enterSendMode: "ctrlEnter", lastCompositionEndAtRef: { current: 950 } })({}), "prevented");
});

test("plain Enter continues the Markdown list once Ctrl+Enter is the send key", () => {
  // G10：Enter 腾出来之后，列表续行从 Shift+Enter 也跟到纯 Enter 上。
  // 默认档（Enter 直发）不受影响：同一个函数算出的续行不会被调用。
  const continuation = { value: "- item\n- ", caret: 9 };
  let calls = 0;
  const driven = (enterSendMode, value) => {
    calls = 0;
    const press = loadKeyHandler({
      enterSendMode,
      value,
      textareaRef: { current: { selectionStart: value.length, selectionEnd: value.length, focus() {}, setSelectionRange() {}, scrollHeight: 40, style: {} } },
      valueRef: { current: value },
      setValue() { calls += 1; },
      setAtQuery() {},
      requestAnimationFrame: (fn) => fn(),
      continueMarkdownList: () => continuation,
    });
    return [press({}), calls];
  };

  assert.deepEqual(driven("ctrlEnter", "- item"), ["prevented", 1]);
  assert.deepEqual(driven("enter", "- item"), ["send", 0]);
  // 没有列表结构时返回 null → 落回原生换行（不发送、不改值）。
  const empty = loadKeyHandler({
    enterSendMode: "ctrlEnter",
    value: "just text",
    textareaRef: { current: { selectionStart: 9, selectionEnd: 9, focus() {}, setSelectionRange() {}, scrollHeight: 40, style: {} } },
    valueRef: { current: "just text" },
    setValue() { throw new Error("must not rewrite"); },
    setAtQuery() {},
    requestAnimationFrame: (fn) => fn(),
    continueMarkdownList: () => null,
  });
  assert.equal(empty({}), "native");
});