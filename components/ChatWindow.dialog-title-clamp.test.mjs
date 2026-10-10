import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:extension-dialog-title（上游 #961 `46b5235`，Refs #890）——
// 扩展请求对话框的长标题：过长时**收缩**，不把选项和「取消」挤出对话框；
// `lib/dialog-title.ts` 的 `splitDialogTitle` 给 head 的换行一个都不吞。
//
// 三层断言：
//   1. 源码守卫 —— 头部挂上两个 fork-* 钩子，标题仍带 pre-wrap。
//   2. CSS 守卫 —— app/fork-ui.css 里那两条规则真的是「可解的限高 + 省略号钳位」。
//   3. 纯函数级 —— 把 **CSS 里实际声明的** 限高与行数喂给下面的模型，算出
//      40 行标题下头部的占用与选项/取消是否还在框内。

const windowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/fork-ui.css", import.meta.url), "utf8");
const dialogSource = windowSource.slice(windowSource.indexOf("function ExtensionDialog"));
const head = dialogSource.slice(
  dialogSource.indexOf('className="d-modal-head d-row fork-ext-dialog-head"'),
  dialogSource.indexOf("{request.expiresAt !== undefined && <ExtensionCountdownBar"),
);

function ruleFor(selector) {
  const start = cssSource.indexOf(`\n${selector} {`);
  assert.ok(start > -1, `${selector} exists in app/fork-ui.css`);
  return cssSource.slice(start, cssSource.indexOf("}", start));
}

test("the extension dialog head carries the clamp hooks and keeps pre-wrap", () => {
  assert.match(head, /className="d-modal-head d-row fork-ext-dialog-head"/);
  assert.match(head, /className="d-grow d-t-b fork-ext-dialog-title"/);
  // 换行不能被吞：标题仍然 pre-wrap（不是 nowrap，也不是靠 CSS 补的）。
  assert.match(head, /whiteSpace: "pre-wrap"/);
  assert.doesNotMatch(head, /whiteSpace: "nowrap"/);
  // 完整标题另有出口，钳位不会让人看不到全文。
  assert.match(head, /title=\{titleHead\}/);
  assert.match(dialogSource, /aria-label=\{title\}/);
  // head / rest 的切分仍然只由 splitDialogTitle 决定（fork:ext-i18n-keys 后传的是译好的 title）。
  assert.match(windowSource, /const \{ head: titleHead, rest: titleRest \} = splitDialogTitle\(title\)/);
});

test("the head cap resolves against the viewport and the title clamps with an ellipsis", () => {
  const headRule = ruleFor(".fork-ext-dialog-head");
  assert.match(headRule, /flex-shrink: 1/);
  assert.match(headRule, /min-height: 0/);
  // 百分比上限在「内容驱动高度」的对话框里解不出来（上游 #890），必须是视口单位。
  assert.match(headRule, /max-height: 50vh/);
  assert.doesNotMatch(headRule, /max-height: 50%/);
  assert.match(headRule, /overflow-y: auto/);

  const titleRule = ruleFor(".fork-ext-dialog-title");
  assert.match(titleRule, /display: -webkit-box/);
  assert.match(titleRule, /-webkit-box-orient: vertical/);
  assert.match(titleRule, /-webkit-line-clamp: \d+/);
  assert.match(titleRule, /overflow: hidden/);
  // 钩子不许改视觉规格里的字重/字号/颜色，也不许把 pre-wrap 顶掉。
  assert.doesNotMatch(titleRule, /white-space/);
  assert.doesNotMatch(titleRule, /font-|\bcolor\b/);
});

/**
 * `-webkit-line-clamp: N` + `max-height: Kvh` 在一个「高度由内容驱动」的 flex 对话框
 * 里的可执行模型：纯函数，把 CSS 声明的两个数当输入。
 */
export function dialogHeadLayout({
  viewportHeight,
  clampLines,
  headMaxHeightVh,
  lineHeight,
  subRowHeight,
  otherRows,
}) {
  const clampCap = clampLines * lineHeight + subRowHeight;
  const viewportCap = (headMaxHeightVh / 100) * viewportHeight;
  const headHeight = Math.min(clampCap, viewportCap);
  const rest = otherRows - headHeight;
  return { headHeight, viewportCap, restHeight: rest, optionsVisible: rest > 0 };
}

test("40 dialog lines still leave the option list and the cancel button inside the box", () => {
  const headRule = ruleFor(".fork-ext-dialog-head");
  const titleRule = ruleFor(".fork-ext-dialog-title");
  const headMaxHeightVh = Number(/max-height: (\d+)vh/.exec(headRule)[1]);
  const clampLines = Number(/-webkit-line-clamp: (\d+)/.exec(titleRule)[1]);

  // 上游 #890 的同一组数字：40 行标题、762px 对话框。
  const budget = dialogHeadLayout({
    viewportHeight: 762,
    clampLines,
    headMaxHeightVh,
    lineHeight: 22, // TEXT.lg × 1.4
    subRowHeight: 20, // 「扩展请求」副行 + 头部内距
    otherRows: 600, // 对话框里除头部以外的全部（选项 + 页脚）
  });

  assert.ok(clampLines >= 2, "标题至少留两行才读得清扩展在干什么");
  assert.ok(budget.headHeight <= budget.viewportCap);
  assert.ok(
    budget.headHeight < 600,
    `头部不得吃掉整框（实测 ${budget.headHeight}px）`,
  );
  assert.equal(budget.optionsVisible, true);
});

test("a short title is untouched: the clamp keeps its lines and swallows no newline", () => {
  const titleRule = ruleFor(".fork-ext-dialog-title");
  const clampLines = Number(/-webkit-line-clamp: (\d+)/.exec(titleRule)[1]);
  // pre-wrap 盒子里的换行各自占一行，line-clamp 按**渲染行**数钳位，所以
  // `splitDialogTitle` 的 head 里几行就还是几行（不折成一行、也不吞掉换行）。
  const head = "Approve tool call\nmodel: gpt-5\nargs: {\"a\": 1}";
  const renderedLines = head.split("\n");
  assert.equal(renderedLines.length, 3);
  assert.ok(renderedLines.length <= clampLines);
  // 超出钳位时截在第 N 行并加省略号，完整文本走 title / aria-label。
  const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
  const shown = long.split("\n").slice(0, clampLines);
  assert.equal(shown.length, clampLines);
  assert.equal(shown.join("\n"), "line 0\nline 1\nline 2");
  assert.notEqual(shown.join("\n"), long);
});