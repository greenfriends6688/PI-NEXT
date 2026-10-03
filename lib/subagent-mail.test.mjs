// fork:agent-mail —— 进程内信箱：一次���消费、有界、等得到。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { SubagentMailbox, formatMail, subagentMailbox } = await createJiti(import.meta.url)
  .import("./subagent-mail.ts");

function mail(to, overrides = {}) {
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    from: "child-a",
    fromLabel: "explore: find parser",
    to,
    body: "parser is in lib/x.ts",
    sentAt: 1_700_000_000_000,
    ...overrides,
  };
}

test("drain 取走即清空：同一封信不会被读两次", () => {
  const box = new SubagentMailbox();
  box.send(mail("me"));
  assert.equal(box.drain("me").length, 1);
  assert.equal(box.drain("me").length, 0);
});

test("peek 不消费", () => {
  const box = new SubagentMailbox();
  box.send(mail("me"));
  assert.equal(box.peek("me").length, 1);
  assert.equal(box.peek("me").length, 1);
  assert.equal(box.drain("me").length, 1);
});

test("收件箱有界：超过上限丢最旧的，不无限长", () => {
  const box = new SubagentMailbox();
  for (let i = 0; i < 60; i++) box.send(mail("me", { id: `m-${i}`, body: `#${i}` }));
  const kept = box.drain("me");
  assert.equal(kept.length, 50);
  assert.equal(kept[0].body, "#10");
  assert.equal(kept.at(-1).body, "#59");
});

test("waitFor：信到了就醒", async () => {
  const box = new SubagentMailbox();
  const waiting = box.waitFor("me", 5_000);
  box.send(mail("me"));
  assert.equal(await waiting, true);
  assert.equal(box.drain("me").length, 1);
});

test("waitFor：已经有信时立刻返回，不空等", async () => {
  const box = new SubagentMailbox();
  box.send(mail("me"));
  assert.equal(await box.waitFor("me", 60_000), true);
});

test("waitFor：超时返回 false 而不是抛", async () => {
  const box = new SubagentMailbox();
  assert.equal(await box.waitFor("me", 10), false);
});

test("waitFor：被 abort 立刻返回 false，且不留 waiter", async () => {
  const box = new SubagentMailbox();
  const controller = new AbortController();
  const waiting = box.waitFor("me", 60_000, controller.signal);
  controller.abort();
  assert.equal(await waiting, false);
  // 清干净了：之后再等一次仍然能正常被唤醒。
  const second = box.waitFor("me", 5_000);
  box.send(mail("me"));
  assert.equal(await second, true);
});

test("多个并发 wait 全部被同一封信唤醒", async () => {
  const box = new SubagentMailbox();
  const a = box.waitFor("me", 5_000);
  const b = box.waitFor("me", 5_000);
  box.send(mail("me"));
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
});

test("信箱按收件人隔离", () => {
  const box = new SubagentMailbox();
  box.send(mail("a"));
  box.send(mail("b"));
  assert.equal(box.drain("a")[0].to, "a");
  assert.equal(box.drain("b")[0].to, "b");
  assert.equal(box.drain("c").length, 0);
});

test("globalThis 单例：热重载不会换掉正在等的信箱", () => {
  const first = subagentMailbox();
  assert.equal(subagentMailbox(), first);
});

test("给模型看的原文带发件人", () => {
  const text = formatMail([mail("me"), mail("me", { fromLabel: "plan: draft plan", body: "step 2" })]);
  assert.match(text, /\[explore: find parser · child-a\] parser is in lib\/x\.ts/);
  assert.match(text, /\[plan: draft plan · child-a\] step 2/);
});
