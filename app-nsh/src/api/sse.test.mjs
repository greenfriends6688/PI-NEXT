// `sse.ts` under plain Node: `node --experimental-strip-types --test app-nsh/src/api/sse.test.mjs`
//
// The parser is the part that breaks silently (a frame split by TCP, a stray
// comment), so it is tested directly; the connection loop is tested through a
// fake `fetch` that hands back a `ReadableStream`, which is what the real one
// gives `getReader()`. No nsh runtime is involved.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_STALE_MS,
  openStream,
  parseFrames,
  withToken,
} from "./sse.ts";

const encode = (text) => new TextEncoder().encode(text);

/** A `fetch` stand-in: one queued body per call, recording every request. */
function fakeFetch(bodies) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const index = calls.length;
    const body = bodies[Math.min(index, bodies.length - 1)];
    calls.push({ url, headers: { ...(init.headers ?? {}) } });
    if (body instanceof Error) throw body;
    if (typeof body === "number") {
      return {
        ok: false,
        status: body,
        statusText: "error",
        body: new ReadableStream({ start(controller) { controller.close(); } }),
      };
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      body: new ReadableStream({
        start(controller) {
          for (const chunk of body) controller.enqueue(encode(chunk));
          controller.close();
        },
      }),
    };
  };
  return { fetchImpl, calls };
}

test("one frame with one data line", () => {
  const { frames, rest } = parseFrames("", 'data: {"type":"heartbeat"}\n\n');
  assert.deepEqual(frames, [{ data: '{"type":"heartbeat"}' }]);
  assert.equal(rest, "");
});

test("several frames in one chunk", () => {
  const { frames, rest } = parseFrames("", "data: a\n\ndata: b\n\nevent: x\ndata: c\n\n");
  assert.deepEqual(frames, [{ data: "a" }, { data: "b" }, { event: "x", data: "c" }]);
  assert.equal(rest, "");
});

test("a frame cut across two chunks is only dispatched once it ends", () => {
  const first = parseFrames("", 'data: {"type":"mess');
  assert.deepEqual(first.frames, []);
  assert.equal(first.rest, 'data: {"type":"mess');

  const second = parseFrames(first.rest, 'age_start"}\n'); // no blank line yet
  assert.deepEqual(second.frames, []);
  assert.equal(second.rest, 'data: {"type":"message_start"}\n');

  const third = parseFrames(second.rest, "\n");
  assert.deepEqual(third.frames, [{ data: '{"type":"message_start"}' }]);
  assert.equal(third.rest, "");
});

test("a chunk boundary in the middle of the blank line still splits", () => {
  const first = parseFrames("", "data: a\n");
  assert.deepEqual(first.frames, []);
  const second = parseFrames(first.rest, "\ndata: b\n\n");
  assert.deepEqual(second.frames, [{ data: "a" }, { data: "b" }]);
});

test("multi-line data joins with a newline", () => {
  const { frames } = parseFrames("", "data: first\ndata: second\ndata:  third\n\n");
  assert.deepEqual(frames, [{ data: "first\nsecond\n third" }]);
});

test("id is recorded, and an id-only frame keeps it without dispatching data", () => {
  const { frames } = parseFrames("", "id: 41\ndata: out\n\nid: 42\n\n");
  assert.deepEqual(frames, [{ data: "out", id: "41" }, { data: "", id: "42" }]);
});

test("comment lines (the server's `:\\n\\n` and keep-alives) are ignored", () => {
  const hello = parseFrames("", ":\n\n");
  assert.deepEqual(hello.frames, []);
  assert.equal(hello.rest, "");

  const keepAlive = parseFrames("", ": keep-alive\n\n");
  assert.deepEqual(keepAlive.frames, []);

  const mixed = parseFrames("", ": hb\n\ndata: real\n\n: hb\n\n");
  assert.deepEqual(mixed.frames, [{ data: "real" }]);
});

test("CRLF and lone CR line endings split the same way", () => {
  assert.deepEqual(parseFrames("", "data: a\r\n\r\ndata: b\r\r").frames, [{ data: "a" }, { data: "b" }]);
  // A trailing CR may be the first half of a CRLF: held until the next chunk.
  const cut = parseFrames("", "data: a\r");
  assert.deepEqual(cut.frames, []);
  assert.equal(cut.rest, "data: a\r");
  // That CRLF is one terminator, so `data: b` is a second data line of the
  // same frame (no blank line between them), not a new one.
  assert.deepEqual(parseFrames(cut.rest, "\ndata: b\n\n").frames, [{ data: "a\nb" }]);
});

test("event name, one-space value rule and retry field", () => {
  const { frames } = parseFrames("", "event: message\nretry: 1500\ndata:no-space\ndata:  two spaces\n\n");
  assert.deepEqual(frames, [{ data: "no-space\n two spaces", event: "message", retry: 1500 }]);
});

test("withToken puts the token in the query and leaves absolute URLs alone", () => {
  assert.equal(withToken("http://127.0.0.1:30142", "/api/sessions", null), "http://127.0.0.1:30142/api/sessions");
  assert.equal(withToken("http://127.0.0.1:30142/", "api/sessions", "abc"), "http://127.0.0.1:30142/api/sessions?t=abc");
  assert.equal(withToken("http://host:1", "/api/x?force=1", "a b"), "http://host:1/api/x?force=1&t=a%20b");
  assert.equal(withToken("http://host:1", "/api/x?t=kept", "other"), "http://host:1/api/x?t=kept");
  assert.equal(withToken("ignored", "https://phone:30142/api/x", "abc"), "https://phone:30142/api/x?t=abc");
});

test("openStream delivers every data frame, skipping the comment heartbeat", async () => {
  const { fetchImpl, calls } = fakeFetch([[
    ":\n\n",
    'data: {"type":"connected","sessionId":"s1"}\n\n',
    'data: {"type":"heartbeat"}\n\n',
    'data: {"type":"agent_end"}\n\n',
  ]]);
  const seen = [];
  let close;
  await new Promise((resolve) => {
    close = openStream("/api/agent/s1/events", (event) => {
      seen.push(JSON.parse(event.data));
      if (seen.length === 2) resolve();
    }, { fetch: fetchImpl, staleMs: 60_000, minRetryMs: 50, maxRetryMs: 100 });
  });
  close();

  assert.deepEqual(seen.map((event) => event.type), ["connected", "agent_end"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:30142/api/agent/s1/events");
  assert.equal(calls[0].headers.Accept, "text/event-stream");
  assert.equal(calls[0].headers["Last-Event-ID"], undefined);
});

test("a reconnect carries Last-Event-ID from the frame that had the id", async () => {
  const { fetchImpl, calls } = fakeFetch([
    ["id: 42\ndata: {\"type\":\"out\"}\n\n"], // then EOF
    ['data: {"type":"out2"}\n\n'],
  ]);
  const seen = [];
  let close;
  await new Promise((resolve) => {
    close = openStream("/api/terminal/t1/events", (event) => {
      seen.push(event.data);
      if (seen.length === 2) resolve();
    }, { fetch: fetchImpl, staleMs: 60_000, minRetryMs: 1, maxRetryMs: 4 });
  });
  close();

  assert.deepEqual(seen.map((data) => JSON.parse(data).type), ["out", "out2"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers["Last-Event-ID"], "42");
});

test("a 404 is reported and not retried", async () => {
  const { fetchImpl, calls } = fakeFetch([404]);
  const errors = [];
  let close;
  await new Promise((resolve) => {
    close = openStream("/api/agent/gone/events", () => {}, {
      fetch: fetchImpl,
      staleMs: 60_000,
      minRetryMs: 1,
      maxRetryMs: 2,
      onError: (_error, info) => {
        errors.push(info);
        resolve();
      },
    });
  });
  close();

  assert.equal(errors.length, 1);
  assert.equal(errors[0].willRetry, false);
  assert.equal(errors[0].status, 404);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls.length, 1, "a 404 must not be retried");
});

test("close() stops the stream and the reconnect loop", async () => {
  const { fetchImpl, calls } = fakeFetch([["data: one\n\n"]]);
  let close;
  let seenOne;
  const one = new Promise((resolve) => { seenOne = resolve; });
  close = openStream("/api/agent/s/events", () => seenOne(), {
    fetch: fetchImpl,
    staleMs: 60_000,
    minRetryMs: 1,
    maxRetryMs: 2,
  });
  await one;
  close();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(calls.length, 1, "no reconnect after close()");
});

test("the stale watchdog fires when the server goes quiet", async () => {
  // A body that never ends and never sends: the watchdog must abort it.
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    body: new ReadableStream({ start() {} }),
  });
  const errors = [];
  let close;
  await new Promise((resolve) => {
    close = openStream("/api/agent/quiet/events", () => {}, {
      fetch: fetchImpl,
      staleMs: 20,
      minRetryMs: 5_000,
      maxRetryMs: 5_000,
      onError: (_error, info) => {
        errors.push(info);
        resolve();
      },
    });
  });
  close();

  assert.equal(errors.length, 1);
  assert.equal(errors[0].willRetry, true);
  assert.ok(DEFAULT_STALE_MS >= 60_000, "the default watchdog must outlast the 30 s heartbeat twice over");
});
