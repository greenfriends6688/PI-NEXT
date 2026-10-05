import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

/*
 * fork:perf-viewer-diff-pages — `limitDiffSegments` 是「与 HEAD 对比」那份 DOM 的
 * 上限：一个正在被大改的文件几乎每一行都在 diff 里（3 行上下文窗口等于没折叠），
 * 实测 `+1148-101` 的一份就是 1412 行 / +6.4k 个节点，而它们是在**编辑器挂载的同一次
 * commit** 里建的 —— 用户看到的「加载中…」就是被这段卡住的。
 *
 * 这里锁三件事：
 *   1. 折叠好的差异（没超过上限）**一个片段都不动**（占位行也照旧）；
 *   2. 超上限时按行切，切口之后的片段全丢，`remaining` 数的是**还没画出来的行**；
 *   3. 隐藏占位行不占行数，但切口之后的占位行不再出现（它们属于没人要的区间）。
 */

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { limitDiffSegments, shareInFlightRequest } = await jiti.import("./FileViewer.tsx");

const line = (text, type = "added", lineNo = 1) => ({ type, text, oldLineNo: null, newLineNo: lineNo });
const lines = (count, prefix = "l") =>
  Array.from({ length: count }, (_, index) => line(`${prefix}${index}`));

test("没超过上限时原样返回（占位行也留着）", () => {
  const segments = [
    { hidden: true, count: 40 },
    { hidden: false, lines: lines(10) },
    { hidden: true, count: 12 },
  ];
  const { items, remaining } = limitDiffSegments(segments, 400);
  assert.equal(remaining, 0);
  assert.deepEqual(items, segments);
});

test("超过上限时按行切，并数清还剩多少行", () => {
  const segments = [{ hidden: false, lines: lines(1250) }];
  const { items, remaining } = limitDiffSegments(segments, 400);
  assert.equal(remaining, 850);
  assert.equal(items.length, 1);
  assert.equal(items[0].hidden, false);
  assert.equal(items[0].lines.length, 400);
  // 切出来的是**开头**那 400 行（差异按文件顺序读）。
  assert.equal(items[0].lines[0].text, "l0");
  assert.equal(items[0].lines[399].text, "l399");
});

test("切口跨片段：前面的片段原样，后面的丢掉", () => {
  const segments = [
    { hidden: true, count: 30 },
    { hidden: false, lines: lines(250, "a") },
    { hidden: true, count: 20 },
    { hidden: false, lines: lines(250, "b") },
  ];
  const { items, remaining } = limitDiffSegments(segments, 300);
  // 前面的折叠占位 + 第一个整片段（250 行）+ 切口前的第二个占位
  assert.deepEqual(items.map((seg) => (seg.hidden ? `h${seg.count}` : seg.lines.length)), ["h30", 250, "h20", 50]);
  assert.equal(remaining, 200);
});

test("切口之后的折叠占位不再出现（否则「加载更多」上面悬着一段没头没尾的省略行）", () => {
  const segments = [
    { hidden: false, lines: lines(500, "a") },
    { hidden: true, count: 99 },
    { hidden: false, lines: lines(500, "b") },
  ];
  const { items, remaining } = limitDiffSegments(segments, 400);
  assert.equal(items.length, 1);
  assert.equal(items[0].lines.length, 400);
  assert.equal(remaining, 600, "第一个片段切剩下的 100 行 + 后面整个 500 行；隐藏占位不占行数");
});

test("上限 0 / 空输入都不炸", () => {
  assert.deepEqual(limitDiffSegments([], 400), { items: [], remaining: 0 });
  const zero = limitDiffSegments([{ hidden: false, lines: lines(3) }], 0);
  assert.equal(zero.items[0].lines.length, 0);
  assert.equal(zero.remaining, 3);
});

/* ── fork:viewer-dedupe-request ───────────────────────────────────────────── */

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test("同一个 key 的第二条调用共用第一条的 promise（只打一次接口）", async () => {
  const store = new Map();
  let runs = 0;
  const gate = deferred();
  const run = () => { runs += 1; return gate.promise; };
  const first = shareInFlightRequest(store, "a", run);
  const second = shareInFlightRequest(store, "a", run);
  assert.equal(runs, 1);
  assert.equal(first, second, "共用者拿到的就是同一个 promise");
  gate.resolve("done");
  assert.equal(await first, "done");
  assert.equal(await second, "done");
});

test("不同 key 各跑各的", async () => {
  const store = new Map();
  let runs = 0;
  const run = async () => { runs += 1; return runs; };
  assert.equal(await shareInFlightRequest(store, "a", run), 1);
  assert.equal(await shareInFlightRequest(store, "b", run), 2);
  assert.equal(runs, 2);
});

test("共用者**不能**作废 owner 的 requestId（曾经真的坏过：diff 永远停在加载中）", async () => {
  const store = new Map();
  let latest = 0;
  const delivered = [];
  const gate = deferred();
  // owner：自增 id 后请求，回来时必须仍然认得自己是最新
  const owner = shareInFlightRequest(store, "k", async () => {
    const requestId = ++latest;
    const value = await gate.promise;
    if (requestId === latest) delivered.push(value);
    return value;
  });
  // 共用者：在 owner 还在途时进来 —— 如果它也自增 id，owner 的 guard 就会失配
  const joiner = shareInFlightRequest(store, "k", async () => {
    ++latest;
    return "join-should-not-run";
  });
  gate.resolve("patch");
  await Promise.all([owner, joiner]);
  assert.deepEqual(delivered, ["patch"], "owner 的结果必须落到 state 上");
});

test("settle 之后槽位清掉，下一次是真的新请求（watch 的变更事件要能刷新）", async () => {
  const store = new Map();
  let runs = 0;
  const run = async () => { runs += 1; return runs; };
  await shareInFlightRequest(store, "a", run);
  await shareInFlightRequest(store, "a", run);
  assert.equal(runs, 2);
  assert.equal(store.size, 0);
});

test("owner 失败也要把槽位清掉（不能把后来的请求永久卡在共用上）", async () => {
  const store = new Map();
  await assert.rejects(
    shareInFlightRequest(store, "a", async () => { throw new Error("boom"); }),
    /boom/,
  );
  assert.equal(store.size, 0);
});