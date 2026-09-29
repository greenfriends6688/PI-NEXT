import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ShortcutsSettings.tsx", import.meta.url), "utf8");

/*
 * fork:design-system —— 画板 45 的快捷键页：页头 + `.pw-inline` 工具条（搜索 /
 * 计数 / 全部重置）+ `.pw-grid2` 分组，每行是 `.pw-field`（左标签、右 `.pw-ctl`
 * 里的 `.pw-kbd` 键帽与 `.pw-btn.sm` 动作）。旧的页面自有 section / hint 类与
 * 手写 `<kbd style=…>` 必须清零。
 */

test("the page head and toolbar are the board's page head + inline row", () => {
  assert.match(source, /<PwPageHead title=\{t\("settings\.shortcuts\.title"\)\} sub=\{t\("settings\.shortcuts\.description"\)\} \/>/);
  assert.match(source, /<ConfigDetailActions>/);
  assert.match(source, /className="pw-input"\n\s+type="search"/);
  assert.match(source, /<span className="pw-badge count">\{visibleCommands\.length\}<\/span>/);
  assert.match(source, /data-ico="undo-2"/);
});

test("groups are pw-sec-title inside a two-column grid", () => {
  assert.match(source, /<div className="pw-grid2">/);
  assert.match(source, /<ConfigSectionTitle>\{t\(SHORTCUT_GROUP_LABEL_KEYS\[group\]\)\}<\/ConfigSectionTitle>/);
});

test("keycaps are pw-kbd, one per key of the chord", () => {
  assert.match(source, /<span className="pw-inline">\n\s+\{parts\.map\(\(part, index\) => \(\n\s+<kbd className="pw-kbd" key=\{`\$\{part\}-\$\{index\}`\}>\{part\}<\/kbd>/);
  assert.doesNotMatch(source, /borderBottomWidth|var\(--radius-sm, 6px\)|<kbd\n/);
});

test("every command row is a pw-field with a pw-ctl of kbd + sm buttons", () => {
  assert.match(source, /<ConfigField\n\s+label=\{\n\s+<>\n\s+\{label\}\n\s+\{entry\.managed === false && <small>\{t\("settings\.shortcuts\.notConfigurable"\)\}<\/small>\}/);
  assert.match(source, /<PwCtl>\n\s+\{isRecording \? \(/);
  assert.match(source, /\{recording\?\.preview\n\s+\? <kbd className="pw-kbd">\{recording\.preview\}<\/kbd>/);
  assert.match(source, /<ConfigButton variant="secondary" size="small" onClick=\{onStartRecording\}>/);
  assert.match(source, /<ConfigButton variant="ghost" size="small" onClick=\{onCancel\}>/);
});

test("recording errors and empty search use the board's alert / empty primitives", () => {
  assert.match(source, /<div className="pw-alert" role="alert">/);
  assert.match(source, /<ConfigEmptyState>\s*\n\s*<p>\{t\("settings\.shortcuts\.searchEmpty"\)\}<\/p>/);
  assert.doesNotMatch(source, /settings-general|settings-chat-range-hint|settings-search-input/);
});
