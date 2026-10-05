import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:v5-landing D-03e 帧 C —— ref 芯片 = 画板的 `.d-chips` + `.d-cite`
// （HEAD 用 `.d-cite.is-on`）。形状 / 字号 / 圆角全由 system.css 给；组件里
// 只剩「这条 ref 落在哪条泳道」这件设计系统不管的事（泳道色取自泳道图）。
//
// 本文件原先钉的是 v1 的 `.pw-badge count` + `.pw-ico` 包装层。那套已经退役：
// 同一行里出现两套芯片原语。约束改成钉新的等价形态，**性质没松**：图标词表、
// 泳道色算法、HEAD 与它指向的分支融合成一枚芯片，仍然逐条钉住。
const source = await readFile(new URL("./GitRefChips.tsx", import.meta.url), "utf8");
// 注释里会提到被退役的 v1 类名，断言只看代码。
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("chips are the board's .d-cite, HEAD uses .is-on", () => {
  assert.match(code, /className=\{tag\.kind === "head" \? "d-cite is-on" : "d-cite"\}/);
  assert.match(code, /className="d-cite is-on"/, "FusedRefChip is a single .d-cite.is-on");
  assert.match(code, /<span className="d-chips">\{items\}<\/span>/, "the list is one .d-chips row");
  assert.doesNotMatch(code, /pw-badge|pw-ico/, "v1 chip primitives are retired");
});

test("the chip's own typography is gone — system.css is the only source", () => {
  for (const property of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "whiteSpace", "flexShrink", "border:"]) {
    assert.doesNotMatch(code, new RegExp(property), `${property} must not be set on the product side`);
  }
  assert.doesNotMatch(code, /@\/lib\/typography/);
  assert.doesNotMatch(code, /TEXT\[/);
});

test("each ref kind gets a board icon", () => {
  assert.match(code, /const REF_ICON: Record<GitRefTagKind, "git-branch" \| "tag">/);
  assert.match(code, /tag: "tag"/);
  assert.match(code, /branch: "git-branch"/);
  assert.match(code, /data-ico=\{REF_ICON\[tag\.kind\]\}/);
  assert.match(code, /data-ico=\{REF_ICON\.head\}/);
});

test("HEAD still fuses with the branch it points at, into one chip", () => {
  assert.match(code, /next\.ref\.startsWith\("HEAD -> "\)/);
  assert.match(code, /index \+= 1;/);
  // 板面原样：实心强调底 = 泳道色填底；其余描边件 = 泳道色 10% 淡化。
  assert.match(code, /if \(kind === "head"\) \{\s*return \{ background: laneColor, color: "var\(--bg\)" \};/);
  assert.match(code, /color-mix\(in srgb, \$\{laneColor\} 10%, transparent\)/);
  // 一枚芯片读出 `HEAD → main`，不是两枚相接的药丸。
  assert.match(code, /\{`HEAD → \$\{branch\.label\}`\}/);
});