import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const settingsPanel = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const settingsUi = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const chatAppearanceHook = await readFile(new URL("../hooks/useChatAppearance.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { clampChatContentWidth, clampChatContentFontSize, clampExtensionWidgetFontSize } = await jiti.import("../hooks/useChatAppearance.ts");
const { USER_TEXT_SIZE_OPTIONS } = await jiti.import("../lib/typography.ts");

const widthVariable = /var\(--chat-content-max-width, 800px\)/g;
const composerVariable = /var\(--composer-max-width, 892px\)/g;

test("chat content keeps the 800px default behind one shared variable", () => {
  assert.equal((chatWindow.match(widthVariable) ?? []).length, 1);
  assert.equal((chatInput.match(composerVariable) ?? []).length, 1);
  assert.match(globals, /--chat-content-max-width: 800px;/);
  assert.doesNotMatch(chatWindow, /max-w-\[768px\]|maxWidth: 768/);
  assert.doesNotMatch(chatInput, /maxWidth: 768/);
});

test("Markdown reading and editing keep an independent fixed 900px measure", () => {
  assert.match(globals, /--readable-content-max-width: 900px;/);
  assert.match(chatAppearanceHook, /--chat-content-max-width/);
  assert.doesNotMatch(chatAppearanceHook, /setProperty\("--readable-content-max-width"/);
  assert.match(globals, /\.markdown-readable-column[\s\S]*var\(--readable-content-max-width, 900px\)/);
});

test("General chat settings own the chat width preference", () => {
  assert.match(chatInput, /useChatAppearance\(\)/);
  assert.match(settingsPanel, /useChatAppearance\(\)/);
  // fork:design-system SW-07 —— 滑块本身收敛进 SettingsUi（画板 40 的数值型设置行），
  // 设置页只负责把区间常量接上去；真 `<input type=range">` 在那个基件里。
  // fork:v5-landing-frame · D-07b 帧 B —— 「聊天内容宽度」那一行按板面原文改成
  // `.d-grow-last > .d-badge` + 行尾 `.d-slider` + `.d-btn.sm.ghost`，所以滑块不再由
  // 设置页直接写 `<PwRange>`，而是作为 `PwField` 的 `slider` 槽传下去（同一批基件、
  // 同一批区间常量，行为零变化）。
  assert.match(settingsPanel, /id: "settings-chat-content-width"/);
  assert.match(settingsUi, /type="range"/);
  assert.match(settingsUi, /className="d-slider"/);
  assert.match(settingsPanel, /min: CHAT_CONTENT_WIDTH_MIN/);
  assert.match(settingsPanel, /max: CHAT_CONTENT_WIDTH_MAX/);
  assert.match(settingsPanel, /step: 10/);
  assert.match(chatAppearanceHook, /pi-chat-content-width/);
  assert.match(chatAppearanceHook, /localStorage\.setItem/);
});
test("chat width validation preserves the default and supported range", () => {
  assert.equal(clampChatContentWidth(undefined), 800);
  assert.equal(clampChatContentWidth("invalid"), 800);
  assert.equal(clampChatContentWidth(700), 700);
  assert.equal(clampChatContentWidth(1104), 1104);
  assert.equal(clampChatContentWidth(2400), 2000);
});

test("第 13 条——字号只允许停在规范的五档上（去掉 meta）", () => {
  // fork:type-scale（2026-09-30）—— 旧行为是 12–24 的连续钳位，14 / 16 / 24 都能活下来，
  // 而这三个值不在设计规范的 11 / 12 / 13 / 15 / 20 里。现在存过的旧值归并到最近的规范档。
  assert.equal(USER_TEXT_SIZE_OPTIONS.join(","), "12,13,15,20");
  for (const value of [undefined, null, "invalid", Infinity, NaN]) {
    assert.equal(clampChatContentFontSize(value), 13);
    assert.equal(clampExtensionWidgetFontSize(value), 13);
  }
  // 归并口径：并列时收敛到较小档（14 距 13 与 15 各 1 → 13）。
  assert.equal(clampChatContentFontSize(8), 12);
  assert.equal(clampChatContentFontSize(14), 13);
  assert.equal(clampChatContentFontSize("18"), 20);
  assert.equal(clampChatContentFontSize(16), 15);
  assert.equal(clampChatContentFontSize(30), 20);
  assert.equal(clampExtensionWidgetFontSize(8), 12);
  assert.equal(clampExtensionWidgetFontSize(14), 13);
  assert.equal(clampExtensionWidgetFontSize("18"), 20);
  assert.equal(clampExtensionWidgetFontSize(16), 15);
  assert.equal(clampExtensionWidgetFontSize(30), 20);
  // 选项与默认值都由规范推导，不再是一份手写拷贝。
  assert.match(chatAppearanceHook, /DESIGN_TEXT_PX\.body/);
  assert.match(chatAppearanceHook, /snapUserTextSize/);
  assert.doesNotMatch(chatAppearanceHook, /CHAT_CONTENT_FONT_SIZE_MAX/);
  assert.match(settingsPanel, /USER_TEXT_SIZE_OPTIONS/);
  // 字号不再用连续滑块（滑块只留给「聊天内容宽度」那一行）。
  assert.doesNotMatch(settingsPanel, /settings-chat-content-font-size"[\s\S]{0,600}<PwRange/);
});
