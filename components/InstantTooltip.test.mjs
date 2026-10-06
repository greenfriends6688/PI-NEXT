import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./InstantTooltip.tsx", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const forkUi = await readFile(new URL("../app/fork-ui.css", import.meta.url), "utf8");

// fork:instant-tip（用户 2026-10-05：「悬浮上去后立刻出现提示文字」）—— 原生 `title`
// 的弹出延迟由浏览器 / 系统决定，页面上改不了。唯一的办法是借走 `title` 自己画，
// 并且**离开时原样还回去**（无障碍属性 + 可访问名称 + 源码里的 `title=` 断言）。
test("steals title on enter and gives it back on leave", () => {
  assert.match(source, /el\.setAttribute\(STASH, title\);\s*el\.removeAttribute\("title"\);/);
  assert.match(source, /if \(stashed === null\) return;\s*if \(!el\.hasAttribute\("title"\)\) el\.setAttribute\("title", stashed\);\s*el\.removeAttribute\(STASH\);/);
});

test("no delay on the layer — opacity only, and it never eats the pointer", () => {
  assert.doesNotMatch(forkUi, /transition-delay/);
  assert.match(forkUi, /\[data-tip-layer\] \{[^}]*pointer-events: none;/);
  assert.match(forkUi, /transition: opacity 90ms var\(--nx-ease\);/);
});

test("the layer reuses the board floating panel and the existing tooltip contract", () => {
  // `.d-pop-float` = 底色 / 描边 / 圆角 / 阴影 / z 序都在库里，不另起一套。
  assert.match(source, /layer\.className = "d-pop-float";/);
  // `role="tooltip"` 是既有契约：Mac 拟物档早就按这个属性写好了底色。
  assert.match(source, /layer\.setAttribute\("role", "tooltip"\);/);
  // 挂在 body 末尾，与图标层同级（不进任何组件树）。
  assert.match(layout, /<InstantTooltip \/>/);
});

// 键盘也要有提示（focusin / focusout 与鼠标共用一条路径），否则焦点用户拿到零信息。
test("focus uses the same path as hover", () => {
  assert.match(source, /addEventListener\("focusin", enter\)/);
  assert.match(source, /addEventListener\("focusout", leave\)/);
});
