import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { focusAfterClose, rememberTabVisit } = await jiti.import("@/lib/tab-mru");

/** 从空表开始的一次访问：session-a 从 tab1 走到 tab2 → 记住 tab1。 */
function visit(mru, sessionKey, from, to, previousSessionKey = sessionKey) {
  return rememberTabVisit(mru, {
    sessionKey,
    previousSessionKey,
    previousTabId: from,
    currentTabId: to,
  });
}

test("leaving a tab remembers where it was, per session", () => {
  const mru = visit(new Map(), "session-a", "file:1", "file:2");
  assert.equal(mru.get("session-a"), "file:1");
  assert.equal(mru.size, 1);
});

test("the first visit in a session remembers nothing", () => {
  const empty = new Map();
  // 没有上一个 tab
  assert.equal(visit(empty, "session-a", null, "file:1"), empty);
  // 打开工作区时没有「上一个会话」可比
  assert.equal(visit(empty, "session-a", "file:1", "file:2", null), empty);
  // 没开会话（key 为 null）不记
  assert.equal(visit(empty, null, "file:1", "file:2"), empty);
  // 同一个 tab 反复激活不产生记忆
  assert.equal(visit(empty, "session-a", "file:1", "file:1"), empty);
});

test("re-recording the same tab keeps the same map (no needless re-render)", () => {
  const first = visit(new Map(), "session-a", "file:1", "file:2");
  const second = visit(first, "session-a", "file:1", "file:3");
  assert.equal(second, first, "same value → same reference");
});

test("switching sessions never leaks the other session's tab", () => {
  // session-a 里从 file:1 走到 file:2，然后切到 session-b 并激活 file:3：
  // session-b 的「上一个」不该是 session-a 的 file:2。
  const first = visit(new Map(), "session-a", "file:1", "file:2");
  const second = visit(first, "session-b", "file:2", "file:3", "session-a");
  assert.equal(second.get("session-b"), undefined);
  assert.equal(second.get("session-a"), "file:1", "session-a keeps its own memory");
});

test("each session remembers independently", () => {
  let mru = visit(new Map(), "a", "t1", "t2");
  mru = visit(mru, "b", "t3", "t4");
  assert.equal(mru.get("a"), "t1");
  assert.equal(mru.get("b"), "t3");
});

test("closing the active tab returns to the last visited one, not to a neighbour", () => {
  const mru = visit(new Map(), "s", "file:1", "file:2");
  const focus = focusAfterClose(mru, {
    sessionKey: "s",
    closedTabId: "file:2",
    openTabIds: ["file:1", "file:3"],
    fallbackId: "file:3",
  });
  assert.equal(focus, "file:1");
});

test("the remembered tab is never the one that just closed", () => {
  // 记下的就是刚关掉的那个（用户来回切过），此时退回旧行为，而不是跳到空位。
  const mru = visit(new Map(), "s", "file:1", "file:2"); // s → file:1
  const focus = focusAfterClose(mru, {
    sessionKey: "s",
    closedTabId: "file:1",
    openTabIds: ["file:2", "file:3"],
    fallbackId: "file:2",
  });
  assert.equal(focus, "file:2");
});

test("a remembered tab that is already closed falls back", () => {
  const mru = visit(new Map(), "s", "file:1", "file:2");
  const focus = focusAfterClose(mru, {
    sessionKey: "s",
    closedTabId: "file:9", // 关的是别的 tab，记忆里的 file:1 已经不在了
    openTabIds: ["file:2", "file:3"],
    fallbackId: "file:2",
  });
  assert.equal(focus, "file:2");
});

test("another session's memory is not used", () => {
  const mru = visit(new Map(), "other", "file:1", "file:2");
  const focus = focusAfterClose(mru, {
    sessionKey: "s",
    closedTabId: "file:2",
    openTabIds: ["file:1", "file:3"],
    fallbackId: "file:3",
  });
  assert.equal(focus, "file:3", "no memory for this session → old behaviour");
});

test("a stale fallback still gets a real tab", () => {
  const focus = focusAfterClose(new Map(), {
    sessionKey: "s",
    closedTabId: "file:2",
    openTabIds: ["file:3"],
    fallbackId: "file:2",
  });
  assert.equal(focus, "file:3");
});

test("nothing left to focus means null", () => {
  assert.equal(focusAfterClose(new Map(), {
    sessionKey: "s",
    closedTabId: "file:2",
    openTabIds: [],
    fallbackId: null,
  }), null);
});