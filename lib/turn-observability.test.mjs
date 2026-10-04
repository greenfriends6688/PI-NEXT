import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const G = await jiti.import("./turn-observability.ts");

const logIn = (dir) => join(dir, "turns.jsonl");

test("a row round-trips", () => {
  const line = G.serializeTurnObservation({
    sessionId: "s1",
    entryId: "m3",
    startedAt: 1000,
    endedAt: 4500,
    input: 17000,
    output: 161,
    cost: 0.42,
    toolCalls: 7,
    stopped: false,
  });
  const row = G.parseTurnLogLine(line);
  assert.equal(row.sessionId, "s1");
  assert.equal(row.entryId, "m3");
  assert.equal(row.endedAt - row.startedAt, 3500);
  assert.equal(row.toolCalls, 7);
  assert.equal(row.v, G.TURN_LOG_VERSION);
});

// 没有 sessionId 就无法归属 —— 与其写一堆孤儿行，不如不写。
test("an observation without a session id is refused", () => {
  for (const bad of [{ sessionId: "" }, { sessionId: "   " }, {}]) {
    assert.equal(G.serializeTurnObservation(bad), null);
  }
  assert.equal(G.appendTurnObservation("/tmp/never-written.jsonl", { sessionId: "" }), false);
});

// 观测对象可能带着 UI 状态之类不该落盘的东西 —— 所以逐字段挑，不 spread。
test("unknown fields on the observation never reach the disk", () => {
  const line = G.serializeTurnObservation({
    sessionId: "s1",
    input: 1,
    // 这两个不该出现：组件 state / React key。
    componentState: { draft: "别把我写进去" },
    _reactKey: "x",
  });
  assert.ok(!line.includes("别把我写进去"));
  assert.ok(!line.includes("_reactKey"));
});

// 一行 JSON 必须是**一行**：带换行的话会把 JSONL 撕成两半，下半截永远解析失败。
test("a row is always exactly one line", () => {
  const line = G.serializeTurnObservation({ sessionId: "s1", entryId: "带\n换行\n的 id" });
  assert.ok(line !== null);
  assert.equal(line.split("\n").length, 1, "序列化结果不能含换行");
  // 换行被 JSON 转义掉了，读回来仍是原值。
  assert.equal(G.parseTurnLogLine(line).entryId, "带\n换行\n的 id");
});

test("a pathological row is dropped rather than truncating mid-JSON", () => {
  const line = G.serializeTurnObservation({ sessionId: "s1", entryId: "x".repeat(9000) });
  assert.equal(line, null, "超长行宁可不记，也不要写出一个解析不了的半截");
});

test("NaN / Infinity are dropped — they poison every later aggregation", () => {
  const line = G.serializeTurnObservation({ sessionId: "s1", input: NaN, cost: Infinity });
  const row = G.parseTurnLogLine(line);
  assert.equal(row.input, undefined);
  assert.equal(row.cost, undefined);
  assert.equal(row.sessionId, "s1", "同一条里坏掉的字段被丢掉，其余照记");
});

test("one bad line does not make the whole log unreadable", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-turns-"));
  const path = logIn(dir);
  G.appendTurnObservation(path, { sessionId: "s1", startedAt: 1, input: 10 });
  // 手插一行坏数据（截断的 JSON、纯文本、空行、版本不对）。
  writeFileSync(path, `${readFileSync(path, "utf8")}{坏掉的\n纯文本\n\n{"v":99,"sessionId":"s1"}\n`, "utf8");
  G.appendTurnObservation(path, { sessionId: "s1", startedAt: 2, input: 20 });

  const rows = G.readTurnObservations(path, "s1");
  assert.equal(rows.length, 2, "坏行被跳过，好行仍然读得到");
  assert.deepEqual(rows.map((r) => r.input), [10, 20]);
});

test("reads are scoped to one session and sorted by time", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-turns-"));
  const path = logIn(dir);
  // 故意乱序写入。
  G.appendTurnObservation(path, { sessionId: "s1", startedAt: 300, input: 3 });
  G.appendTurnObservation(path, { sessionId: "s2", startedAt: 100, input: 99 });
  G.appendTurnObservation(path, { sessionId: "s1", startedAt: 100, input: 1 });
  G.appendTurnObservation(path, { sessionId: "s1", startedAt: 200, input: 2 });

  const rows = G.readTurnObservations(path, "s1");
  assert.deepEqual(rows.map((r) => r.input), [1, 2, 3], "时间升序，且不含 s2");
});

test("a missing log reads as empty rather than throwing", () => {
  const missing = join(mkdtempSync(join(tmpdir(), "pi-turns-")), "nope", "turns.jsonl");
  assert.deepEqual(G.readTurnObservations(missing, "s1"), []);
});

test("the read window keeps the most recent rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-turns-"));
  const path = logIn(dir);
  for (let i = 0; i < 10; i += 1) {
    G.appendTurnObservation(path, { sessionId: "s1", startedAt: i, input: i });
  }
  assert.deepEqual(G.readTurnObservations(path, "s1", 3).map((r) => r.input), [7, 8, 9]);
  // limit<=0 = 不限。
  assert.equal(G.readTurnObservations(path, "s1", 0).length, 10);
});

// 观测是**旁路**：写失败绝不能让一轮对话失败。
test("an unwritable path is a silent no-op", () => {
  // 父路径是一个文件，不是目录 ⇒ mkdir 必然失败。
  const dir = mkdtempSync(join(tmpdir(), "pi-turns-"));
  const blocker = join(dir, "blocker");
  writeFileSync(blocker, "not a directory", "utf8");
  assert.equal(G.appendTurnObservation(join(blocker, "turns.jsonl"), { sessionId: "s1" }), false);
});

test("version mismatch is refused, not guessed at", () => {
  assert.equal(G.parseTurnLogLine('{"v":2,"sessionId":"s1"}'), null);
  assert.equal(G.parseTurnLogLine('{"v":1}'), null, "缺 sessionId");
  assert.equal(G.parseTurnLogLine("null"), null);
  assert.equal(G.parseTurnLogLine("   "), null);
});