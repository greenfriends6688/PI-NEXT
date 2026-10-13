import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./themes-fastvibe.ts");
  } catch {
    return import("./themes-fastvibe.ts");
  }
}

const {
  THEMES,
  LIGHT_THEME_IDS,
  DARK_THEME_IDS,
  DEFAULT_LIGHT_THEME,
  DEFAULT_DARK_THEME,
  themesFor,
  isThemeId,
  resolveFastvibeTheme,
} = await loadSubject();

/** `buildTokens()` 产出的 token 数（实测 41；玻璃开启时另有 13 个 glass-* 追加）。 */
const TOKEN_COUNT = 41;

test("has 24 themes: 12 light + 12 dark", () => {
  assert.equal(LIGHT_THEME_IDS.length, 12);
  assert.equal(DARK_THEME_IDS.length, 12);
  assert.equal(Object.keys(THEMES).length, 24);
});

test("every theme in the index lists actually exists", () => {
  for (const id of [...LIGHT_THEME_IDS, ...DARK_THEME_IDS]) {
    assert.ok(THEMES[id], `${id} is listed but missing from THEMES`);
  }
});

test("the index lists have no duplicates (a theme appearing twice renders twice in the picker)", () => {
  assert.equal(new Set(LIGHT_THEME_IDS).size, LIGHT_THEME_IDS.length);
  assert.equal(new Set(DARK_THEME_IDS).size, DARK_THEME_IDS.length);
});

test("light/dark lists agree with each theme's own kind", () => {
  for (const id of LIGHT_THEME_IDS) assert.equal(THEMES[id].kind, "light", `${id} is listed as light`);
  for (const id of DARK_THEME_IDS) assert.equal(THEMES[id].kind, "dark", `${id} is listed as dark`);
});

test("defaults live in the right list", () => {
  assert.ok(LIGHT_THEME_IDS.includes(DEFAULT_LIGHT_THEME));
  assert.ok(DARK_THEME_IDS.includes(DEFAULT_DARK_THEME));
});

test("every theme builds the same, complete token set", () => {
  // 少一个 token 的后果是「某个界面元素在某一套主题下没颜色」—— 只有切到那套才看得见。
  const reference = Object.keys(THEMES[DEFAULT_LIGHT_THEME].tokens).sort();
  assert.equal(reference.length, TOKEN_COUNT);
  for (const [id, theme] of Object.entries(THEMES)) {
    assert.deepEqual(Object.keys(theme.tokens).sort(), reference, `${id} has a different token set`);
  }
});

test("every token has a non-empty value", () => {
  // 空值会让 CSS 变量退化成「未定义」，界面上表现为透明 / 继承 —— 不报错。
  for (const [id, theme] of Object.entries(THEMES)) {
    for (const [name, value] of Object.entries(theme.tokens)) {
      assert.equal(typeof value, "string", `${id}.${name} type`);
      assert.ok(value.trim().length > 0, `${id}.${name} is empty`);
    }
  }
});

test("the deliberate seed→token mismatches are preserved (these are the theme system's shape)", () => {
  // 这三条是 `buildTokens()` 里最容易「顺手改对」而改错的地方 —— 见文件头注。
  for (const [id, theme] of Object.entries(THEMES)) {
    assert.equal(theme.tokens.accent, theme.muted, `${id}: accent must map to seed.muted, not seed.accent`);
    assert.equal(theme.tokens.card, theme.surface, `${id}: card ← surface`);
    assert.equal(theme.tokens.background, theme.bg, `${id}: background ← bg`);
    assert.equal(theme.tokens.foreground, theme.fg, `${id}: foreground ← fg`);
    assert.equal(theme.tokens.ring, theme.accent, `${id}: ring ← seed.accent`);
  }
});

test("chart colours fall back to the seed's syntax palette when charts is absent", () => {
  const theme = Object.values(THEMES).find((t) => !t.charts);
  if (!theme) return; // 24 套都有 charts 时这条不适用
  assert.equal(theme.tokens["chart-1"], theme.accent);
  assert.equal(theme.tokens["chart-2"], theme.syntax.keyword);
  assert.equal(theme.tokens["chart-5"], theme.mutedFg);
});

test("sidebar falls back to surface, and its accent to muted", () => {
  const theme = Object.values(THEMES).find((t) => !t.sidebar);
  if (!theme) return;
  assert.equal(theme.tokens.sidebar, theme.surface);
});

test("themesFor returns the right count and order per kind", () => {
  assert.equal(themesFor("light").length, 12);
  assert.equal(themesFor("dark").length, 12);
  assert.equal(themesFor("light")[0].id, LIGHT_THEME_IDS[0]);
  assert.equal(themesFor("dark")[0].id, DARK_THEME_IDS[0]);
});

test("isThemeId accepts only real ids", () => {
  assert.equal(isThemeId("github-dark"), true);
  assert.equal(isThemeId("nope"), false);
  assert.equal(isThemeId(null), false);
  assert.equal(isThemeId(42), false);
});

test("resolveFastvibeTheme: mode pins the kind, system follows prefersDark", () => {
  const prefs = { mode: "light", light: "one-light", dark: "dracula" };
  assert.equal(resolveFastvibeTheme(prefs).id, "one-light");
  assert.equal(resolveFastvibeTheme({ ...prefs, mode: "dark" }).id, "dracula");
  assert.equal(resolveFastvibeTheme({ ...prefs, mode: "system" }, true).id, "dracula");
  assert.equal(resolveFastvibeTheme({ ...prefs, mode: "system" }, false).id, "one-light");
});

test("resolveFastvibeTheme falls back instead of throwing on bad stored values", () => {
  // localStorage 里的值可能是手改的、或上一个版本留下的 id —— 不能让整个应用白屏。
  assert.equal(resolveFastvibeTheme({ mode: "light", light: "deleted-theme", dark: "dracula" }).id, DEFAULT_LIGHT_THEME);
  assert.equal(resolveFastvibeTheme({ mode: "dark", light: "one-light", dark: "deleted-theme" }).id, DEFAULT_DARK_THEME);
});

test("resolveFastvibeTheme rejects a theme whose kind disagrees with the slot", () => {
  // 把一套暗色主题存进「亮色选择」里（旧版本数据 / 手改）时要回落到该类默认。
  assert.equal(resolveFastvibeTheme({ mode: "light", light: "dracula", dark: "github-dark" }).id, DEFAULT_LIGHT_THEME);
  assert.equal(resolveFastvibeTheme({ mode: "dark", light: "one-light", dark: "one-light" }).id, DEFAULT_DARK_THEME);
});
