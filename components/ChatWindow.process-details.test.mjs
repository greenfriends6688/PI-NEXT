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

// fork:turn-head-first（用户 2026-10-05）—— 「PI NEXT 最后才出现」：本轮还没有正文时
// （工具在跑的那几分钟）宿主不挂 MessageView，只挂过程卡，于是身份行要等第一条正文到
// 才画出来。现在那一条分支自己先画一份。
test("the identity row is on screen before the turn has any answer text", () => {
  /* fork:no-head-flicker（2026-10-06 用户实拍「一会儿有一会儿没有，还会闪现」）——
     这条约束的**意图不变**（本轮还没有正文时身份行也必须在屏上），但实现换了：
     原来是一个 `answerBlocks.length === 0` 的提前返回，自己拿
     `<div key="turn-head-live">` + `TurnIdentityHead` 画一份；正文一到就改走
     `<MessageView>`（它自己再画一份）。两支**元素类型不同**、key 也不同，React
     不会原地复用 —— 旧节点拆掉、新节点重建，那枚 `<img>` 重新解码、`.m-msg-ai`
     重排，于是每切一次就闪一次。
     现在两支合一：**始终**走 `<MessageView>`，`answerBlocks` 为空时正文那半自然是
     空的，身份行照旧由它画；`prefix={groupNode}` 保证过程组仍挂在身份行之后
     （`MessageView` 对 `prefix` 有豁免：挂了它就绝不返回 null，所以「没正文」那一
     段时间不会被整块吞掉）。等价约束因此是这三条： */
  // ① 流式那一支里**不再有**提前返回 —— 元素类型恒定，React 才能原地复用。
  assert.doesNotMatch(
    source,
    /if \(streamingProcess\.answerBlocks\.length === 0\) \{/,
    "流式分支不许再有提前返回：那会让身份行在两个不同元素之间搬家，每次切正文都闪一下",
  );
  assert.doesNotMatch(source, /key="turn-head-live"/);
  // ② 过程组仍以 `prefix` 挂进同一条消息（身份行在最上面、过程组紧随其后）。
  assert.match(source, /prefix=\{groupNode\}/);
  // ③ 身份行只画一份：MessageView 复用组件，不再内联第二份 DOM。
  assert.equal((view.match(/className="d-msg-ai-head"/g) ?? []).length, 1);
  // 被中断 / 只有工具的那一支（没有回答可挂 prefix）同样有身份行。
  assert.match(
    source,
    /else if \(processGroupNode\) \{[\s\S]*?<TurnIdentityHead[\s\S]*?\{processGroupNode\}/,
  );
  assert.match(source, /import \{ MessageView, TurnIdentityHead, formatDuration \}/);
});

// fork:digest-weight —— 摘要首格不再套 <b>（用户要常规字重）。
test("the process digest renders every segment at the head's own weight", () => {
  assert.doesNotMatch(source, /part\.lead/);
  assert.doesNotMatch(source, /<b>\{part\.text\}<\/b>/);
});

// fork:rail-one —— 时间轴只能有**一条**竖线：`.d-step::before` 与展开正文的
// `.process-step-body-wrap::before` 必须同位同色，且正文缩进与步骤行文案左缘对齐。
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("the expanded step body continues the one timeline rail", () => {
  const wrapRule = globals.match(/\.process-step-body-wrap::before \{([^}]*)\}/)?.[1] ?? "";
  assert.match(wrapRule, /left:\s*10px/, "body rail must sit on the step rail (left: 10px)");
  assert.match(wrapRule, /background:\s*var\(--nx-line\)/, "body rail must use the step rail colour");
  assert.doesNotMatch(wrapRule, /border-left/, "no second, differently coloured line");
  // 27 = 2 (行左内缩) + 17 (图标) + 8 (gap)：与 `.d-step` 的文案左缘同一条竖线。
  assert.match(
    globals.match(/\.process-step-body-wrap \{([^}]*)\}/)?.[1] ?? "",
    /padding-left:\s*27px/,
  );
});
