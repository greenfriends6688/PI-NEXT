import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * fork:skin-builtin-identity / fork:skin-preview-reading-mask —— 2026-10-07 用户实拍
 * 修的三处，每条都留一条**会红的守卫**（组件里有 JSX，Node 的 strip-types 进不来，
 * 所以按本仓惯例做源码级断言）：
 *
 *   1. 编辑蔡徐坤（内置皮肤）时名称框空白 —— 内置名字在 `BUILTIN_SKIN_LABEL_KEYS`，
 *      `skin.name` 是空串；
 *   2. 同一张实拍里「壁纸串了」—— 保存过内置皮肤的覆盖后 `parseThemeSkin` 只认
 *      data URL，把 `paintingPath(id)` 丢成 null，预览/画廊就丢了画作、露出主题色板
 *      默认的章若楠；所以内置画作要由 `skin.id` 推，不能只看 `wallpaper`；
 *   3. 「页面透明度和会话阅读遮罩点了没啥反应」—— 预览的层序里 `--preview-page`
 *      必须在壁纸之上，且阅读遮罩要有一层 `--preview-reading`。
 */

const source = await readFile(new URL("./ThemeSkinStudio.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/fork-ui.css", import.meta.url), "utf8");

test("名称：内置皮肤的名字来自唯一一处目录（不是空的 skin.name）", () => {
  assert.match(source, /import \{[^}]*BUILTIN_SKIN_LABEL_KEYS[^}]*\} from "@\/lib\/builtin-skins"/);
  assert.match(source, /export function builtinSkinDisplayName\(/);
  assert.match(source, /const labelKey = BUILTIN_SKIN_LABEL_KEYS\[skin\.id\]/);
  assert.match(source, /return skin\.name \|\| \(labelKey \? t\(labelKey\) : ""\)/);
  // 草稿初始化与同步都要先补齐，否则名称框拿到的是空串。
  assert.match(source, /useState<ThemeSkin>\(\(\) => hydrateSkin\(skin, t\)\)/);
  assert.match(source, /useEffect\(\(\) => \{ setDraft\(hydrateSkin\(skin, t\)\); \}, \[skin, t\]\)/);
});

test("壁纸：内置画作由 skin.id 推（wallpaper 被 parseThemeSkin 丢成 null 也能补回）", () => {
  assert.match(source, /import \{[^}]*BUILTIN_SKIN_ID_PREFIX[^}]*\} from "@\/lib\/builtin-skins"/);
  assert.match(source, /export function builtinWallpaperIdForSkin\(/);
  assert.match(source, /if \(!isBuiltinSkinId\(skin\.id\)\) return null/);
  assert.match(source, /const derived = skin\.id\.slice\(BUILTIN_SKIN_ID_PREFIX\.length\)/);
  assert.match(source, /return isBuiltinWallpaperId\(derived\) \? derived : null/);
  // 草稿初始化把丢掉的画作补回 paintingPath；画廊选中态也走同一个判据。
  assert.match(source, /const wallpaper = skin\.wallpaper \?\? \(paintingId \? paintingPath\(paintingId\) : null\)/);
  assert.match(source, /activeId=\{builtinWallpaperIdForSkin\(draft\)\}/);
  // 用户显式挑过的内置画仍然优先，不能被 id 回退盖掉。
  const helper = source.slice(source.indexOf("export function builtinWallpaperIdForSkin("));
  const body = helper.slice(0, helper.indexOf("export function builtinSkinDisplayName("));
  assert.ok(body.indexOf("builtinIdForWallpaperUrl") < body.indexOf("isBuiltinSkinId"), "用户选择必须先于 id 回退");
});

test("预览层序：页面层在壁纸之上，阅读遮罩有独立层（两个滑块才有反馈）", () => {
  // 页面层：`--preview-page` 从 `.fork-skin-preview` 自身挪到独立层。
  assert.match(css, /\.fork-skin-preview-page \{[^}]*background: var\(--preview-page\)/);
  // 阅读遮罩层：整条 102deg 渐变在 JS 里算成 `--preview-reading`，CSS 只引用。
  assert.match(css, /\.fork-skin-preview-reading \{[^}]*background: var\(--preview-reading\)/);
  const previewBlock = css.slice(css.indexOf(".fork-skin-preview {"), css.indexOf(".fork-skin-preview-shell {"));
  assert.doesNotMatch(previewBlock, /\.fork-skin-preview \{[^}]*background: var\(--preview-page\)/);
  // JS 侧：两个值都从 draft 的真实字段算，且阅读遮罩是 102deg 三个色标。
  assert.match(source, /"--preview-page": `color-mix\(in srgb, \$\{bg\} \$\{draft\.pageOpacity\}%, transparent\)`/);
  assert.match(source, /"--preview-reading": `linear-gradient\(102deg,/);
  assert.match(source, /calc\(\$\{draft\.readingMask\}% \* 0\.86\)/);
  assert.match(source, /calc\(\$\{draft\.readingMask\}% \* 0\.42\)/);
  // DOM 顺序：壁纸 → 压暗 → 页面 → 阅读 → shell。
  const order = ["fork-skin-preview-mask", "fork-skin-preview-page", "fork-skin-preview-reading", "fork-skin-preview-shell"]
    .map((cls) => source.indexOf(`className="${cls}"`));
  assert.ok(order.every((i) => i >= 0), "四层都要在 JSX 里");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "层序必须是 压暗 → 页面 → 阅读 → chrome");
});
