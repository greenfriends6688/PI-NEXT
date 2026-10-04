// fork:v5-boards D-22 —— 命令中心的三处补齐：分组标题 / 命中片段加重 / 搜索中骨架 + 空态的下一步。
//
// 三条纪律：DOM 只用画板已有的 `.d-cmd-group` `.d-cmd-hit` `.d-empty-s` `.d-skel-list`，
// 图标一律 `<i data-ico>`，切分命中片段是纯函数（可逐字覆盖）。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { CommandPalette, splitPaletteHighlight } = await jiti.import("./CommandPalette.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const source = await readFile(new URL("./CommandPalette.tsx", import.meta.url), "utf8");

const COMMANDS = [
  { id: "new", label: "New task", hint: "⌘N", icon: "square-pen", group: "run", run: () => {} },
  { id: "plan", label: "Plan document", icon: "file-text", group: "run", run: () => {} },
];

function render(props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(CommandPalette, {
        open: true,
        onClose: () => {},
        cwd: "/repo",
        commands: COMMANDS,
        onOpenSession: () => {},
        ...props,
      }),
    ),
  );
}

test("命中切分：只标出匹配的那几个字，一行多处命中切成多段", () => {
  assert.deepEqual(splitPaletteHighlight("design/v5/base.css", "base"), [
    { text: "design/v5/", hit: false },
    { text: "base", hit: true },
    { text: ".css", hit: false },
  ]);
  assert.deepEqual(splitPaletteHighlight("base of base", "base"), [
    { text: "base", hit: true },
    { text: " of ", hit: false },
    { text: "base", hit: true },
  ]);
  // 大小写不敏感，但切出来的是原文。
  assert.deepEqual(splitPaletteHighlight("Base.css", "base"), [
    { text: "Base", hit: true },
    { text: ".css", hit: false },
  ]);
  // 空查询 / 查不到 = 整行一段，不加重（不做无意义的碎片化）。
  assert.deepEqual(splitPaletteHighlight("Plan", ""), [{ text: "Plan", hit: false }]);
  assert.deepEqual(splitPaletteHighlight("Plan", "zzz"), [{ text: "Plan", hit: false }]);
});

test("默认态（空查询）：三个域各自成组，标题是画板 D-22 帧 A 的 .d-cmd-group", () => {
  const html = render();
  assert.match(html, /class="d-cmd-group"/);
  // 命令组标题带命中数（板上是「命令 · 18 条」，产品用语言无关的「· N」）。
  assert.match(html, />Commands · 2</);
  // 空查询时命令排在前面（板上的「快捷入口在前」）。
  assert.ok(html.indexOf("New task") < html.indexOf("Plan document"));
});

test("输入中：命中片段走 .d-cmd-hit，不给整行打底色", () => {
  const html = render({ commands: [{ id: "x", label: "Plan document", icon: "file-text", group: "run", run: () => {} }] });
  // 组件里的查询词由输入框 state 驱动；SSR 阶段它是空的，所以这里直接核源里的那条路存在。
  assert.match(html, /class="d-cmd-group"/);
  assert.match(source, /className="d-cmd-hit"/, "命中片段必须用 .d-cmd-hit");
  assert.doesNotMatch(source, /className="d-cmd-row is-hit"/, "不给整行打底色");
});

test("空态：没命中也带下一步（.d-empty-s 里的三个前缀）", () => {
  // 让命令列表为空且查询词有值 —— 这里靠「命令域被前缀锁死 + 无命中」构造不了，
  // 所以直接核源里那一段：`.d-empty-s` + 前缀键符 + 既有 palette.scope.* 文案。
  assert.match(source, /className="d-empty-s d-col"/);
  assert.match(source, /palette\.scope\.\$\{entry\.scope\}/);
  // 空态里不塞演示钮（画板那两枚按钮是家具，不是产品件）。
  assert.doesNotMatch(source, /className="d-empty-s d-col"[\s\S]{0,400}d-btn/);
});

test("搜索中给骨架（帧 C），不再只给一行文字状态", () => {
  assert.match(source, /className="d-skel-list"/);
  assert.match(source, /className="d-skel d-skel-40"/);
  assert.match(source, /d-think-dots wave/);
});

test("空查询时多请求一次会话清单（既有 API，summary 口径）", () => {
  assert.match(source, /\/api\/sessions\?summary=1/);
});