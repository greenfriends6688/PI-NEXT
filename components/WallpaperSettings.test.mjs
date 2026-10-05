// 「当前壁纸」那一格（2026-10-05 用户判「占位缩小 + 点图放大」）。
//
// 锁两件事，都是真的会坏的那两件：
//  1. 占位里不再有文字 —— 设置栏的实际宽度会把「壁纸占位」压成竖排一列，
//     比旁边的按钮还抢眼（用户看到的就是那个样子）。图标外面那层 span 也一起锁：
//     去掉它，`.d-thumb > i` 会把图标拉成整格宽，贴左边而不是居中。
//  2. 有图时那格是 `ImagePreview`（点一下放大），不是一张点不动的 `background-image`。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./WallpaperSettings.tsx", import.meta.url), "utf8");

test("the empty-wallpaper cell is icon-only (the label wrapped to one character per line)", () => {
  assert.doesNotMatch(source, /WALLPAPER_PLACEHOLDER/);
  // 占位格里除了图标没有别的节点 —— 文字就是竖排一列那个观感的来源。
  assert.match(
    source,
    /<span className="d-thumb d-placeholder">\s*<span><i data-ico="image" data-size="16" aria-hidden="true" \/><\/span>\s*<\/span>/,
  );
});

test("a chosen wallpaper is a click-to-zoom thumbnail, not a dead background-image", () => {
  assert.match(source, /<ImagePreview\s+src=\{url\}/);
  // 缩略图 16:9 cover，看不清细节 —— 点开看全图。
  assert.match(source, /objectFit: "cover"/);
  assert.doesNotMatch(source, /backgroundImage: `url\(\$\{url\}\)`/);
});