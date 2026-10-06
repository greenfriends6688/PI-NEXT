import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PwIcons.tsx", import.meta.url), "utf8");

// fork:icon-swap（用户 2026-10-05：「折叠子智能体的箭头为啥不跟着变」）——
// `<i data-ico={collapsed ? "chevron-right" : "chevron-down"}>` 换的是同一个节点上的
// 属性：React 不碰它不知道的那份 innerHTML，而 `hydrate()` 被 `data-ico-done` 挡掉。
// 后果是全仓约 100 处「按状态换图标」的控件都冻在第一枚字形上。守卫这两条接线。
test("the icon hydrator repaints when a swapped data-ico changes the glyph", () => {
  assert.match(source, /attributeFilter: \["data-ico", "data-size", "data-stroke"\]/);
  assert.match(source, /mutation\.target instanceof Element\) repaint\(mutation\.target\);/);
});

test("repaint is keyed on the icon name, not a one-shot done flag", () => {
  assert.match(source, /const key = `\$\{name\}:\$\{size\}:\$\{stroke\}`;/);
  assert.match(source, /if \(el\.getAttribute\("data-ico-done"\) === key\) return;/);
  assert.match(source, /el\.setAttribute\("data-ico-done", key\);/);
});
