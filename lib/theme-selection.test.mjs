import assert from "node:assert/strict";
import test from "node:test";

async function load(name) {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import(name);
  } catch {
    return import(name);
  }
}

const sel = await load("./theme-selection.ts");
const themes = await load("./themes-fastvibe.ts");
const {
  resolveThemeId, resolveSelection, resolveActiveThemeId, isSelectionConsistent,
  DEFAULT_THEME_IDS, THEME_SELECTION_INIT_SCRIPT, THEME_LIGHT_KEY, THEME_DARK_KEY,
} = sel;

test("a stored id of the right kind is used as-is", () => {
  assert.equal(resolveThemeId("light", "one-light"), "one-light");
  assert.equal(resolveThemeId("dark", "dracula"), "dracula");
});

test("nothing stored falls back to the FastVibe defaults", () => {
  assert.equal(resolveThemeId("light", undefined), DEFAULT_THEME_IDS.light);
  assert.equal(resolveThemeId("dark", undefined), DEFAULT_THEME_IDS.dark);
  assert.equal(DEFAULT_THEME_IDS.light, "github-light");
  assert.equal(DEFAULT_THEME_IDS.dark, "github-dark");
});

test("a theme id from the wrong camp falls back (device-level misconfiguration)", () => {
  // 把暗色主题存进亮色槽（手改 localStorage / 旧版本数据）时不能照用 ——
  // 否则「亮色模式」会渲染出一套暗色主题。
  assert.equal(resolveThemeId("light", "dracula"), DEFAULT_THEME_IDS.light);
  assert.equal(resolveThemeId("dark", "one-light"), DEFAULT_THEME_IDS.dark);
});

test("garbage values fall back instead of throwing", () => {
  // 主题是外观，任何解析失败都不该让应用起不来。
  for (const bad of ["nope", "", "  ", 42, null, {}, [], true]) {
    assert.equal(resolveThemeId("light", bad), DEFAULT_THEME_IDS.light);
    assert.equal(resolveThemeId("dark", bad), DEFAULT_THEME_IDS.dark);
  }
});

test("resolveSelection always returns a consistent pair", () => {
  for (const stored of [{}, { light: "dracula", dark: "one-light" }, { light: "nord", dark: "nord" }]) {
    const out = resolveSelection(stored);
    assert.equal(themes.THEMES[out.light].kind, "light", JSON.stringify(stored));
    assert.equal(themes.THEMES[out.dark].kind, "dark", JSON.stringify(stored));
    assert.ok(isSelectionConsistent(out));
  }
});

test("mode picks the camp; auto follows prefersDark", () => {
  const selection = { light: "one-light", dark: "dracula" };
  assert.equal(resolveActiveThemeId("light", selection, true), "one-light");
  assert.equal(resolveActiveThemeId("dark", selection, false), "dracula");
  assert.equal(resolveActiveThemeId("auto", selection, true), "dracula");
  assert.equal(resolveActiveThemeId("auto", selection, false), "one-light");
});

test("changing the light theme does not affect what 'auto' resolves to in the dark", () => {
  // 这是拆两个键的**全部理由**：换亮色主题不该顺带改掉「跟随系统」。
  const before = { light: "github-light", dark: "dracula" };
  const after = { light: "one-light", dark: "dracula" };
  assert.equal(resolveActiveThemeId("auto", before, true), "dracula");
  assert.equal(resolveActiveThemeId("auto", after, true), "dracula");
});

test("the init script is self-contained and mentions both storage keys", () => {
  // 首帧前跑的内联脚本拿不到任何模块 —— 两个键名必须**字面量**出现在里面。
  const script = THEME_SELECTION_INIT_SCRIPT;
  assert.ok(script.includes(THEME_LIGHT_KEY), "must read the light key");
  assert.ok(script.includes(THEME_DARK_KEY), "must read the dark key");
  assert.ok(script.includes("pi-theme"), "must still honour the legacy mode key");
  assert.ok(script.includes("matchMedia"), "must resolve 'auto'");
  // `dataset.themeId = id` 在 DOM 上写的就是 `data-theme-id` 属性（camelCase → kebab）。
  // 这里断言脚本里那一下赋值，而不是字符串 `data-theme-id` —— 后者在脚本源码里
  // 根本不存在（它只存在于写出来的 DOM 上）。
  assert.match(script, /dataset\.themeId\s*=/, "must write the concrete theme id");
});

test("the init script cannot throw when storage is blocked", () => {
  // 它包在 try/catch 里 —— 隐私模式下 localStorage 访问会抛。
  assert.match(THEME_SELECTION_INIT_SCRIPT, /try\{/);
  assert.match(THEME_SELECTION_INIT_SCRIPT, /catch\(e\)\{\}/);
});

test("the init script parses as valid JavaScript", () => {
  // 它是字符串拼出来的 —— 拼错一个引号只会在浏览器里炸，单测抓不到。
  assert.doesNotThrow(() => new Function(THEME_SELECTION_INIT_SCRIPT));
});
