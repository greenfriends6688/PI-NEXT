// fork:tooltip-policy —— 原生 `title` 提示的三条规则（用户 2026-10-06 裁定）。
// 纯函数部分单测；DOM 接线（pointerover 摘 / pointerout 还）在浏览器里跑。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { shouldKeepNativeTitle, PWA_QUERY } = await jiti.import("./useTooltipPolicy.ts");

test("PWA 形态一个都不留", () => {
  assert.equal(shouldKeepNativeTitle({ text: "", hasIcon: true, isPwa: true }), false);
  assert.equal(shouldKeepNativeTitle({ text: "保存", hasIcon: true, isPwa: true }), false);
  assert.equal(PWA_QUERY, "(max-width: 640px)", "断点必须与 app/globals.css 同值");
});

test("只留纯图标：没有图标就不留", () => {
  assert.equal(shouldKeepNativeTitle({ text: "", hasIcon: false, isPwa: false }), false);
  assert.equal(shouldKeepNativeTitle({ text: "", hasIcon: true, isPwa: false }), true);
});

test("元素自己有可见文字（中文 / 英文 / 数字）就不留", () => {
  for (const text of ["保存", "Save", "6/6", "PWA 2.0", "  重试  "]) {
    assert.equal(shouldKeepNativeTitle({ text, hasIcon: true, isPwa: false }), false, text);
  }
  // 纯符号 / 空白不算「可见文字」：图标字形与分隔符不该把提示顶掉。
  for (const text of ["", "   ", "·", "—"]) {
    assert.equal(shouldKeepNativeTitle({ text, hasIcon: true, isPwa: false }), true, JSON.stringify(text));
  }
});
