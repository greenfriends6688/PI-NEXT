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
  assert.ok(html.indexOf("New task") < html.indexOf("Plan document"));
});

test("页签行右端有语法说明钮，浮层常驻 DOM 并用 hidden 开关（D-22 帧 A/B/C）", () => {
  const html = render();
  // 页签行：四个 .d-cat 之后是 d-grow + 一颗 .d-iconbtn（keyboard）。
  assert.match(html, /class="d-iconbtn"[^>]*aria-expanded="false"[\s\S]*?<i data-ico="keyboard"/);
  // 浮层挂在 .d-cmd-input 之后（板面上它是 .d-cmd-input 的兄弟），且默认 hidden。
  assert.match(html, /<div class="d-pop" hidden[\s\S]*?class="d-pop-title"/);
  assert.match(html, /class="d-pop-body d-col"/);
  assert.match(html, /class="d-sep"/);
  assert.match(html, /class="d-pop-foot"/);
});

test("输入中：命中片段走 .d-cmd-hit，不给整行打底色", () => {
  const html = render({ commands: [{ id: "x", label: "Plan document", icon: "file-text", group: "run", run: () => {} }] });
  // 组件里的查询词由输入框 state 驱动；SSR 阶段它是空的，所以这里直接核源里的那条路存在。
  assert.match(html, /class="d-cmd-group"/);
  assert.match(source, /className="d-cmd-hit"/, "命中片段必须用 .d-cmd-hit");
  assert.doesNotMatch(source, /className="d-cmd-row is-hit"/, "不给整行打底色");
});

test("空态：没命中也带下一步（.d-empty-s 里的三个前缀）", () => {
  // fork:v5-frame-audit D-22 帧 C —— 板面那一段是「一整段话 + 三个行内 .d-kbd」，
  // 不是三行列表；照板面改形状后，约束也跟着改成新的等价约束：
  //   ① `.d-empty-s` 里正好三颗 `.d-kbd`（> # @），话用既有 palette.scope.*；
  //   ② 空态里那颗按钮打开的是**页签行同一枚**语法浮层（真能点开）；
  //   ③ 板面第二颗「看搜索中的样子」是演示重播件（骨架由真实 searching 态驱动），
  //      产品里不许有假的重播开关 —— 源码里不许出现 `.d-empty-s` 之后的第二颗钮。
  assert.match(source, /className="d-empty-s"/);
  assert.equal((source.match(/className="d-kbd"/g) ?? []).length >= 3, true);
  assert.match(source, /\{t\("palette\.scope\.commands"\)\} <span className="d-kbd">&gt;<\/span>/);
  assert.match(source, /onClick=\{\(\) => setSyntaxOpen\(true\)\}/);
  const emptyBlock = source.slice(source.indexOf('className="d-empty"'), source.indexOf('className="d-empty"') + 1400);
  assert.equal((emptyBlock.match(/className="d-btn sm"/g) ?? []).length, 1, "空态里只留「打开语法浮层」一颗真按钮");
});

test("搜索中给骨架（帧 C），不再只给一行文字状态", () => {
  assert.match(source, /className="d-skel-list"/);
  assert.match(source, /className="d-skel d-skel-40"/);
  assert.match(source, /d-think-dots wave/);
});

test("空查询时多请求一次会话清单（既有 API，summary 口径）", () => {
  assert.match(source, /\/api\/sessions\?summary=1/);
});