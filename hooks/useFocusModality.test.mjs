// fix:field-focus-modality —— 输入模态标记（规范 §1.4：焦点环只在键盘焦点时出现）。
//
// 钉住两件事：
//   1. 「这次按键算不算键盘焦点移动」是纯函数（可在没有 DOM 的环境里单测）；
//   2. 样式层确实按 `html[data-focus-modality]` 分档：鼠标档关掉字段描边，
//      composer 那圈焦点环也只留在键盘档。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { isKeyboardModalityKey } = await jiti.import("./useFocusModality.ts");

const key = (k, modifiers = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...modifiers });

test("Tab / 方向键 / Enter / Space 算键盘焦点移动", () => {
  for (const k of ["Tab", "Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]) {
    assert.equal(isKeyboardModalityKey(key(k)), true, `${k} 应当算键盘档`);
  }
});

test("普通字符与带修饰键的快捷键不算（打字时焦点框不该跳出来）", () => {
  for (const k of ["a", "中", "Escape", "F5", "Shift"]) {
    assert.equal(isKeyboardModalityKey(key(k)), false, `${k} 不该算键盘档`);
  }
  assert.equal(isKeyboardModalityKey(key("Tab", { metaKey: true })), false);
  assert.equal(isKeyboardModalityKey(key("Enter", { ctrlKey: true })), false);
  assert.equal(isKeyboardModalityKey(key(" ", { altKey: true })), false);
});

test("样式层按模态分档：鼠标档关字段描边，composer 环只在键盘档", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /html\[data-focus-modality="pointer"\] :where\(input, select, textarea\):focus-visible\s*\{[^}]*outline: none !important/);
  assert.match(css, /html\[data-focus-modality="keyboard"\] \.chat-content div\[style\*="--radius-composer"\]:focus-within/);
  // 满强度 accent 描边退役（蓝框的第二个来源）。
  assert.doesNotMatch(css, /:where\(input:not\(\[type="hidden"\]\), select, textarea\):focus\s*\{\s*border-color: var\(--accent\) !important/);
});
