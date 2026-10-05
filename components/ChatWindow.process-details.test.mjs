import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("expands process details when a completed turn has no final answer", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  assert.match(
    source,
    /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{!finalAnswerMessage\}/,
  );
});

// fork:turn-head-order —— 身份行（logo + 产品名 + 模型）必须是那一轮的**第一块**，
// 过程折叠卡在它下面。此前过程组是回答消息的前一个兄弟节点，logo 被顶到了卡下面。
const view = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");

test("the process group rides inside the answer message, after the identity row", () => {
  // 过程组不再 push 进 rendered，而是当 `prefix` 挂给最终回答。
  assert.match(source, /prefix: processGroupNode,/);
  assert.doesNotMatch(source, /rendered\.push\(\s*<div\s*\n\s*key=\{`process-group-/);
  // MessageView 把 prefix 渲染在 `.d-msg-ai-head` 之后、正文之前（只认 JSX：那一行
  // 自己的 6 空格缩进 + `className="d-msg-ai-head"`，注释里也有这个类名）。
  const head = view.indexOf("\n      {prefix}\n");
  assert.ok(head > 0, "MessageView must render a standalone {prefix} line");
  assert.ok(
    head > view.indexOf('className="d-msg-ai-head"'),
    "prefix must come after the identity row",
  );
  assert.ok(head < view.indexOf("{blockItems.map("), "prefix must come before the body blocks");
});
