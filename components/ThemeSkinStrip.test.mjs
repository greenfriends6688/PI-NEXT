import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * fix:skin-card-wallpaper —— 内置皮肤（蔡徐坤 / 章若楠）的四个基色**故意留空**
 * （继承主题配色，见 lib/builtin-skins.ts），它们唯一的标识就是那张画。
 * 卡面把空值当颜色铺下去，回落成 `--n-panel` / `--n-canvas` 两块主题色 ——
 * 用户看到的就是两个空白的卡（实测反馈「为什么不显示图片」）。
 *
 * 组件里有 JSX，Node 的 strip-types 进不来，所以按本仓惯例做源码级断言。
 */

const source = await readFile(new URL("./ThemeSkinStrip.tsx", import.meta.url), "utf8");
const builtinSource = await readFile(new URL("../lib/builtin-skins.ts", import.meta.url), "utf8");

test("内置皮肤确实带壁纸且基色留空（这条前提取自数据层）", () => {
  assert.match(builtinSource, /wallpaper: paintingPath\(item\.id\)/);
  assert.match(builtinSource, /createSkinDraft\(builtinSkinId\(item\.id\), "", "dark"/);
});

test("卡面：有画就铺画，它的优先级高于底色", () => {
  // 判据函数存在，且 `.b`（内容列）走的是 backgroundImage 而不是 background 简写。
  assert.match(source, /export function skinCardPaint\(/);
  assert.match(source, /const wallpaper = skin\.wallpaper\?\.trim\(\)/);
  assert.match(source, /b: wallpaper\s*\?\s*\{ backgroundImage: `url\("?\$\{wallpaper\}"?\)`/);
  // 有画的分支里不能再写 background 简写：简写会把 background-image 一起重置掉。
  const paintFn = source.slice(source.indexOf("export function skinCardPaint("));
  const branch = paintFn.slice(0, paintFn.indexOf("function SkinCardArt"));
  assert.doesNotMatch(branch.split("?")[1]?.split(":")[0] ?? "", /background:/);
});

test("默认皮肤与空基色都落回 board.css（不写内联）", () => {
  assert.match(source, /style=\{paint\.a\}/);
  assert.match(source, /style=\{paint\.b\}/);
  assert.match(source, /a: skin\.panel \? \{ background: skin\.panel \} : undefined/);
  assert.match(source, /: skin\.background \? \{ background: skin\.background \} : undefined/);
});
