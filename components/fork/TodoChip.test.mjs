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
const { TodoChip } = await jiti.import("./TodoChip.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const source = await readFile(new URL("./TodoChip.tsx", import.meta.url), "utf8");

function render(summary) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(TodoChip, { summary })),
  );
}

test("a session with no list yet renders nothing", () => {
  assert.equal(render({ todos: [], done: 0, total: 0 }), "");
});

test("the chip reports progress and names the item in flight", () => {
  const html = render({
    todos: [
      { id: 1, text: "read the spec", done: true },
      { id: 2, text: "write the code", done: false },
    ],
    done: 1,
    total: 2,
  });

  assert.match(html, />1\/2</);
  // Naming the open item is what makes the chip read as live progress rather
  // than a counter that only ever moves at the end of a run.
  assert.match(html, /title="[^"]*write the code"/);
});

test("a finished list stops advertising an item in flight", () => {
  const html = render({
    todos: [{ id: 1, text: "done thing", done: true }],
    done: 1,
    total: 1,
  });

  assert.match(html, />1\/1</);
  assert.doesNotMatch(html, /title="[^"]*done thing"/);
});

test("the panel keeps its live-progress affordances", () => {
  assert.match(source, /role="progressbar"/);
  assert.match(source, /t\("chat\.todosActive"\)/);
});

test("the panel takes its type and metrics from the board, never from inline literals", () => {
  // fork:design-components —— 字号/控件高改由 board.css 的 `.pw-plan*` / `.pw-card-head` /
  // `.pw-card-foot` 承担，组件里不再引 TEXT / CONTROL，也不再有内联 px 字号。
  assert.doesNotMatch(source, /import \{ TEXT \} from "@\/lib\/typography"/);
  assert.doesNotMatch(source, /import \{ CONTROL \} from "@\/lib\/control-size"/);
  assert.doesNotMatch(source, /fontSize: [0-9]/, "inline px font sizes must come from the board");
  assert.match(source, /className="pw-plan fork-todo-panel"/);
  assert.match(source, /className="pw-plan-head"/);
  assert.match(source, /className="pw-card-foot"/);
  // 勾选标记走画板图标，不是手绘 polyline。
  assert.match(source, /<i data-ico="check" data-size="10"><\/i>/);
  assert.doesNotMatch(source, /<svg/);
});
