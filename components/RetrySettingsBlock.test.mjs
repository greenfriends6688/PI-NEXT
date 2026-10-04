// fork:upstream-0.9.3-retry-settings —— 数值框的「打字 → 可提交值」判定 + 画板契约
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
const { RetrySettingsBlock, numericInputToValue, retryRequestBody } = await jiti.import("./RetrySettingsBlock.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const source = await readFile(new URL("./RetrySettingsBlock.tsx", import.meta.url), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("a plain integer is taken as typed", () => {
  assert.equal(numericInputToValue("6", 3, 0, 20), 6);
  assert.equal(numericInputToValue(" 0 ", 3, 0, 20), 0);
  assert.equal(numericInputToValue("2000", 2000, 0, 60000), 2000);
});

test("empty / non-numeric input falls back to the value already on disk", () => {
  // 用户把输入框清空准备重打时不该发一个非法请求，提交的就是上一个有效值。
  assert.equal(numericInputToValue("", 3, 0, 20), 3);
  assert.equal(numericInputToValue("   ", 3, 0, 20), 3);
  assert.equal(numericInputToValue("abc", 3, 0, 20), 3);
  assert.equal(numericInputToValue("-", 3, 0, 20), 3);
});

test("exponent notation parses (type=number allows it) and then clamps", () => {
  assert.equal(numericInputToValue("1e3", 3, 0, 20), 20);
  assert.equal(numericInputToValue("1e1", 3, 0, 20), 10);
});

test("out-of-range values are clamped rather than rejected", () => {
  assert.equal(numericInputToValue("999", 3, 0, 20), 20);
  assert.equal(numericInputToValue("-4", 3, 0, 20), 0);
  assert.equal(numericInputToValue("999999", 2000, 0, 60000), 60000);
});

test("fractional input is rounded to the nearest integer", () => {
  assert.equal(numericInputToValue("4.4", 3, 0, 20), 4);
  assert.equal(numericInputToValue("4.6", 3, 0, 20), 5);
});

test("the PUT body carries cwd only when there is one", () => {
  assert.deepEqual(retryRequestBody({ maxRetries: 5 }, "/work"), { maxRetries: 5, cwd: "/work" });
  assert.deepEqual(retryRequestBody({ maxRetries: 5 }, null), { maxRetries: 5 });
});

test("the block is board DOM: .d-set-sec + .d-switch + .d-input.d-mono", () => {
  assert.match(code, /<PwBlock icon="refresh-cw"/, "块标题图标走画板注册的 refresh-cw");
  assert.match(code, /<PwSwitch/, "开关走画板的 .d-switch（SettingsUi 的 PwSwitch）");
  assert.match(code, /className="d-input d-mono"/, "数值框走画板的 .d-input + .d-mono");
  assert.match(code, /<PwCtl>/, "数值框放在画板的 .d-row 槽里");
  assert.match(code, /<PwField/, "三行都是画板的 .d-set-row");
});

test("判据⑦：.d-input / .d-switch / .d-set-row 都是 v5 画板已有的类", async () => {
  const boardCss = await readFile(
    new URL("../design/v5/web/system.css", import.meta.url),
    "utf8",
  );
  for (const name of ["d-input", "d-switch", "d-set-row", "d-set-sec"]) {
    assert.match(boardCss, new RegExp(`\\.${name}\\s*\\{`), `${name} 必须在 v5 system.css 里`);
  }
  for (const board of ["D-07-settings-general.html", "D-07b-settings-general-detail.html"]) {
    const html = await readFile(new URL(`../design/v5/web/boards/${board}`, import.meta.url), "utf8");
    assert.match(html, /d-set-row/, `${board} 应当画出设置行`);
    assert.match(html, /d-switch/, `${board} 应当画出开关`);
  }
});

test("零自有视觉类、零内联几何（宽度归 board.css 的 .pw-numin）", () => {
  assert.doesNotMatch(code, /<svg/, "图标一律走 <i data-ico>");
  for (const literal of [/style=\{\{/, /borderRadius/, /fontSize/, /boxShadow/, /"color:/]) {
    assert.doesNotMatch(code, literal, "组件里不该再出现自有视觉（视觉归 board.css）");
  }
});

test("首帧（读盘未回来）三个控件都是禁用的 —— 读不出来就不给写的机会", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(RetrySettingsBlock, { cwd: "/tmp" })),
  );
  // 画板 40 帧 1 那一块的三行都在，且在拿到真值之前不可点。
  assert.match(html, /d-input d-mono/, "两个窄数值框");
  assert.equal((html.match(/type="number"/g) ?? []).length, 2);
  assert.equal((html.match(/role="switch"/g) ?? []).length, 1);
  assert.equal((html.match(/disabled/g) ?? []).length, 3);
  // 默认值必须是 pi 的内建默认，不是我们编的数。
  assert.match(html, /value="3"/);
  assert.match(html, /value="2000"/);
});