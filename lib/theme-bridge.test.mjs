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

const themes = await load("./themes-fastvibe.ts");
const bridge = await load("./theme-bridge.ts");
const { fastvibeTokenVars, bridgedVariableNames } = bridge;
const { THEMES, LIGHT_THEME_IDS, DARK_THEME_IDS } = themes;

test("every theme yields the same set of local variables", () => {
  // 少一个的后果是「某套装上后某个元素没颜色」—— 只有切到那套才看得见。
  const reference = Object.keys(fastvibeTokenVars(THEMES[LIGHT_THEME_IDS[0]])).sort();
  for (const id of [...LIGHT_THEME_IDS, ...DARK_THEME_IDS]) {
    assert.deepEqual(Object.keys(fastvibeTokenVars(THEMES[id])).sort(), reference, `${id} differs`);
  }
});

test("THE collision fix: `--accent` must be the brand colour, not FastVibe's grey fill", () => {
  // FastVibe 的 `--accent` = seed.muted（一个填充色，github-dark 下是 #21262d）。
  // 本仓 `--accent` 是品牌色。原样灌进去会让整个界面的强调色变成深灰 ——
  // 不报错、单测也过，只是「看起来不对」。这条锁死那道防护。
  for (const id of [...LIGHT_THEME_IDS, ...DARK_THEME_IDS]) {
    const theme = THEMES[id];
    const vars = fastvibeTokenVars(theme);
    assert.equal(vars["--accent"], theme.tokens.primary, `${id}: --accent must be the brand colour`);
    assert.notEqual(vars["--accent"], theme.tokens.accent, `${id}: --accent must NOT be FastVibe's accent(=muted)`);
  }
});

test("the canvas / text / border bindings land on the right tokens", () => {
  const theme = THEMES["github-dark"];
  const vars = fastvibeTokenVars(theme);
  assert.equal(vars["--bg"], theme.tokens.background);
  assert.equal(vars["--text"], theme.tokens.foreground);
  assert.equal(vars["--border"], theme.tokens.border);
  assert.equal(vars["--text-muted"], theme.tokens["muted-foreground"]);
});

test("no value is ever an empty string", () => {
  // 空串会把变量定义成空值 —— CSS 里是未定义行为（回落继承或透明），且不报错。
  for (const id of [...LIGHT_THEME_IDS, ...DARK_THEME_IDS]) {
    for (const [name, value] of Object.entries(fastvibeTokenVars(THEMES[id]))) {
      assert.ok(typeof value === "string" && value.length > 0, `${id} ${name} is empty`);
    }
  }
});

test("derived slots are computed with color-mix, not hardcoded hex", () => {
  // 写死的话每加一套主题都要补一行；而且这类槽位的语义本来就是相对的。
  const vars = fastvibeTokenVars(THEMES["github-dark"]);
  for (const name of ["--text-dim", "--border-deep", "--border-faint", "--accent-border",
    "--danger-soft", "--success-soft", "--warning-soft", "--overlay-hover"]) {
    assert.match(vars[name], /color-mix\(/, `${name} should be derived`);
  }
});

test("the shadcn token names are passed through unchanged", () => {
  // `components/ui/` 的 35 个件写 Tailwind 工具类，最终解析到这几个名字；
  // 它们必须与 FastVibe 的同名 token 一致，否则新旧两套组件不同色。
  const theme = THEMES["one-dark-pro"];
  const vars = fastvibeTokenVars(theme);
  for (const name of ["background", "foreground", "card", "popover", "primary", "secondary",
    "muted", "muted-foreground", "destructive", "border", "input", "ring",
    "chart-1", "chart-5", "code-bg"]) {
    assert.equal(vars[`--${name}`], theme.tokens[name], `--${name} passthrough`);
  }
});

test("bridged names are all CSS custom properties", () => {
  for (const name of bridgedVariableNames()) assert.match(name, /^--[a-z0-9-]+$/);
});

test("the bridge never emits a variable the repo does not consume", () => {
  // 覆盖数固定（94）—— 增删映射时这条会变，提醒去核对是不是又挂了没人读的行内样式。
  assert.equal(Object.keys(fastvibeTokenVars(THEMES["github-light"])).length, 94);
});
