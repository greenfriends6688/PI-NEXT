// fork:mac-skeuo — 「Mac拟物风格」这套内置皮肤的**接线锁**。
//
// ## 为什么这一层全是读源文本
//
// 材质层靠 `html[data-theme-skin-id="builtin-mac-skeuo"]` 这个**字符串**挂载，
// 它和 `lib/mac-skeuo.ts` 的 `MAC_SKEUO_SKIN_ID` 常量之间没有任何编译期联系。
// 改了一边：CSS 静默失效、界面退回默认外观，而 **typecheck 与 check:design 全过**。
//
// 这类「两份声明必须一致」的不变量，用 import 把两边都跑起来是必要的；但
// `mac-skeuo.ts` 内部按仓约定写的是无扩展名 import（`./theme-skins`），
// `node --experimental-strip-types` 解析不了（tsconfig 是 `moduleResolution:
// bundler`，开 `allowImportingTsExtensions` 会波及全仓 import 风格）。
// 所以这里读源文本 —— 本来要断的也是**声明**，不是运行时行为。
// 数据形状由 typecheck 保证，渲染由 `design/pi-web-design/.skeuo/verify.mjs` 兜。

import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const SKIN_TS = read("lib/mac-skeuo.ts");
const BUILTIN_TS = read("lib/builtin-skins.ts");
const HOOK_TS = read("hooks/useThemeSkins.ts");
const CSS = read("app/fork-mac-skeuo.css");
const CHECKER = read("scripts/check-motion-tokens.mjs");

/** 从 `export const X = "…"` 里取常量。 */
function constOf(source, name) {
  const m = source.match(new RegExp(`export const ${name} = "([^"]+)"`));
  assert.ok(m, `${name} 没找到`);
  return m[1];
}

const SKIN_ID = constOf(SKIN_TS, "MAC_SKEUO_SKIN_ID");
const LABEL_KEY = constOf(SKIN_TS, "MAC_SKEUO_SKIN_LABEL_KEY");

test("材质层的门禁选择器与 MAC_SKEUO_SKIN_ID 是同一个字符串（双向）", () => {
  const gated = [...CSS.matchAll(/data-theme-skin-id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(gated.length > 0, "材质层没有写任何 data-theme-skin-id 门禁");
  // 双向都查：只查单向的话，把常量改名会让门禁指向一个不存在的皮肤，同样静默失效。
  for (const value of new Set(gated)) {
    assert.equal(value, SKIN_ID, `CSS 门禁里的 id 与常量不一致：${value}`);
  }
  // 常量必须真的在常量声明里，且被 lib/builtin-skins.ts 引用（否则是个孤儿常量）。
  assert.ok(BUILTIN_TS.includes('from "./mac-skeuo"'), "builtin-skins.ts 没有引入 mac-skeuo");
});

test("材质层明暗两支都挂在 data-theme-skin-mode 上", () => {
  for (const mode of ["light", "dark"]) {
    // 断言用布尔而不是 assert.match：匹配失败时后者会把整份 25KB 的 CSS
    // 打进测试输出，真正的信息（缺哪一支）被淹掉。
    const has = CSS.includes(
      `html[data-theme-skin-id="${SKIN_ID}"][data-theme-skin-mode="${mode}"]`,
    );
    assert.ok(has, `材质层没有 ${mode} 分支`);
  }
});

test("gel 派生挂在门禁元素自身（否则根上取不到，所有 gel 表面静默变透明）", () => {
  // 自定义属性的 var() 在声明它的那一层就完成替换。`html[data-…] *` 不匹配
  // <html> 自身，只写 `*` 的话 --aqua-gel-* 在根上是空的，--mac-gel 整条解析失败。
  assert.match(
    CSS,
    new RegExp(`^html\\[data-theme-skin-id="${SKIN_ID}"\\]\\s*\\{`, "m"),
    "门禁选择器没有把 html 自身列进去",
  );
  // 六个 gel 变量必须齐全，少一个就有一类表面退回平板色。
  for (const v of ["hi", "light", "mid", "deep"]) {
    assert.match(CSS, new RegExp(`--aqua-gel-${v}: color-mix\\(in oklab`), `缺 --aqua-gel-${v}`);
  }
  assert.match(CSS, /--aqua-edge: color-mix\(in oklab/);
  assert.match(CSS, /--aqua-ring: color-mix\(in oklab/);
});

test("useThemeSkins 把皮肤 id 写成 data-theme-skin-id（材质层的唯一入口）", () => {
  assert.ok(/dataset\.themeSkinId\s*=\s*skin\.id/.test(HOOK_TS), "useThemeSkins 没有写 dataset.themeSkinId");
  // 漏进 SKIN_DATA_ATTRIBUTES 的话，切回默认皮肤时这个属性会留在 <html> 上，
  // 材质层继续生效 —— 用户「恢复默认」恢复不掉。
  const list = HOOK_TS.match(/SKIN_DATA_ATTRIBUTES = \[([\s\S]*?)\] as const/);
  assert.ok(list, "找不到 SKIN_DATA_ATTRIBUTES");
  assert.match(list[1], /"themeSkinId"/);
});

test("这套皮肤进得了卡片条（进了 BUILTIN_SKINS 的组合）", () => {
  assert.match(BUILTIN_TS, /\.\.\.BUILTIN_WALLPAPERS\.map\(/);
  assert.match(BUILTIN_TS, /MAC_SKEUO_SKIN,\s*\n\]/);
  assert.match(BUILTIN_TS, /findActiveSkinIncludingBuiltins[\s\S]*allSkinCandidates/);
  // 卡片标题表里用的是常量而不是字面量（编译期保证它就是 SKIN_ID）；
  // 常量本身的值由上一条锁到 CSS 门禁上。
  assert.match(BUILTIN_TS, /\[MAC_SKEUO_SKIN_ID\]: MAC_SKEUO_SKIN_LABEL_KEY/);
});

test("浅色端与夜间端确实是两套色（否则「分两种」这个需求没落地）", () => {
  const variant = (mode) => {
    const block = SKIN_TS.match(new RegExp(`\\n  ${mode}: \\{([\\s\\S]*?)\\n  \\},`));
    assert.ok(block, `${mode} 变体没找到`);
    return Object.fromEntries(
      [...block[1].matchAll(/(background|panel|accent|text): "(#[0-9a-f]{6})"/g)]
        .map((m) => [m[1], m[2]]),
    );
  };
  const light = variant("light");
  const dark = variant("dark");
  for (const key of ["background", "panel", "accent", "text"]) {
    assert.ok(light[key], `浅色端 ${key} 是空的（会回落到主题 token，拟物就没了）`);
    assert.ok(dark[key], `夜间端 ${key} 是空的`);
    assert.notEqual(light[key], dark[key], `${key} 明暗同色`);
  }
  // 共享基色必须有值：`ThemeSkinStrip.skinCardPaint()` 画的卡片预览读的是**共享**
  // 字段（不读变体），留空 = 卡片条里那张卡全空白。运行时不受影响，因为
  // `resolveSkinColors()` 是 `variant.x || skin.x`，两个变体都非空。
  for (const key of ["background", "panel", "accent", "text"]) {
    const shared = SKIN_TS.match(new RegExp(`\\n  ${key}: "(#[0-9a-f]{6})"`));
    assert.ok(shared, `共享基色 ${key} 是空的（皮肤卡片会是空白卡）`);
    assert.equal(shared[1], light[key], `共享 ${key} 应与浅色端一致`);
  }
});

test("材质不占用用户自定义 CSS 的额度，也不带壁纸", () => {
  // parseThemeSkin 把 customCss 截到 20000 字符。产品样式塞进去等于让产品样式
  // 依赖一个用户可编辑的口子：用户改坏了就是全站样式坏，且没法定位。
  assert.ok(SKIN_TS.includes('customCss: "",'));
  assert.ok(SKIN_TS.includes("wallpaper: null,"));
});

test("三个语言都有这张卡片的标题", () => {
  assert.equal(constOf(SKIN_TS, "MAC_SKEUO_SKIN_LABEL_KEY"), LABEL_KEY);
  for (const locale of ["zh-CN", "zh-TW", "en"]) {
    assert.ok(
      read(`lib/i18n/messages/${locale}.ts`).includes(`"${LABEL_KEY}"`),
      `${locale} 缺 ${LABEL_KEY}`,
    );
  }
});

test("材质层 CSS 在动效 token 门禁的扫描清单里", () => {
  assert.ok(CHECKER.includes('"app/fork-mac-skeuo.css"'), "动效门禁的扫描清单里没有它");
});

test("材质层在 app/layout.tsx 里排在 fork-ui.css 之后（靠源码顺序取胜）", () => {
  const layout = read("app/layout.tsx");
  const ui = layout.indexOf('import "./fork-ui.css"');
  const mac = layout.indexOf('import "./fork-mac-skeuo.css"');
  assert.ok(ui >= 0 && mac > ui, "fork-mac-skeuo.css 必须在 fork-ui.css 之后引入");
});
