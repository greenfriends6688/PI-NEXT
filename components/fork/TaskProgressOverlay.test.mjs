/**
 * fork:proma-31-task-progress —— 浮层的结构断言测试。
 *
 * 这里只有 `react-dom/server`（与 `components/fork/RetryNotice.test.mjs` 同一套），
 * 没有 DOM 与计时器，所以**行为断言走源码**：浮层的倒计时与卸载都在 effect 里，
 * 真正被钉住的是「判据来自纯函数」这件事 —— 只要源码里那几行还在，行为就在；
 * 纯函数本身的行为由 lib/task-progress.test.mjs 逐条覆盖。
 */
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
const { FINISH_RETENTION_MS, FADE_OUT_DURATION_MS, TaskProgressOverlay } = await jiti.import("./TaskProgressOverlay.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const source = await readFile(new URL("./TaskProgressOverlay.tsx", import.meta.url), "utf8");
// 图标名拼错不会报错、只会渲染出一个空格子（`scripts/check-icons.mjs` 的原话）。
// 而它只认 `data-ico="字面量"`，认不出 `data-ico={icon}` 这种变量形式 —— 这里补上那一层。
const iconsSource = await readFile(
  new URL("../../design/pi-web-design/assets/icons.js", import.meta.url),
  "utf8",
);
const knownIcons = new Set(
  [...iconsSource.slice(iconsSource.indexOf("var PATHS = {")).matchAll(/^\s*"([a-z0-9-]+)":/gm)].map((m) => m[1]),
);

const SUMMARY = {
  todos: [
    { id: 1, text: "read the spec", done: true },
    { id: 2, text: "write the code", done: false },
    { id: 3, text: "run the tests", done: false },
  ],
  done: 1,
  total: 3,
};

function render(summary) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(TaskProgressOverlay, { summary, streaming: true })),
  );
}

test("没有任务时不渲染任何东西", () => {
  assert.equal(render({ todos: [], done: 0, total: 0 }), "");
});

test("可见性只由 effect 置起：渲染期自己拿不到签名，所以首帧是空的", () => {
  // 签名要经过一次 effect 才落到 state（它决定「这是不是一份新清单」），
  // 于是首帧必然返回 null —— 这条把「渲染期不自己造壳」钉死：
  // 一旦有人日后为了首屏可见而在 render 里直接置 visible，空壳就会先闪一帧。
  assert.equal(render(SUMMARY), "");
  assert.match(source, /if \(!hasDisplayTasks \|\| !mounted\) return null;/);
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*?setVisible\(true\);/);
});

test("浮层的类型、度量与图标全部取自画板，不自己造", () => {
  assert.match(source, /className=\{`pw-toast fork-task-progress\$\{tone === "active" \? "" : ` \$\{tone\}`\}`\}/);
  assert.match(source, /className="pw-badge count"/);
  assert.match(source, /className="pw-grow"/);
  assert.match(source, /className=\{`pw-progress\$\{railTone\}`\}/);
  // 图标一律 lucide 的 data-ico 占位（components/PwIcons.tsx 水合），无 emoji / 手绘 SVG。
  assert.doesNotMatch(source, /<svg/);
  assert.match(source, /<i data-ico=\{icon\} data-size="14"/);
  // 「正在做」与「只是列了计划」要差得开：旋转是画板 N 那一档持续类。
  assert.match(source, /className=\{spinning \? "pw-anim-spin" : undefined\}/);
});

test("四个图标名都在 lucide 路径表里（补上 check-icons 认不出的那层）", () => {
  for (const name of [
    // 浮层标题
    "circle-alert", "triangle-alert", "loader-circle", "circle-check", "list-checks",
    // 展开面板与条目（check-icons 只认字面量，认不出 data-ico={row.boxIcon}）
    "chevron-down", "check", "play", "copy",
  ]) {
    assert.ok(source.includes(`"${name}"`), `组件里用到 ${name}`);
    assert.ok(knownIcons.has(name), `icons.js 未登记 ${name}`);
  }
});

test("浮层是唯一的待办入口：可点展开，面板里能复制", () => {
  // 2026-10-02 用户裁定 —— 合并 PR-31 时浮层与 composer 里的 TodoChip 同时渲染同一
  // 份 extractTodoState，清单在屏幕上出现两遍。芯片已删，入口只留这一个。
  // 所以浮层必须**自己**可点（而不是退回成纯展示件）。
  assert.match(source, /className={`pw-toast fork-task-progress/);
  assert.match(source, /onClick=\{\(\) => setOpen\(\(value\) => !value\)\}/);
  assert.match(source, /aria-expanded=\{open\}/);
  // 可点件要自己收回指针：宿主那条定位带是 pointer-events:none。
  assert.match(source, /pointerEvents: "auto"/);
  // 面板只在一份清单存在时渲染。
  assert.match(source, /\{open && \(/);
  // 面板与条目全部用画板类，不自己造。
  for (const cls of ["pw-plan", "pw-plan-head", "pw-btn sm", "pw-todo", "pw-card-foot", "fork-todo-list"]) {
    assert.ok(source.includes(cls), `面板要用画板的 ${cls}`);
  }
  // 复制是三态：复制**可能失败**，失败必须看得见（芯片时代的既有教训，搬过来了）。
  assert.match(source, /type CopyState = "idle" \| "copied" \| "failed"/);
  assert.match(source, /copyFailed && \(/);
  assert.match(source, /className=\{copyFailed \? "pw-btn sm danger" : "pw-btn sm"\}/);
  // 外点 / Esc 关面板。
  assert.match(source, /document\.addEventListener\("mousedown"/);
  assert.match(source, /event\.key === "Escape"/);
});

test("面板开着时不淡出：用户主动展开就是要读它", () => {
  // 倒计时分支里 `if (open) return;` 必须在装定时器**之前** —— 否则用户点开清单
  // 正好碰上 run 结束，4 秒后它会自己消失。
  assert.match(source, /if \(open\) return;\n\s*\/\/ run 结束/);
  // open 要进依赖数组，否则开关面板不会重算倒计时。
  assert.match(source, /\[hasDisplayTasks, displaySignature, streaming, open\]/);
  // 浮层收起时把面板一并收掉，免得下一轮带着旧展开态回来。
  assert.match(source, /useEffect\(\(\) => \{\n\s*if \(!visible\) setOpen\(false\);\n\s*\}, \[visible\]\);/);
});

test("倒计时只在 run 结束（streaming=false）时装，且依赖来自纯函数", () => {
  assert.match(source, /shouldRetainTaskProgress\(streaming, hasDisplayTasks\)/);
  // streaming 时那条分支只「钉住」，不装定时器。
  assert.match(source, /if \(!shouldRetainTaskProgress[\s\S]*?return;\n\s*\}/);
  assert.match(source, new RegExp(`FINISH_RETENTION_MS - FADE_OUT_DURATION_MS`));
  assert.equal(FINISH_RETENTION_MS, 4000);
  assert.equal(FADE_OUT_DURATION_MS, 200);
  // 卸载走全站那一个折叠原语，而不是自己写 setTimeout(() => null)。
  assert.match(source, /useCollapsePresence\(visible, FADE_OUT_DURATION_MS, collapseRef\)/);
  assert.match(source, /className="fork-collapse"/);
});

test("进度轨带 progressbar 语义与填充比例", () => {
  assert.match(source, /role="progressbar"/);
  assert.match(source, /aria-valuemax=\{total\}/);
  assert.match(source, /aria-valuenow=\{done\}/);
  assert.match(source, /transform: `scaleX\(\$\{taskProgressRatio\(progress\)\}\)`/);
});

test("内联样式里不写死几何，状态全走 token / 纯函数", () => {
  // 判据与 scripts/check-style-literals.mjs 的 `inline-geometry-literal` 一致：
  // 键名 + 单值数字（0、`var()`、`calc()`、百分比放行）。
  const GEOMETRY = /\b(padding|margin|gap|width|height|minWidth|maxWidth|minHeight|maxHeight|top|bottom|left|right)\s*:\s*"?\s*(\d+(?:\.\d+)?)(px|pt)?\s*"?\s*(?=[,}\n])/g;
  const offenders = [...source.matchAll(GEOMETRY)]
    .filter((match) => Number(match[2]) !== 0)
    .map((match) => match[0]);
  assert.deepEqual(offenders, [], `内联几何字面量：${offenders.join(", ")}`);
  assert.doesNotMatch(source, /borderRadius:\s*\d/);
  assert.doesNotMatch(source, /fontSize:\s*\d/);
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/);
});