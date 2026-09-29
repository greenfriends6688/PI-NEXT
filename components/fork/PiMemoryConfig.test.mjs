import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PiMemoryConfig.tsx", import.meta.url), "utf8");

/*
 * fork:design-system —— 画板 44 的记忆页：两块 `.pw-block`（开关与状态 / 记忆工具）
 * + 一组 `.pw-cols`（左：过滤框 + `.pw-list` 目录；右：`.pw-detail` 编辑器）。
 * 旧的 `settings-general*` / `settings-chat-*` / `settings-field-input` 自有类
 * 与内联盒子必须清零。
 */

test("the page is the board's blocks + two-column layout", () => {
  assert.match(source, /<PwPageHead title=\{t\("memory\.title"\)\} sub=\{t\("memory\.subtitle"\)\} \/>/);
  assert.match(source, /<PwBlock icon="brain" title=\{t\("memory\.switches"\)\}>/);
  assert.match(source, /<PwBlock icon="wrench" title=\{t\("memory\.tools"\)\}>/);
  assert.match(source, /<ConfigSplitView>/);
  assert.match(source, /<ConfigSidebar>/);
  assert.match(source, /<ConfigDetail>/);
  assert.doesNotMatch(source, /settings-general|settings-chat-|settings-field-input|settings-search-input/);
});

test("the switch and package state are pw-field rows with a status badge", () => {
  assert.match(source, /<ConfigField label=\{t\("memory\.enable"\)\}>/);
  assert.match(source, /checked=\{enabled\}\n\s+loading=\{busy === "enable" \|\| busy === "disable"\}/);
  assert.match(source, /className=\{enabled \? "pw-badge ok" : "pw-badge"\} role="status">\{statusText\}/);
  assert.match(source, /<p className="pw-hint">\{t\("memory\.enableHint"\)\}<\/p>/);
});

test("the file catalog is a pw-list of selectable rows, editing moves to the detail column", () => {
  assert.match(source, /<ConfigSidebarItem\n\s+key=\{file\.path\}\n\s+active=\{openFile\?\.path === file\.path\}\n\s+disabled=\{busy === file\.path\}\n\s+onClick=\{\(\) => void read\(file\.path\)\}/);
  assert.match(source, /data-ico="file-text"/);
  assert.match(source, /data-ico="file-plus"/);
  assert.match(source, /className="pw-lname pw-mono">\{file\.path\}/);
  assert.match(source, /className="pw-textarea"/);
  assert.match(source, /onClick=\{\(\) => onOpenFile\(`\$\{dir\}\/\$\{openFile\.path\}`\)\}/);
});

test("the conflict banner and errors use the board's pw-alert", () => {
  assert.match(source, /<div className="pw-alert" role="alert">/);
  assert.match(source, /data-ico="triangle-alert"/);
  assert.match(source, /\{conflict && \(/);
  assert.match(source, /onClick=\{\(\) => void read\(openFile\.path\)\}>\s*\n\s*\{t\("memory\.reload"\)\}/);
});

test("empty states use pw-empty + pw-empty-inner", () => {
  assert.match(source, /<ConfigEmptyState>\s*\n\s*<p>\{fileQuery\.trim\(\) \? t\("memory\.fileNoMatch"\) : t\("memory\.filesEmpty"\)\}<\/p>/);
  assert.match(source, /<ConfigEmptyState>\s*\n\s*<p>\{t\("memory\.filesHint"\)\}<\/p>/);
});
