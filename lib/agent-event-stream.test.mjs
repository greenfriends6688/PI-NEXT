import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createAgentEventStream } = await jiti.import("./agent-event-stream.ts");
const { hasActiveSessionLivenessProvider } = await jiti.import("./session-liveness.ts");
// fork:event-seq
const { AgentEventLog, createClientAgentEvent } = await jiti.import("./agent-event-log.ts");
const decoder = new TextDecoder();

/** 复刻 AgentSessionWrapper.emit() 交给 SSE 流的那份形态。 */
const clientDelivery = createClientAgentEvent;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function readWithin(reader, timeoutMs = 1_000) {
  let timeout;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out reading SSE chunk")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeFrame(chunk) {
  const text = decoder.decode(chunk.value);
  const match = /^(?:id: (\d+)\n)?data: (.*)\n\n$/s.exec(text);
  assert.ok(match, `unexpected SSE frame: ${JSON.stringify(text)}`);
  return { id: match[1] === undefined ? null : Number(match[1]), data: JSON.parse(match[2]) };
}

/** 旧断言只关心事件本身，序号在这里剥掉。 */
function decodeData(chunk) {
  const { data } = decodeFrame(chunk);
  const { seq, ...rest } = data;
  void seq;
  return rest;
}

test("opens the transport before a slow session is ready and snapshots after subscribing", async () => {
  const startup = deferred();
  const abortController = new AbortController();
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    "session-id",
    startup.promise,
  );
  const reader = stream.getReader();

  const transport = await readWithin(reader);
  assert.equal(decoder.decode(transport.value), ":\n\n");

  const snapshot = { role: "assistant", content: [{ type: "text", text: "Hello" }] };
  let listener;
  let subscribeCount = 0;
  let unsubscribeCount = 0;
  const log = new AgentEventLog();
  startup.resolve({
    isStreaming: true,
    isCompacting: false,
    streamingMessage: snapshot,
    eventLog: log,
    onClientEvent(nextListener) {
      subscribeCount += 1;
      listener = (event) => {
        const delivery = clientDelivery(event, log);
        if (delivery) nextListener(delivery);
      };
      listener({
        type: "message_update",
        message: snapshot,
        assistantMessageEvent: { type: "text_delta", delta: "ignored" },
      });
      listener({ type: "agent_start" });
      return () => { unsubscribeCount += 1; };
    },
  });

  const connected = decodeData(await readWithin(reader));
  const messageStart = decodeData(await readWithin(reader));
  const replayedEvent = decodeData(await readWithin(reader));
  assert.equal(subscribeCount, 1);
  assert.deepEqual(connected, {
    type: "connected",
    sessionId: "session-id",
    isStreaming: true,
    isCompacting: false,
  });
  assert.deepEqual(messageStart, { type: "agent_start" });
  assert.deepEqual(replayedEvent, { type: "message_start", message: snapshot });
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-id" }), true);

  listener({
    type: "message_update",
    message: { ...snapshot },
    assistantMessageEvent: {
      type: "text_delta",
      delta: "!",
      partial: { ...snapshot },
    },
  });
  assert.deepEqual(decodeData(await readWithin(reader)), {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "!" },
  });

  abortController.abort();
  assert.equal(unsubscribeCount, 1);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-id" }), false);
  assert.equal((await readWithin(reader)).done, true);
});

test("reports a startup failure in-band after opening the transport", async () => {
  const stream = createAgentEventStream(
    new Request("http://localhost/events"),
    "session-id",
    Promise.reject(new Error("broken config")),
  );
  const reader = stream.getReader();

  assert.equal(decoder.decode((await readWithin(reader)).value), ":\n\n");
  assert.deepEqual(decodeData(await readWithin(reader)), {
    type: "startup_error",
    errorMessage: "Failed to start agent: broken config",
  });
  assert.equal((await readWithin(reader)).done, true);
});

test("does not subscribe when the client cancels during startup", async () => {
  const startup = deferred();
  let subscribeCount = 0;
  const stream = createAgentEventStream(
    new Request("http://localhost/events"),
    "session-id",
    startup.promise,
  );
  const reader = stream.getReader();

  await readWithin(reader);
  await reader.cancel();
  startup.resolve({
    isStreaming: false,
    streamingMessage: undefined,
    eventLog: new AgentEventLog(),
    onClientEvent() {
      subscribeCount += 1;
      return () => {};
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(subscribeCount, 0);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-id" }), false);
});

test("closes an already-aborted request and handles a later startup rejection", async () => {
  const abortController = new AbortController();
  abortController.abort();
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    "session-id",
    Promise.reject(new Error("startup failed after disconnect")),
  );

  assert.equal((await readWithin(stream.getReader())).done, true);
  await new Promise((resolve) => setImmediate(resolve));
});

// fork:upstream-sse-backlog — #997 移植（6b0c6a5）
async function connectedStream(sessionId, overrides = {}, options = {}) {
  const abortController = new AbortController();
  const log = options.log ?? new AgentEventLog();
  let listener;
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    sessionId,
    Promise.resolve({
      isStreaming: true,
      isCompacting: false,
      streamingMessage: undefined,
      ...overrides,
      eventLog: log,
      onClientEvent(nextListener) {
        listener = (event) => {
          const delivery = clientDelivery(event, log);
          if (delivery) nextListener(delivery);
        };
        return () => {};
      },
    }),
    options.lastEventId ?? null,
  );
  const reader = stream.getReader();
  assert.equal(decoder.decode((await readWithin(reader)).value), ":\n\n");
  const connected = decodeData(await readWithin(reader));
  // fork:upstream-compaction-status — connected 快照带上了压缩状态，所以这里的期望
  // 跟着走；`isCompacting` 缺省是 false（未压缩的会话不多带一个 true 出去）。
  assert.deepEqual(connected, {
    type: "connected",
    sessionId,
    isStreaming: overrides.isStreaming ?? true,
    isCompacting: overrides.isCompacting ?? false,
  });
  return { reader, listener, log, abortController, connected };
}

const BIG_PAYLOAD = "x".repeat(30_000);

function toolUpdate() {
  return {
    type: "tool_execution_update",
    toolCallId: "call-1",
    toolName: "bash",
    partialResult: BIG_PAYLOAD,
  };
}

/** Not droppable, so it always survives and marks the end of the queued batch. */
function sentinelEvent() {
  return { type: "agent_end" };
}

function withBacklogLimit(rawValue, run) {
  const previousLimit = process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES;
  process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES = rawValue;
  try {
    return run();
  } finally {
    if (previousLimit === undefined) delete process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES;
    else process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES = previousLimit;
  }
}

test("terminates the stream when an unread, non-rebuildable backlog exceeds the limit", async () => {
  await withBacklogLimit(String(64 * 1024), async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const { reader, listener } = await connectedStream("backlog-session");

      // Stop reading here: message snapshots cannot be rebuilt client-side, so
      // they must hit the hard limit instead of being dropped.
      const message = { role: "assistant", content: [{ type: "text", text: BIG_PAYLOAD }] };
      for (let index = 0; index < 8; index += 1) {
        listener({ type: "message_start", message });
      }

      let queuedChunks = 0;
      await assert.rejects(async () => {
        for (;;) {
          const next = await readWithin(reader);
          if (next.done) return;
          queuedChunks += 1;
          assert.ok(queuedChunks < 8, "stream kept queueing past the backlog limit");
        }
      }, /client backlog exceeded/);
      assert.equal(hasActiveSessionLivenessProvider({ sessionId: "backlog-session" }), false);
    } finally {
      console.warn = warn;
    }
  });
});

test("drops rebuildable deltas while the client is behind instead of disconnecting it", async () => {
  await withBacklogLimit(String(8 * 1024 * 1024), async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const { reader, listener, abortController } = await connectedStream("behind-session");

      const emitted = 60;
      for (let index = 0; index < emitted; index += 1) listener(toolUpdate());
      listener(sentinelEvent());

      // Whatever was queued before the water mark is still delivered…
      let delivered = 0;
      let sawSentinel = false;
      while (!sawSentinel) {
        const next = await readWithin(reader);
        assert.equal(next.done, false);
        const event = decodeData(next);
        if (event.type === "agent_end") sawSentinel = true;
        else delivered += 1;
      }
      assert.ok(delivered < emitted, `expected drops, delivered ${delivered} of ${emitted}`);
      assert.equal(hasActiveSessionLivenessProvider({ sessionId: "behind-session" }), true);

      // …and the stream stays usable once the client catches up.
      listener(toolUpdate());
      const afterCatchUp = await readWithin(reader);
      assert.equal(afterCatchUp.done, false);
      assert.equal(decodeData(afterCatchUp).type, "tool_execution_update");
      abortController.abort();
    } finally {
      console.warn = warn;
    }
  });
});

test("keeps the start and end of a streamed block while dropping its deltas", async (t) => {
  await withBacklogLimit(String(8 * 1024 * 1024), async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const { reader, listener, abortController } = await connectedStream("block-session");
      t.after(() => abortController.abort());
      const update = (assistantMessageEvent) => ({
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent,
      });

      listener(update({ type: "text_start", contentIndex: 0 }));
      for (let index = 0; index < 60; index += 1) {
        listener(update({ type: "text_delta", contentIndex: 0, delta: BIG_PAYLOAD }));
      }
      // The client's reducer replaces the block with this content, repairing any dropped delta.
      listener(update({ type: "text_end", contentIndex: 0, content: "final text" }));
      listener(sentinelEvent());

      const kinds = [];
      for (;;) {
        const event = decodeData(await readWithin(reader));
        if (event.type === "agent_end") break;
        kinds.push(event.assistantMessageEvent.type);
      }
      assert.equal(kinds[0], "text_start");
      assert.equal(kinds.at(-1), "text_end");
      assert.ok(kinds.length < 62, `expected dropped deltas, got ${kinds.length} events`);
    } finally {
      console.warn = warn;
    }
  });
});

test("delivers every event to a client that reads promptly", async () => {
  const { reader, listener, abortController } = await connectedStream("prompt-session");
  for (let index = 0; index < 40; index += 1) {
    listener(toolUpdate());
    const next = await readWithin(reader);
    assert.equal(next.done, false);
    assert.equal(decodeData(next).type, "tool_execution_update");
  }
  abortController.abort();
});

// fork:upstream-compaction-status — #1008 移植（2e66e40）· 事件侧
test("a reconnect during auto-compaction still learns that the session is compacting", async () => {
  // `compaction_start` only reaches the SSE client that was attached at the time;
  // after a reconnect the snapshot is all the client gets.
  const { connected, abortController } = await connectedStream("compacting-session", {
    isStreaming: true,
    isCompacting: true,
  });

  // `compaction_start` 只到当时连着的客户端；重连后客户端唯一拿到的就是这份快照。
  assert.equal(connected.isCompacting, true);

  abortController.abort();
});

test("a compacting session is reported as such even before it starts streaming", async () => {
  const { connected, abortController } = await connectedStream("manual-compacting-session", {
    isStreaming: false,
    isCompacting: true,
  });

  // 手动压缩（/compact）时 `isStreaming` 还没置位，但客户端同样要知道正在压缩。
  assert.equal(connected.isCompacting, true);
  assert.equal(connected.isStreaming, false);

  abortController.abort();
});

// fork:event-seq
test("only authoritative events carry an SSE id and a sequence", async () => {
  const { reader, listener, abortController } = await connectedStream("seq-session");
  listener({ type: "agent_start" });
  const start = decodeFrame(await readWithin(reader));
  assert.equal(typeof start.id, "number");
  assert.equal(start.data.seq, start.id);

  // 可重建的增量不编号：背压下丢掉它们不会制造假缺口。
  listener(toolUpdate());
  const delta = decodeFrame(await readWithin(reader));
  assert.equal(delta.id, null);
  assert.equal(delta.data.seq, undefined);
  assert.equal(delta.data.type, "tool_execution_update");
  abortController.abort();
});

test("a reconnect replays the authoritative events missed while disconnected", async () => {
  const log = new AgentEventLog();
  log.record({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash" });
  log.record({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash" });

  const { reader, abortController } = await connectedStream(
    "resume-session",
    { streamingMessage: { role: "assistant", content: [] } },
    { lastEventId: 0, log },
  );

  const first = decodeFrame(await readWithin(reader));
  assert.equal(first.id, 1);
  assert.equal(first.data.type, "tool_execution_start");
  const second = decodeFrame(await readWithin(reader));
  assert.equal(second.id, 2);
  assert.equal(second.data.type, "tool_execution_end");

  // 补上的事件已经覆盖了流式消息，不再多送一次快照。
  abortController.abort();
});

test("falls back to the snapshot when the replay buffer no longer covers the cursor", async () => {
  const log = new AgentEventLog({ maxEntries: 1 });
  log.record({ type: "first" });
  log.record({ type: "second" });
  const snapshot = { role: "assistant", content: [] };

  const { reader, abortController } = await connectedStream(
    "stale-cursor-session",
    { streamingMessage: snapshot },
    { lastEventId: 0, log },
  );

  const frame = decodeFrame(await readWithin(reader));
  assert.equal(frame.data.type, "message_start");
  assert.deepEqual(frame.data.message, snapshot);
  abortController.abort();
});
