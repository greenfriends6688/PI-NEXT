// fork:pr12-a5-context-budget —— 覆盖框的「打字 → 可提交值」判定 + 画板契约
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
  ContextBudgetSettingsBlock,
  contextBudgetRequestBody,
  overrideInputToValue,
  pruneOverride,
} = await jiti.import("./ContextBudgetSettingsBlock.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { CONTEXT_BUDGET_MAX_TOKENS } = await jiti.import("@/lib/context-budget-settings-shared");

const source = await readFile(new URL("./ContextBudgetSettingsBlock.tsx", import.meta.url), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("an empty box means “no override for this field” (it falls back to the global value)", () => {
  // 覆盖条目本来就可以只有一半字段，所以空串不是「非法输入」，而是一个真意思：
  // 这个字段不覆盖。返回 undefined 就是让服务端把那个键删掉。
  assert.equal(overrideInputToValue("", 8000, 0, CONTEXT_BUDGET_MAX_TOKENS), undefined);
  assert.equal(overrideInputToValue("   ", undefined, 0, CONTEXT_BUDGET_MAX_TOKENS), undefined);
});

test("a plain integer is taken as typed, and junk falls back to what is on disk", () => {
  assert.equal(overrideInputToValue("60000", undefined, 0, CONTEXT_BUDGET_MAX_TOKENS), 60000);
  assert.equal(overrideInputToValue(" 12000 ", undefined, 0, CONTEXT_BUDGET_MAX_TOKENS), 12000);
  assert.equal(overrideInputToValue("abc", 8000, 0, CONTEXT_BUDGET_MAX_TOKENS), 8000);
  // 还没落盘的行（stored 是空的）里打错的东西回落到 0，而不是 undefined —— 否则
  // 「清空」与「打错」在第一次按键时是同一个意思。
  assert.equal(overrideInputToValue("-", undefined, 0, CONTEXT_BUDGET_MAX_TOKENS), 0);
});

test("out-of-range input is clamped to what the server would accept", () => {
  assert.equal(overrideInputToValue("99999999", undefined, 0, CONTEXT_BUDGET_MAX_TOKENS), CONTEXT_BUDGET_MAX_TOKENS);
  assert.equal(overrideInputToValue("-4", undefined, 0, CONTEXT_BUDGET_MAX_TOKENS), 0);
  assert.equal(overrideInputToValue("4.6", undefined, 0, CONTEXT_BUDGET_MAX_TOKENS), 5);
});

test("an override entry with both fields cleared prunes to null so the row disappears", () => {
  assert.equal(pruneOverride({ reserveTokens: undefined, keepRecentTokens: undefined }), null);
  assert.equal(pruneOverride({}), null);
  assert.deepEqual(pruneOverride({ reserveTokens: 60000, keepRecentTokens: undefined }), {
    reserveTokens: 60000,
  });
  assert.deepEqual(pruneOverride({ reserveTokens: 1, keepRecentTokens: 2 }), {
    reserveTokens: 1,
    keepRecentTokens: 2,
  });
});

test("the PUT body carries cwd only when there is one", () => {
  assert.deepEqual(contextBudgetRequestBody({ reserveTokens: 5 }, "/work"), { reserveTokens: 5, cwd: "/work" });
  assert.deepEqual(contextBudgetRequestBody({ reserveTokens: 5 }, null), { reserveTokens: 5 });
});

test("the block is board DOM: .pw-block + .pw-switch + .pw-ctl > .pw-input.pw-numin", () => {
  assert.match(code, /<PwBlock icon="scan-text"/, "块标题图标走画板注册的 scan-text");
  assert.match(code, /<PwSwitch/, "开关走画板的 .pw-switch（SettingsUi 的 PwSwitch）");
  assert.match(code, /className="pw-input pw-numin"/, "数值框走 .pw-input + 画板 44 收编来的 .pw-numin");
  assert.match(code, /<PwCtl>/, "数值框放在画板的 .pw-ctl 槽里");
  assert.match(code, /<PwField/, "每一行都是画板的 .pw-field");
  assert.match(code, /<PwSelectBox/, "新增模型覆盖走 .pw-selectbox（值是一串要背下来的标识）");
  assert.match(code, /className="pw-iconbtn sm"/, "移除一枚覆盖走画板的 .pw-iconbtn.sm");
});

test("判据⑦：这一块没有引入任何新的 .pw-* 类（board.css 不动）", async () => {
  // 把组件里出现的每一个 pw- 串都拿去 board.css 里找，必须全部命中。
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
    assert.match(html, /pw-input pw-numin/, `${board} 应当画出这块的窄数值框`);
    assert.match(html, /pw-iconbtn/, `${board} 应当画出模型覆盖行的移除钮`);
  }
});

test("零自有视觉类、零内联几何", () => {
  assert.doesNotMatch(code, /<svg/, "图标一律走 <i data-ico>");
  for (const literal of [/style=\{\{/, /borderRadius/, /fontSize/, /boxShadow/, /"color:/]) {
    assert.doesNotMatch(code, literal, "组件里不该再出现自有视觉（视觉归 board.css）");
  }
});

test("首帧（读盘未回来）全部控件禁用 —— 读不出来就不给写的机会", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(ContextBudgetSettingsBlock, { cwd: "/tmp" })),
  );
  // 开关 + 三个全局数值框 + 新增下拉，没有覆盖行（数据未回来）。
  assert.equal((html.match(/type="number"/g) ?? []).length, 3);
  assert.equal((html.match(/role="switch"/g) ?? []).length, 1);
  assert.equal((html.match(/<select/g) ?? []).length, 1);
  assert.match(html, /disabled/, "读盘回来之前控件是禁用的");
  // 默认值必须是 pi 的内建默认，不是我们编的数。
  assert.match(html, /value="16384"/);
  assert.match(html, /value="20000"/);
});

test("覆盖行的两个框各自带 title/aria-label —— 两个 90px 的框光看形状分不出谁是谁", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(ContextBudgetSettingsBlock, { cwd: null })),
  );
  assert.doesNotMatch(html, /aria-label="[^"]*summary reserve[^"]*"/, "没有覆盖行时不该出现该 aria-label");
  assert.match(code, /title=\{`\$\{modelRef\} · \$\{fieldLabel\}`\}/);
  assert.match(code, /aria-label=\{`\$\{modelRef\} \$\{fieldLabel\}`\}/);
});
