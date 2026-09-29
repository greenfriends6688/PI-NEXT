import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:design-components —— ref 芯片 = 画板 31 的 `.pw-badge count`（board.css:209-220）。
// 形状 / 字号 / 圆角 / 等宽全部由 board.css 给；组件里只剩「这条 ref 落在哪条泳道」
// 这件设计系统不管的事（泳道色取自泳道图，不是一枚写死的色值）。
const source = await readFile(new URL("./GitRefChips.tsx", import.meta.url), "utf8");

test("both chips are the board's count badge", () => {
  const badges = source.match(/className="pw-badge count"/g) ?? [];
  assert.equal(badges.length, 2, "RefChip and FusedRefChip both mount .pw-badge count");
  assert.match(source, /className="pw-badge"\n/);
});

test("the chip's own typography is gone — board.css is the only source", () => {
  for (const property of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "whiteSpace", "flexShrink", "border:"]) {
    assert.doesNotMatch(source, new RegExp(property), `${property} must not be set on the product side`);
  }
  assert.doesNotMatch(source, /@\/lib\/typography/);
  assert.doesNotMatch(source, /TEXT\[/);
});

test("each ref kind gets a board icon", () => {
  assert.match(source, /const REF_ICON: Record<GitRefTagKind, "git-branch" \| "tag">/);
  assert.match(source, /tag: "tag"/);
  assert.match(source, /branch: "git-branch"/);
  assert.match(source, /data-ico=\{REF_ICON\[tag\.kind\]\}/);
  assert.match(source, /data-ico=\{REF_ICON\.branch\}/);
});

test("HEAD still fuses with the branch it points at", () => {
  assert.match(source, /next\.ref\.startsWith\("HEAD -> "\)/);
  assert.match(source, /index \+= 1;/);
  // 实心段与淡色段各自保留原来的处理：实心 = 泳道色填底，淡色 = 泳道色 10% 淡化。
  assert.match(source, /if \(kind === "head"\) \{\s*return \{ background: laneColor, color: "var\(--bg\)" \};/);
  assert.match(source, /color-mix\(in srgb, \$\{laneColor\} 10%, transparent\)/);
});
