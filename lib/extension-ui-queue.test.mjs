import assert from "node:assert/strict";
import test from "node:test";

import {
  enqueueExtensionUiRequest,
  removeExtensionUiRequest,
  retainExtensionUiRequests,
  upsertExtensionUiRequest,
} from "./extension-ui-queue.ts";

const confirm = (id) => ({ type: "extension_ui_request", id, method: "confirm", title: `Run ${id}?`, message: "Details" });
const custom = (id, lines) => ({ type: "extension_ui_request", id, method: "custom", lines });
const ids = (queue) => queue.map((request) => request.id);

test("keeps requests that arrive at the same moment in arrival order instead of letting the newest replace the oldest", () => {
  // The bug this fixes (upstream 70470ca): two tools running in parallel, each gated
  // by a permission extension. The second request used to overwrite the first, whose
  // server-side future then never resolved.
  let queue = [];
  queue = enqueueExtensionUiRequest(queue, confirm("a"));
  queue = enqueueExtensionUiRequest(queue, confirm("b"));
  queue = enqueueExtensionUiRequest(queue, confirm("c"));

  assert.deepEqual(ids(queue), ["a", "b", "c"]);
});

test("a reconnect replay of a queued request neither duplicates nor reorders it", () => {
  const queue = [confirm("a"), confirm("b")];
  const replayed = enqueueExtensionUiRequest(enqueueExtensionUiRequest(queue, confirm("a")), confirm("b"));

  assert.equal(replayed, queue, "unchanged queues keep their identity so React skips the render");
  assert.deepEqual(ids(replayed), ["a", "b"]);

  // A replay that arrives as a fresh object (the server re-serializes it) is still the
  // same request: it must not become a second card.
  assert.deepEqual(ids(enqueueExtensionUiRequest(queue, { ...confirm("a") })), ["a", "b"]);
});

test("a close event drops exactly its own id from the queue", () => {
  const queue = [confirm("a"), confirm("b"), confirm("c")];

  assert.deepEqual(ids(removeExtensionUiRequest(queue, "b")), ["a", "c"]);
  assert.deepEqual(ids(removeExtensionUiRequest(queue, "a")), ["b", "c"]);
  assert.deepEqual(queue.map((request) => request.id), ["a", "b", "c"], "the previous queue is not mutated");
});

test("closing an id that is not queued leaves the queue untouched", () => {
  const queue = [confirm("a")];

  // Answering removes the dialog locally before the server's extension_ui_closed
  // arrives, and a custom panel closes by id too: an unknown id is a no-op.
  assert.equal(removeExtensionUiRequest(queue, "missing"), queue);
  assert.deepEqual(removeExtensionUiRequest(removeExtensionUiRequest(queue, "a"), "a"), []);
});

test("a reconnect drops requests the server closed while the stream was down", () => {
  const stale = confirm("a");
  const waiting = confirm("b");
  const queue = [stale, waiting, custom("c", ["panel"])];

  // The server now holds only b and c: a timed out, or was answered in another tab.
  // The close event was sent while this tab's stream was down, so it never arrived.
  const reconciled = retainExtensionUiRequests(queue, new Set(["b", "c", "d"]));
  assert.deepEqual(ids(reconciled), ["b", "c"]);
  assert.equal(reconciled[0], waiting, "a surviving request keeps its identity, and so its typed input");

  // Nothing closed: the same queue comes back, so nothing re-renders.
  assert.equal(retainExtensionUiRequests(reconciled, new Set(["b", "c"])), reconciled);
  // The server holds nothing at all (Stop, or the wrapper was rebuilt).
  assert.deepEqual(retainExtensionUiRequests(queue, new Set()), []);
});

test("a custom panel's re-render replaces it in place, and a second panel waits behind the first", () => {
  let queue = [];
  queue = upsertExtensionUiRequest(queue, custom("a", ["first"]));
  queue = upsertExtensionUiRequest(queue, custom("b", ["second"]));
  // Panel b renders again while a is on screen: a stays the head, b keeps its place.
  queue = upsertExtensionUiRequest(queue, custom("b", ["second, updated"]));
  queue = upsertExtensionUiRequest(queue, custom("a", ["first, updated"]));

  assert.deepEqual(ids(queue), ["a", "b"]);
  assert.deepEqual(queue.map((request) => request.lines), [["first, updated"], ["second, updated"]]);

  // Closing the panel on screen surfaces the other one with its latest render,
  // instead of leaving it hidden until it happens to render again.
  assert.deepEqual(removeExtensionUiRequest(queue, "a"), [custom("b", ["second, updated"])]);
});

test("upserting the entry already queued keeps the queue's identity", () => {
  const request = custom("a", ["only"]);
  const queue = [request];

  assert.equal(upsertExtensionUiRequest(queue, request), queue);
  assert.notEqual(upsertExtensionUiRequest(queue, custom("a", ["only"])), queue, "a fresh render is a new entry");
});

test("Stop clears every queued request through its own close event", () => {
  let queue = [confirm("a"), confirm("b"), custom("c", ["panel"])];
  for (const id of ["a", "b", "c"]) queue = removeExtensionUiRequest(queue, id);

  assert.deepEqual(queue, []);
});