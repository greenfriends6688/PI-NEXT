import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

test("anchors the collapsed reasoning menu to its left edge", () => {
  // fork:ui-composer-pop —— 左侧组的下拉一律左缘锚定（无条件，不再分窄宽屏）：
  // 右缘锚定会把 320 宽的浮窗探出卡片左缘，被 .pw-composer 的 overflow-x:clip
  // 裁掉。真正的约束是「浮窗从触发点向右展开」，与断层的窄宽形态无关。
  assert.match(
    source,
    /thinkingDropdownOpen[\s\S]*?bottom: "calc\(100% \+ 6px\)"[\s\S]*?left: 0,/,
  );
  assert.doesNotMatch(
    source,
    /thinkingDropdownRef[\s\S]*?right: narrowControls \? undefined : 0/,
  );
});
