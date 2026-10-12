import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentEventLog } = await jiti.import("./agent-event-log.ts");

test("assigns monotonically increasing sequence numbers from 1", () => {
  const log = new AgentEventLog();
  assert.equal(log.currentSeq, 0);
  assert.equal(log.record({ type: "message_start" }).seq, 1);
  assert.equal(log.record({ type: "message_end" }).seq, 2);
  assert.equal(log.currentSeq, 2);
});

test("the serialized payload carries the sequence", () => {
  const log = new AgentEventLog();
  const entry = log.record({ type: "message_end", message: { role: "assistant" } });
  assert.deepEqual(JSON.parse(entry.text), {
    type: "message_end",
    message: { role: "assistant" },
    seq: entry.seq,
  });
});

test("replays everything after the client cursor", () => {
  const log = new AgentEventLog();
  log.record({ type: "a" });
  log.record({ type: "b" });
  log.record({ type: "c" });
  const { events, complete } = log.replayAfter(1);
  assert.equal(complete, true);
  assert.deepEqual(events.map((entry) => entry.event.type), ["b", "c"]);
});

test("a cursor at the head means nothing was missed", () => {
  const log = new AgentEventLog();
  log.record({ type: "a" });
  assert.deepEqual(log.replayAfter(1), { events: [], complete: true });
  assert.deepEqual(log.replayAfter(99), { events: [], complete: true });
});

test("an evicted gap is reported as incomplete instead of silently truncated", () => {
  const log = new AgentEventLog({ maxEntries: 2 });
  log.record({ type: "a" });
  log.record({ type: "b" });
  log.record({ type: "c" });
  // 'a' was evicted, so a client that last saw seq 0 cannot be caught up.
  assert.equal(log.replayAfter(0).complete, false);
  // A client that last saw seq 1 is still fully covered.
  const result = log.replayAfter(1);
  assert.equal(result.complete, true);
  assert.deepEqual(result.events.map((entry) => entry.event.type), ["b", "c"]);
});

test("the byte budget evicts oldest entries", () => {
  const log = new AgentEventLog({ maxBytes: 60 });
  log.record({ type: "a", payload: "x".repeat(40) });
  log.record({ type: "b" });
  assert.ok(log.replayAfter(0).complete === false, "the first entry should have been evicted");
});

test("an empty log answers a cursor request without claiming a gap", () => {
  const log = new AgentEventLog();
  assert.deepEqual(log.replayAfter(5), { events: [], complete: true });
});

test("a non-finite cursor is treated as no cursor", () => {
  const log = new AgentEventLog();
  log.record({ type: "a" });
  assert.equal(log.replayAfter(Number.NaN).complete, true);
});
