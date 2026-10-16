import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { patchTraceHtml, tracePatchPatterns } from "../src/main/engine/export-html-patch.ts";

/**
 * The trace page's robustness patch, and the SDK text it depends on.
 *
 * The patch is string substitution against a template that lives in `node_modules`, which
 * makes it exactly the kind of thing that rots without anyone noticing: the walk keeps
 * working on a short chat and silently stops working on a long one. So the first test here
 * reads the installed `template.js` and holds all three patterns against it — a reworded
 * function fails in this run, before it fails on somebody's 5000-message conversation.
 */

const TEMPLATE = join(
  process.cwd(),
  "node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/template.js",
);

test("SDK 模板里三个递归函数仍是我们所要的样子", () => {
  const template = readFileSync(TEMPLATE, "utf8");
  for (const { name, search } of tracePatchPatterns()) {
    const occurrences = template.split(search).length - 1;
    assert.equal(occurrences, 1, `${name} 在模板里出现 ${occurrences} 次，预期 1 次 —— SDK 改过这段了`);
  }
});

test("补丁把三个递归都换成迭代，且顺序语义不变", () => {
  const patterns = tracePatchPatterns();
  // A page holding exactly what the template inlines, plus a marker so a stray edit is visible.
  const page = `<script>\n${patterns.map((item) => item.search).join("\n")}\n</script>`;

  const { html, missed } = patchTraceHtml(page);
  assert.deepEqual(missed, []);
  assert.notEqual(html, page);

  for (const { name } of patterns) {
    assert.ok(!html.includes(`forEach(${name})`), `${name} 仍在递归调用自己`);
    assert.ok(!html.includes(`if (${name}(child))`), `${name} 仍在递归调用自己`);
    assert.ok(html.includes(`function ${name}(root)`) || name === "mapNodes", `${name} 应改为接受根节点`);
  }
  // The lazy map is built by the walk itself, so `treeNodeMap` must still be filled.
  assert.ok(html.includes("treeNodeMap.set(node.entry.id, node)"));
  // And the active path still has to be settled children-first.
  assert.ok(html.includes("containsActive.get(child)"));
});

test("有一个模式对不上时，整份文档原样返回，而不是打一半补丁", () => {
  const patterns = tracePatchPatterns();
  const page = `<script>\n${patterns.slice(0, 2).map((item) => item.search).join("\n")}\n</script>`;

  const { html, missed } = patchTraceHtml(page);
  // Half a patch would leave a page that is neither the old document nor the new one.
  assert.equal(html, page);
  assert.equal(missed.length, 1);
  assert.match(missed[0]!, /markActive/);
});

test("CRLF 的导出页也能匹配上", () => {
  const patterns = tracePatchPatterns();
  const lf = patterns.map((item) => item.search).join("\n");
  const { missed } = patchTraceHtml(`<script>\r\n${lf.replace(/\n/g, "\r\n")}\r\n</script>`);
  assert.deepEqual(missed, [], "从 Windows 导出的页应当一样能补");
});

test("已经补过的页面再补一次是空操作", () => {
  const patterns = tracePatchPatterns();
  const first = patchTraceHtml(`<script>\n${patterns.map((item) => item.search).join("\n")}\n</script>`);
  const second = patchTraceHtml(first.html);
  // Not an error: the patterns are simply absent because the work is already done.
  assert.equal(second.html, first.html);
  assert.equal(second.missed.length, 3);
});
