import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

/* fork:fastvibe-stack (H4) —— 换成 jiti 加载（本仓的通行写法，见 model-scope.test.mjs）。
   原来这行是直接 `import "./theme.ts"`，那时 theme.ts 没有内部依赖；H4 之后它
   重导出 `./theme-selection`（那个模块自己又 import `./themes-fastvibe` 与 `./theme`）。
   Node 的原生解析在**不带扩展名的相对 import** 上会失败（而本仓全部 .ts 内部 import
   都是不带扩展名的 —— 那是 tsconfig 的 moduleResolution: bundler 要求的写法）。
   jiti 会按 TS 的解析规则处理，两边都成立。 */
async function loadTheme() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./theme.ts");
  } catch {
    return import("./theme.ts");
  }
}

const { THEME_INIT_SCRIPT, THEME_OPTIONS, isDarkTheme, isThemePreference } = await loadTheme();

test("first paint restores every palette and falls back to the system for invalid or blocked storage", () => {
  for (const systemDark of [false, true]) {
    for (const stored of [...THEME_OPTIONS.map(({ id }) => id), null, "", "unknown", new Error("Blocked")]) {
      const root = { dataset: {}, classList: { toggle: (name, value) => { root[name] = value; } } };
      runInNewContext(THEME_INIT_SCRIPT, {
        localStorage: { getItem: () => { if (stored instanceof Error) throw stored; return stored; } },
        window: { matchMedia: () => ({ matches: systemDark }) },
        document: { documentElement: root },
      });
      const expected = isThemePreference(stored) && stored !== "auto" ? stored : systemDark ? "dark" : "light";
      assert.equal(root.dataset.theme, expected);
      assert.equal(root.dark, isDarkTheme(expected));
    }
  }
});
