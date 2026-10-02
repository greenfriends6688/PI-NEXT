/**
 * fork:proma-35-retry —— 消息流重试提示的渲染测试。
 *
 * 只验证「画」的部分：文案与数字、tabular-nums、错误摘要、以及**不新增画板类**
 * （布局钩子只允许 fork-retry-notices）。事件映射 / 降噪 / run 隔离在
 * `lib/retry-policy.test.mjs`。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { RetryNotice } = await jiti.import("./RetryNotice.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const componentSource = await readFile(new URL("./RetryNotice.tsx", import.meta.url), "utf8");

const notice = (overrides = {}) => ({
  runId: 7,
  runStartedAt: 1_700_000_000_000,
  attempt: 8,
  maxRetries: 12,
  phase: "scheduled",
  scheduledAt: 1,
  ...overrides,
});

function render(notices) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(RetryNotice, { notices })),
  );
}

test("空列表不渲染任何东西", () => {
  assert.equal(render([]), "");
});

test("scheduled 一行给出「第 N/M 次」并带旋转图标", () => {
  const html = render([notice()]);
  assert.match(html, /class="fork-retry-notices"/);
  assert.match(html, /class="pw-toast warn"/);
  assert.match(html, /8\/12/);
  assert.match(html, /data-ico="refresh-cw"/);
  assert.match(html, /pw-anim-spin/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
});

test("数字用 tabular-nums，避免第 3 次到第 10 次宽度跳动", () => {
  const html = render([notice()]);
  assert.match(html, /font-variant-numeric:tabular-nums/);
});

test("终态换图标与语气档，并显示错误摘要", () => {
  const exhausted = render([notice({ phase: "exhausted", errorMessage: "429 too many requests" })]);
  assert.match(exhausted, /class="pw-toast bad"/);
  assert.match(exhausted, /data-ico="triangle-alert"/);
  assert.match(exhausted, /429 too many requests/);
  assert.ok(!exhausted.includes("pw-anim-spin"));

  assert.match(render([notice({ phase: "succeeded" })]), /class="pw-toast ok"/);
  assert.match(render([notice({ phase: "succeeded" })]), /data-ico="circle-check"/);
  assert.match(render([notice({ phase: "cancelled" })]), /data-ico="ban"/);
});

test("多条按 attempt 顺序各占一行", () => {
  const html = render([notice({ attempt: 6 }), notice({ attempt: 7 })]);
  assert.equal(html.match(/class="pw-toast warn"/g).length, 2);
  assert.match(html, /6\/12/);
  assert.match(html, /7\/12/);
});

test("source: 不新增画板类，样式只写 fork-ui.css", () => {
  const classes = [...componentSource.matchAll(/className="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
  for (const name of classes) {
    assert.match(name, /^(pw-|fork-retry-notices)/, `unexpected class ${name}`);
  }
  // 终态继承 scheduled 的 maxRetries，组件仍给 0 兜底。
  assert.match(componentSource, /notice\.maxRetries > 0 \? notice\.maxRetries : notice\.attempt/);
});
