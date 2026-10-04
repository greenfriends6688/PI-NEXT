import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:design-components —— 可编辑源码视图 = 画板 52 帧 A（编辑中 / 保存冲突）。
// 2026-10-04（Wave B / M-06）：同一块 DOM 在窄屏换成 PWA 形态的 `m-*`（画板
// M-06 帧 B），所以下面断言的是**类名映射**而不是字面类名 —— 断点在
// `useIsMobile()`，两个形态都必须挂在同一批节点上，一个都不许漏。
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

test("the head is the board's viewer bar: path, type badge, warn badge, undo + save", () => {
  // 形态映射：窄屏 m-*、宽屏 d-*，两档都渲染同一批节点。
  assert.match(source, /const shellClass = isMobile \? "m-viewer is-open" : "d-viewer";/);
  assert.match(source, /const barClass = isMobile \? "m-viewer-bar" : "d-viewer-bar";/);
  assert.match(source, /isMobile \? "m-viewer-path" : "d-viewer-path"/);
  assert.match(source, /data-ico=\{hasConflicts \? "triangle-alert" : "file-code"\}/);
  assert.match(source, /\{typeLabel && <span className=\{badge\("mute"\)\}>\{typeLabel\}<\/span>\}/);
  // 冲突优先于未保存（画板 52 帧 B 的头部只挂「有冲突」一个徽章）。
  assert.match(source, /\{hasConflicts && <span className=\{badge\("warn"\)\}>\{t\("files\.conflict"\)\}<\/span>\}/);
  assert.match(source, /\{!hasConflicts && unsaved && <span className=\{badge\("warn"\)\}>\{t\("files\.unsavedChanges"\)\}<\/span>\}/);
  assert.match(source, /className=\{button\(\)\}/);
  assert.match(source, /className=\{button\("primary"\)\} onClick=\{\(\) => void sync\?\.save\(\)\}/);
  assert.match(source, /data-ico="undo-2"/);
  assert.match(source, /data-ico="save"/);
});

test("the footer is the board's code head: cursor position plus type, EOL and encoding", () => {
  assert.match(source, /const codeHeadClass = isMobile \? "m-code-head" : "d-code-head";/);
  assert.match(source, /<span className=\{isMobile \? "m-grow" : "d-grow"\}>Ln \{cursor\[0\]\} · Col \{cursor\[1\]\}<\/span>/);
  assert.match(source, /state\.content\.includes\("\\r\\n"\) \? "CRLF" : "LF", "UTF-8"/);
  // 行列读数只能来自编辑器自己的 update，不能另开一条数据流。
  assert.match(source, /setCursor\(\(previous\) =>/);
});

test("the three sync paths keep their old behaviour", () => {
  // 保存失败：仍然是 role="alert" + 同一个 retry。
  assert.match(source, /className=\{isMobile \? "m-banner err" : "d-banner err"\} role="alert"/);
  assert.match(source, /t\("files\.textSaveFailed"\)/);
  assert.match(source, /className=\{button\(\)\} onClick=\{\(\) => sync\?\.retry\(\)\}/);
  // 外部改动冲突：两个动作还是原来的 resolve(key, choice)。
  assert.match(source, /sync\?\.resolve\(conflict\.key, "local"\)/);
  assert.match(source, /sync\?\.resolve\(conflict\.key, "external"\)/);
  assert.match(source, /const codeBodyClass = isMobile \? "m-code-body" : "d-code-body";/);
  assert.match(source, /isMobile \? "m-doc-frame" : "d-card-body d-col"/);
  // 未保存读的是拦截用的同一个信号。
  assert.match(source, /const unsaved = sync\?\.dirty \?\? false;/);
});

test("the CodeMirror theme reads board tokens, never the product's own colour slots", () => {
  for (const token of [
    "var(--nx-text)",
    "var(--nx-code-bg)",
    "var(--nx-panel)",
    "var(--nx-text-3)",
    "var(--nx-line)",
    "var(--nx-selected)",
  ]) {
    assert.ok(source.includes(token), `${token} must drive the editor theme`);
  }
  for (const productSlot of [/var\(--text\)/, /var\(--bg\)/, /var\(--border\)/, /var\(--bg-panel\)/, /var\(--text-dim\)/]) {
    assert.doesNotMatch(source, productSlot);
  }
});
