import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMail, SubagentMailbox, type SubagentMailMessage } from "../src/main/pinext/agent-mail/mailbox.ts";

/**
 * The mailbox behind `agent_mail`.
 *
 * Two properties are load-bearing and are what these tests pin: a message is **stored before
 * delivery is attempted** (a target that already finished still finds it), and a read
 * **clears** (so a model cannot drain the same letter twice).
 */

function mail(to: string, body: string, from = "child-1"): SubagentMailMessage {
  return { id: `${from}-${body}`, from, fromLabel: from, to, body, sentAt: Date.now() };
}

test("a message to a box that nobody is waiting on is still there afterwards", () => {
  // This is the case the ordering exists for: the target may have finished already.
  const box = new SubagentMailbox();
  box.send(mail("parent", "found it"));
  assert.equal(box.peek("parent").length, 1);
  assert.equal(box.drain("parent").length, 1);
});

test("a read clears, so the same letter is not read twice", () => {
  const box = new SubagentMailbox();
  box.send(mail("parent", "one"));
  assert.equal(box.drain("parent").length, 1);
  assert.deepEqual(box.drain("parent"), []);
  assert.deepEqual(box.peek("parent"), []);
});

test("waitFor resolves as soon as a message lands", async () => {
  const box = new SubagentMailbox();
  const waiting = box.waitFor("parent", 5_000);
  // Sent after the wait began — the waiter must be woken, not polled.
  box.send(mail("parent", "arrived"));
  assert.equal(await waiting, true);
  assert.equal(box.drain("parent").length, 1);
});

test("waitFor on an already-full box answers immediately", async () => {
  const box = new SubagentMailbox();
  box.send(mail("parent", "already here"));
  assert.equal(await box.waitFor("parent", 5_000), true);
});

test("a timeout answers false rather than throwing", async () => {
  // The model reads "nothing arrived yet" far better than an exception.
  const box = new SubagentMailbox();
  assert.equal(await box.waitFor("parent", 10), false);
});

test("aborting a wait answers false and leaves the waiter list clean", async () => {
  const box = new SubagentMailbox();
  const controller = new AbortController();
  const waiting = box.waitFor("parent", 60_000, controller.signal);
  controller.abort();
  assert.equal(await waiting, false);
  // A later message must still be delivered — the aborted waiter is gone, not stuck.
  box.send(mail("parent", "later"));
  assert.equal(box.drain("parent").length, 1);
});

test("a full box drops the oldest rather than growing without bound", () => {
  const box = new SubagentMailbox();
  for (let index = 0; index < 60; index += 1) box.send(mail("parent", `m${index}`));
  const kept = box.drain("parent");
  assert.equal(kept.length, 50);
  assert.equal(kept[0].body, "m10", "the ten oldest went first");
});

test("the rendered mail names the sender, so the model does not have to guess", () => {
  const text = formatMail([
    { ...mail("parent", "first"), fromLabel: "researcher" },
    { ...mail("parent", "second"), from: "child-2", fromLabel: "reviewer" },
  ]);
  assert.match(text, /researcher/);
  assert.match(text, /reviewer/);
  assert.match(text, /first/);
  assert.match(text, /second/);
});
