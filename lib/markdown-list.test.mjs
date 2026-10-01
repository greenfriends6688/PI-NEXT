import assert from "node:assert/strict";
import test from "node:test";

const { continueMarkdownList } = await import("./markdown-list.ts");

test("continues unordered list markers", () => {
  assert.deepEqual(continueMarkdownList("- item", 6, 6), { value: "- item\n- ", caret: 9 });
  assert.deepEqual(continueMarkdownList("* item", 6, 6), { value: "* item\n* ", caret: 9 });
  assert.deepEqual(continueMarkdownList("+ item", 6, 6), { value: "+ item\n+ ", caret: 9 });
});

test("continues ordered lists by incrementing the number", () => {
  assert.deepEqual(continueMarkdownList("1. item", 7, 7), { value: "1. item\n2. ", caret: 11 });
  assert.deepEqual(continueMarkdownList("3) item", 7, 7), { value: "3) item\n4) ", caret: 11 });
  assert.deepEqual(continueMarkdownList("9. item", 7, 7), { value: "9. item\n10. ", caret: 12 });
});

test("continues task checkboxes as unchecked", () => {
  assert.deepEqual(continueMarkdownList("- [ ] task", 10, 10), { value: "- [ ] task\n- [ ] ", caret: 17 });
  assert.deepEqual(continueMarkdownList("- [x] task", 10, 10), { value: "- [x] task\n- [ ] ", caret: 17 });
});

test("continues blockquotes, nested and combined prefixes", () => {
  assert.deepEqual(continueMarkdownList("> line", 6, 6), { value: "> line\n> ", caret: 9 });
  assert.deepEqual(continueMarkdownList(">> line", 7, 7), { value: ">> line\n>> ", caret: 11 });
  assert.deepEqual(continueMarkdownList("  - item", 8, 8), { value: "  - item\n  - ", caret: 13 });
  assert.deepEqual(continueMarkdownList("> - [ ] item", 13, 13), { value: "> - [ ] item\n> - [ ] ", caret: 22 });
});

test("an empty item ends the structure by removing the marker", () => {
  assert.deepEqual(continueMarkdownList("- ", 2, 2), { value: "", caret: 0 });
  assert.deepEqual(continueMarkdownList("> item\n> ", 9, 9), { value: "> item\n", caret: 7 });
  assert.deepEqual(continueMarkdownList("1. ", 3, 3), { value: "", caret: 0 });
  assert.deepEqual(continueMarkdownList("- [ ] ", 6, 6), { value: "", caret: 0 });
  assert.deepEqual(continueMarkdownList("  - ", 4, 4), { value: "", caret: 0 });
});

test("handles a caret in the middle of the line and selections", () => {
  assert.deepEqual(continueMarkdownList("- item more", 4, 4), { value: "- it\n- em more", caret: 7 });
  // 先替换选区再续行（选中 "te" 得到 "- im"，仍是非空项）；
  // 若选中的是整个条目内容则变成空项，于是结束列表。
  assert.deepEqual(continueMarkdownList("- item", 3, 5), { value: "- i\n- m", caret: 6 });
  assert.deepEqual(continueMarkdownList("- item", 2, 5), { value: "m", caret: 0 });
});

test("returns null for lines without a structural prefix", () => {
  assert.equal(continueMarkdownList("plain text", 10, 10), null);
  assert.equal(continueMarkdownList("# heading", 9, 9), null);
  assert.equal(continueMarkdownList("", 0, 0), null);
  assert.equal(continueMarkdownList("```", 3, 3), null);
  assert.equal(continueMarkdownList("  ", 2, 2), null);
  assert.equal(continueMarkdownList("-", 1, 1), null); // 没有尾随空格的标记不算列表
});

// fork:markdown-continuation（G10 · 上游 `fd037e4` #884）—— 移植上游
// lib/markdown-list-continuation.ts 的解析能力：thematic break / 代码围栏 /
// 中文顿号编号 / 标记宽度、间距与缩进原样保留。

test("a thematic break is not a list, whatever spacing it uses", () => {
  for (const line of ["---", "***", "___", "- - -", "* * *", "  ---  "]) {
    assert.equal(continueMarkdownList(line, line.length, line.length), null, line);
  }
  // 单个标记后跟内容仍然是列表。
  assert.deepEqual(continueMarkdownList("- - item", 8, 8), { value: "- - item\n- ", caret: 11 });
});

test("no continuation inside a fenced code block", () => {
  const fenced = "```\n- item";
  assert.equal(continueMarkdownList(fenced, fenced.length, fenced.length), null);
  // 波浪号围栏同理；未闭合的围栏一路吃到下一个同类围栏。
  const tilde = "~~~\n1. item";
  assert.equal(continueMarkdownList(tilde, tilde.length, tilde.length), null);
  const closed = "```\n- item\n```\n- item";
  assert.deepEqual(continueMarkdownList(closed, closed.length, closed.length), {
    value: "```\n- item\n```\n- item\n- ",
    caret: closed.length + 3,
  });
  // 围栏之前的普通文本不受影响。
  assert.deepEqual(continueMarkdownList("intro\n- item", 12, 12), { value: "intro\n- item\n- ", caret: 15 });
});

test("numbers written the Chinese way with 、 continue in Chinese", () => {
  assert.deepEqual(continueMarkdownList("1、年", 3, 3), { value: "1、年\n2、", caret: 6 });
  assert.deepEqual(continueMarkdownList("9、年", 3, 3), { value: "9、年\n10、", caret: 7 });
  // 空项结束列表。
  assert.deepEqual(continueMarkdownList("1、", 2, 2), { value: "", caret: 0 });
  // 四位数的「2020、2021年」不是列表（位数限制挡掉）。
  assert.equal(continueMarkdownList("2020、2021年", 11, 11), null);
});

test("keeps the marker's own width, spacing and indentation", () => {
  assert.deepEqual(continueMarkdownList("-   item", 8, 8), { value: "-   item\n-   ", caret: 13 });
  assert.deepEqual(continueMarkdownList("  *  item", 9, 9), { value: "  *  item\n  *  ", caret: 15 });
  // 序号补零：`01.` 之后是 `02.`，不是 `2.`。
  assert.deepEqual(continueMarkdownList("01. item", 8, 8), { value: "01. item\n02. ", caret: 13 });
  assert.deepEqual(continueMarkdownList(">   1) item", 11, 11), { value: ">   1) item\n>   2) ", caret: 19 });
  // 顿号编号可以带空格，空格宽度照原样带过去。
  assert.deepEqual(continueMarkdownList("3、 项目", 5, 5), { value: "3、 项目\n4、 ", caret: 9 });
});
