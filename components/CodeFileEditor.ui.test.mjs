import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:design-components —— 可编辑源码视图 = 画板 52 帧 A（编辑中 / 保存冲突）。
// 头是 `.pw-viewer-head`，底是 `.pw-card-foot`，冲突片段是 `.pw-detail` + `.pw-litem`，
// 保存失败是 `.pw-alert`：尺寸 / 字号 / 圆角只有一个来源（board.css），
// 组件里不再留任何自有视觉类。
const raw = await readFile(new URL("./CodeFileEditor.tsx", import.meta.url), "utf8");
// 注释里可以谈被换掉的旧类名（「随那个类一起换掉」），门禁只看真正的代码。
const source = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => {
    const at = line.indexOf("//");
    return at === -1 ? line : line.slice(0, at);
  })
  .join("\n");

test("the source editor's own class names are gone", () => {
  for (const legacy of [
    "code-file-editor-shell",
    "code-file-editor",
    "markdown-sync-notice",
    "markdown-conflict",
  ]) {
    assert.doesNotMatch(source, new RegExp(legacy), `${legacy} must not survive the pw-* port`);
  }
});

test("the head is the board's viewer head: path, type badge, warn badge, undo + save", () => {
  assert.match(source, /className="pw-viewer"/);
  assert.match(source, /className="pw-viewer-head"/);
  assert.match(source, /className="pw-mono"/);
  assert.match(source, /data-ico=\{hasConflicts \? "triangle-alert" : "file-code"\}/);
  assert.match(source, /\{typeLabel && <span className="pw-badge">\{typeLabel\}<\/span>\}/);
  // 冲突优先于未保存（画板 52 帧 B 的头部只挂「有冲突」一个徽章）。
  assert.match(source, /<span className="pw-badge warn">\{t\("files\.conflict"\)\}<\/span>/);
  assert.match(source, /<span className="pw-badge warn">\{t\("files\.unsavedChanges"\)\}<\/span>/);
  assert.match(source, /className="pw-btn sm"/);
  assert.match(source, /className="pw-btn primary sm" onClick=\{\(\) => void sync\?\.save\(\)\}/);
  assert.match(source, /data-ico="undo-2"/);
  assert.match(source, /data-ico="save"/);
});

test("the footer is the board's card foot: cursor position plus type, EOL and encoding", () => {
  assert.match(source, /className="pw-card-foot"/);
  assert.match(source, /<span>Ln \{cursor\[0\]\} · Col \{cursor\[1\]\}<\/span>/);
  assert.match(source, /state\.content\.includes\("\\r\\n"\) \? "CRLF" : "LF", "UTF-8"/);
  // 行列读数只能来自编辑器自己的 update，不能另开一条数据流。
  assert.match(source, /setCursor\(\(previous\) =>/);
});

test("the three sync paths keep their old behaviour", () => {
  // 保存失败：仍然是 role="alert" + 同一个 retry。
  assert.match(source, /className="pw-alert" role="alert"/);
  assert.match(source, /t\("files\.textSaveFailed"\)/);
  assert.match(source, /className="pw-btn sm" onClick=\{\(\) => sync\?\.retry\(\)\}/);
  // 外部改动冲突：两个动作还是原来的 resolve(key, choice)。
  assert.match(source, /sync\?\.resolve\(conflict\.key, "local"\)/);
  assert.match(source, /sync\?\.resolve\(conflict\.key, "external"\)/);
  assert.match(source, /className="pw-code-body grow"/);
  assert.match(source, /className="pw-detail"/);
  // 未保存读的是拦截用的同一个信号。
  assert.match(source, /const unsaved = sync\?\.dirty \?\? false;/);
});

test("the CodeMirror theme reads board tokens, never the product's own colour slots", () => {
  for (const token of [
    "var(--n-text)",
    "var(--surface-canvas)",
    "var(--surface-panel)",
    "var(--n-placeholder)",
    "var(--n-border-subtle)",
    "var(--overlay-selected)",
  ]) {
    assert.ok(source.includes(token), `${token} must drive the editor theme`);
  }
  for (const productSlot of [/var\(--text\)/, /var\(--bg\)/, /var\(--border\)/, /var\(--bg-panel\)/, /var\(--text-dim\)/]) {
    assert.doesNotMatch(source, productSlot);
  }
});
