import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { computeTurnStats } = await createJiti(import.meta.url).import("./turn-stats.ts");

const usage = (input, output, cacheRead, cost, cacheWrite = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
});

const user = (timestamp) => ({ role: "user", content: "hi", timestamp });
const assistant = (timestamp, completedAt, u) => ({
  role: "assistant",
  content: [],
  model: "m",
  provider: "p",
  stopReason: "toolUse",
  timestamp,
  completedAt,
  usage: u,
});

test("one turn accumulates every assistant step and times the whole task", () => {
  // 真数据形状：用户 0s 发出 → 助手 1 在 2.0s 落盘（6.2s 生成）→ 工具 → 助手 2 在 20s 落盘。
  const messages = [
    user(0),
    assistant(2000, 8200, usage(17_564, 161, 175, 0)),
    { role: "toolResult", toolCallId: "t1", content: [], timestamp: 9000 },
    assistant(10_000, 20_400, usage(2_000, 900, 0, 0.01)),
  ];
  const stats = computeTurnStats(messages);
  // 回合结束行挂在每一条助手消息上；中间那条显示的是**当时**的累计值。
  assert.equal(stats.get(1).steps, 1);
  assert.equal(stats.get(1).elapsedSec, 8.2);
  assert.equal(stats.get(1).input, 17_564);
  const last = stats.get(3);
  assert.equal(last.steps, 2);
  assert.equal(last.input, 19_564, "两轮的输入累加");
  assert.equal(last.output, 1_061);
  assert.equal(last.cost, 0.01, "费用按本轮累加");
  // 耗时 = 本轮起点（用户消息）到最后一条的完成时刻，含工具执行。
  assert.equal(last.startTs, 0);
  assert.equal(last.endTs, 20_400);
  assert.equal(last.elapsedSec, 20.4);
});

test("a user message starts a new turn", () => {
  const stats = computeTurnStats([
    user(0),
    assistant(1000, 5000, usage(10, 5, 0, 0)),
    user(6000),
    assistant(6100, 9000, usage(7, 3, 0, 0)),
  ]);
  assert.equal(stats.get(3).steps, 1, "新一轮不继承上一轮的累加");
  assert.equal(stats.get(3).input, 7);
  assert.equal(stats.get(3).elapsedSec, 3, "从新的用户消息算起");
});

test("missing timestamps degrade to null instead of a fake number", () => {
  const stats = computeTurnStats([
    { role: "user", content: "hi" },
    { role: "assistant", content: [], model: "m", provider: "p", usage: usage(3, 2, 0, 0) },
  ]);
  const only = stats.get(1);
  assert.equal(only.elapsedSec, null);
  assert.equal(only.output, 2, "用量不依赖时间戳");
});

test("a turn that starts with an assistant message uses its own timestamp", () => {
  const stats = computeTurnStats([
    assistant(1000, 4000, usage(1, 1, 0, 0)),
    assistant(5000, 9000, usage(1, 1, 0, 0)),
  ]);
  assert.equal(stats.get(0).startTs, 1000);
  assert.equal(stats.get(0).elapsedSec, 3, "1000 → 4000");
  assert.equal(stats.get(0).steps, 1);
  // 没有用户消息时同一串助手消息仍算一轮：第二条看到的是累计 1000 → 9000。
  assert.equal(stats.get(1).steps, 2);
  assert.equal(stats.get(1).elapsedSec, 8);
});

test("a free model sums to 0 — the row then draws no amount cell", () => {
  const stats = computeTurnStats([user(0), { role: "assistant", content: [], model: "m", provider: "p", timestamp: 10, completedAt: 20 }]);
  assert.equal(stats.get(1).cost, 0, "没上报费用就是 0");
  assert.equal(stats.get(1).input, 0);
  const free = computeTurnStats([user(0), assistant(10, 20, usage(1, 1, 0, 0))]);
  assert.equal(free.get(1).cost, 0, "免费模型（单价 0）也是 0");
});
