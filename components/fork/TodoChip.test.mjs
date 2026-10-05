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
  // fork:v5-landing —— DOM 抄自画板 D-03e 帧 C：字号/控件高由 system.css 的
  // `.d-card` / `.d-tool-head` / `.d-bar` / `.d-pop*` 承担，组件里不再引 TEXT / CONTROL。
  assert.doesNotMatch(source, /import \{ TEXT \} from "@\/lib\/typography"/);
  assert.doesNotMatch(source, /import \{ CONTROL \} from "@\/lib\/control-size"/);
  assert.doesNotMatch(source, /fontSize: [0-9]/, "inline px font sizes must come from the board");
  assert.match(source, /className="d-pop is-open fork-todo-panel"/);
  assert.match(source, /className="d-pop-title"/);
  assert.match(source, /className="d-pop-foot"/);
  // fork:v5-boards D-27 帧 F / D-28 帧 C —— 勾选标记走 `.d-check-draw` 描边：
  // 这是本组件唯一允许的手写 SVG（图标库不给 pathLength，data-ico 的 path 会按像素
  // 算 dash），断言新的等价约束——数量恰好一条、带 pathLength="1"。
  assert.match(source, /className="d-check-draw"/);
  assert.equal((source.match(/<svg/g) ?? []).length, 1, "手写 SVG 只允许对勾这一条");
  assert.match(source, /<path pathLength="1" d="M20 6 9 17l-5-5" \/>/);
  assert.doesNotMatch(source, /<i data-ico="check" data-size="10">/);
});

test("a done row draws its check through .d-check-draw, not the icon sprite", () => {
  // 展开面板要点开才渲染（SSR 拿不到交互），所以这条钉在「完成分支」的源码上：
  // 对勾只挂在 `todo.done ?` 的分支里，未完成行拿不到这一笔。
  const doneBranch = source.slice(source.indexOf("todo.done ? ("), source.indexOf(") : active ? ("));
  assert.match(doneBranch, /className="d-checkbox on"/);
  assert.match(doneBranch, /className="d-check-draw"/);
  assert.match(doneBranch, /pathLength="1"/);
  assert.match(doneBranch, /d="M20 6 9 17l-5-5"/);
});
