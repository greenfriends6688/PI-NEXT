// fork:pr12-a6-thinking-budget —— 数值框的提交判定 + 画板契约
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  ThinkingBudgetSettingsBlock,
  thinkingBudgetRequestBody,
} = await jiti.import("./ThinkingBudgetSettingsBlock.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { THINKING_BUDGET_MAX_TOKENS } = await jiti.import("@/lib/thinking-budget-settings-shared");
const { numericInputToValue } = await jiti.import("./RetrySettingsBlock.tsx");

const source = await readFile(new URL("./ThinkingBudgetSettingsBlock.tsx", import.meta.url), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("数值框复用重试策略那一份判定（不发明第二套夹取逻辑）", () => {
  assert.match(code, /numericInputToValue/);
  assert.equal(numericInputToValue("", 8192, 1, THINKING_BUDGET_MAX_TOKENS), 8192);
  assert.equal(numericInputToValue("-5", 8192, 1, THINKING_BUDGET_MAX_TOKENS), 1);
  assert.equal(numericInputToValue("40960", 16384, 1, THINKING_BUDGET_MAX_TOKENS), 40960);
});

test("PUT body 只带要改的那一档 —— 这一段没有 SDK 写入路径，也不需要 cwd", () => {
  assert.deepEqual(thinkingBudgetRequestBody({ high: 32768 }), { high: 32768 });
  assert.deepEqual(thinkingBudgetRequestBody({}), {});
});

test("the block is board DOM: .pw-block + .pw-hint + .pw-field + .pw-ctl > .pw-input.pw-numin", () => {
  assert.match(code, /<PwBlock icon="brain"/, "块标题图标走画板注册的 brain");
  assert.match(code, /<p className="pw-hint">/, "块级说明用画板的 .pw-hint（画板 41 已有先例）");
  assert.match(code, /className="pw-input pw-numin"/, "数值框走 .pw-input + 画板 44 收编来的 .pw-numin");
  assert.match(code, /<PwCtl>/, "数值框放在画板的 .pw-ctl 槽里");
  assert.match(code, /<PwField/, "四档各是一条画板的 .pw-field");
  assert.match(code, /THINKING_BUDGET_LEVELS\.map/, "四档由常量表驱动，不手写四遍");
});

test("四档标签走 i18n，不在组件里写死中英文", () => {
  assert.match(code, /LEVEL_LABEL_KEYS/);
  for (const key of ["Minimal", "Low", "Medium", "High"]) {
    assert.match(code, new RegExp(`"settings\\.thinkingBudget${key}"`));
  }
});

test("判据⑦：这一块没有引入任何新的 .pw-* 类（board.css 不动）", async () => {
  const boardCss = await readFile(
    new URL("../design/pi-web-design/assets/board.css", import.meta.url),
    "utf8",
  );
  const classes = [...new Set([...code.matchAll(/pw-[a-z0-9-]+/g)].map((match) => match[0]))];
  assert.ok(classes.length > 0, "组件里应当确实用到了一些 pw-* 类");
  for (const name of classes) {
    assert.match(boardCss, new RegExp(`\\.${name}[\\s,{:.]`), `${name} 必须在 board.css 里已经存在`);
  }
  for (const board of ["40-settings-general.html", "62-settings-layout.html"]) {
    const html = await readFile(new URL(`../design/pi-web-design/${board}`, import.meta.url), "utf8");
    assert.match(html, /思考档 token 预算/, `${board} 应当画出这一块`);
    assert.match(html, /pw-hint/, `${board} 应当画出块级说明`);
  }
});

test("零自有视觉类、零内联几何", () => {
  assert.doesNotMatch(code, /<svg/, "图标一律走 <i data-ico>");
  for (const literal of [/style=\{\{/, /borderRadius/, /fontSize/, /boxShadow/, /"color:/]) {
    assert.doesNotMatch(code, literal, "组件里不该再出现自有视觉（视觉归 board.css）");
  }
});

test("首帧四个框都是禁用的，且填的是 pi-ai 的内建默认", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(ThinkingBudgetSettingsBlock, null)),
  );
  assert.equal((html.match(/type="number"/g) ?? []).length, 4);
  assert.equal((html.match(/disabled/g) ?? []).length, 4);
  for (const value of ["1024", "2048", "8192", "16384"]) {
    assert.match(html, new RegExp(`value="${value}"`), `默认值 ${value} 必须是 pi-ai 的内建默认`);
  }
  // 下限是 1：预算 0 等于「这一档不思考」，那是关掉思考的开关该管的事。
  assert.match(html, /min="1"/);
});
