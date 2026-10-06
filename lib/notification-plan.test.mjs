// fork:mobile-shell —— 通知在场裁决：focused / present / absent 三态 + 边界
import assert from "node:assert/strict";
import test from "node:test";

async function loadSubjects() {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  const plan = await jiti.import("./notification-plan.ts");
  const push = await createJiti(import.meta.url, { moduleCache: false }).import("./web-push.ts");
  return { ...plan, ...push };
}

const { computeNotificationPlan, PRESENCE_THRESHOLD_MS, createWebPushNotifier } = await loadSubjects();

const NOW = 1_000_000_000_000;
const client = (overrides = {}) => ({
  clientId: "c1",
  appVisible: true,
  focusedSessionId: null,
  lastActivityAtMs: NOW - 5_000,
  ...overrides,
});

test("正聚焦该会话的在场客户端 → 不推（reason: focused）", () => {
  const plan = computeNotificationPlan({
    clients: [client({ focusedSessionId: "s1" })],
    sessionId: "s1",
    nowMs: NOW,
  });
  assert.equal(plan.shouldPush, false);
  assert.equal(plan.reason, "focused");
});

test("在场但看着别的会话 → 不推（未读点已经是在场提醒）（reason: present）", () => {
  const plan = computeNotificationPlan({
    clients: [client({ focusedSessionId: "other" })],
    sessionId: "s1",
    nowMs: NOW,
  });
  assert.equal(plan.shouldPush, false);
  assert.equal(plan.reason, "present");
});

test("在场但标签页在后台（appVisible=false）→ 仍算在场，不推", () => {
  const plan = computeNotificationPlan({
    clients: [client({ appVisible: false })],
    sessionId: "s1",
    nowMs: NOW,
  });
  assert.equal(plan.shouldPush, false);
  assert.equal(plan.reason, "present");
});

test("全部客户端交互陈旧 → 推（reason: no-presence）", () => {
  const plan = computeNotificationPlan({
    clients: [client({ lastActivityAtMs: NOW - PRESENCE_THRESHOLD_MS - 1 })],
    sessionId: "s1",
    nowMs: NOW,
  });
  assert.equal(plan.shouldPush, true);
  assert.equal(plan.reason, "no-presence");
});

test("从未交互过的客户端（刚开的后台标签页）不算在场", () => {
  const plan = computeNotificationPlan({
    clients: [client({ lastActivityAtMs: null })],
    sessionId: "s1",
    nowMs: NOW,
  });
  assert.equal(plan.shouldPush, true);
});

test("阈值边界：恰好 threshold 算在场，超一毫秒离场", () => {
  const at = computeNotificationPlan({
    clients: [client({ lastActivityAtMs: NOW - PRESENCE_THRESHOLD_MS })],
    sessionId: "s1",
    nowMs: NOW,
  });
  assert.equal(at.shouldPush, false);
  const past = computeNotificationPlan({
    clients: [client({ lastActivityAtMs: NOW - PRESENCE_THRESHOLD_MS - 1 })],
    sessionId: "s1",
    nowMs: NOW,
  });
  assert.equal(past.shouldPush, true);
});

test("时钟漂移：心跳报来未来时间按「刚刚交互」算，不得崩溃或误判", () => {
  const plan = computeNotificationPlan({
    clients: [client({ lastActivityAtMs: NOW + 60_000 })],
    sessionId: "s1",
    nowMs: NOW,
  });
  assert.equal(plan.shouldPush, false);
});

test("没有任何客户端 → 推", () => {
  const plan = computeNotificationPlan({ clients: [], sessionId: "s1", nowMs: NOW });
  assert.equal(plan.shouldPush, true);
});

test("一台设备盯着结果、另一台早已离场 → 仍不推（任一在场即静音）", () => {
  const plan = computeNotificationPlan({
    clients: [
      client({ clientId: "desk", focusedSessionId: "s1" }),
      client({ clientId: "phone", lastActivityAtMs: NOW - 600_000 }),
    ],
    sessionId: "s1",
    nowMs: NOW,
  });
  assert.equal(plan.shouldPush, false);
  assert.equal(plan.reason, "focused");
});

// ---- web-push 集成层：notifySessionComplete 发送前真做裁决 ----

function makePushEnvironment({ presenceClients = [], sessionNames = new Map() } = {}) {
  const sent = [];
  const notifier = createWebPushNotifier({
    send: async (subscription, payload) => {
      sent.push({ subscription, payload: JSON.parse(payload) });
    },
    loadState: () => null,
    saveState: () => {},
    generateVapidKeys: () => ({ publicKey: "pub", privateKey: "priv" }),
    listSessionNames: async () => sessionNames,
    listPresenceClients: () => presenceClients,
  });
  notifier.addSubscription({
    endpoint: "https://push.example.com/en",
    keys: { p256dh: "p", auth: "a" },
    locale: "en",
  });
  return { notifier, sent };
}

test("在场裁决命中时 notifySessionComplete 一封都不发", async () => {
  const { notifier, sent } = makePushEnvironment({
    // 集成层走真实 Date.now()，fixture 必须相对真实时钟，不能用上面的固定 NOW。
    presenceClients: [client({ lastActivityAtMs: Date.now() - 5_000, focusedSessionId: "s1" })],
  });
  await notifier.notifySessionComplete("s1");
  assert.equal(sent.length, 0);
});

test("全离场时 notifySessionComplete 照常发送（桌面行为不回归）", async () => {
  const { notifier, sent } = makePushEnvironment({
    presenceClients: [client({ lastActivityAtMs: Date.now() - 600_000 })],
  });
  await notifier.notifySessionComplete("s1");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.url, "/?session=s1");
});

test("没注入 listPresenceClients 的旧环境 → 回落真实 store（空）照发，测试兼容", async () => {
  const { notifier, sent } = makePushEnvironment();
  // 直接改掉注入，模拟旧测试环境没有这个方法
  const bare = createWebPushNotifier({
    send: async (subscription, payload) => {
      sent.push({ subscription, payload: JSON.parse(payload) });
    },
    loadState: () => null,
    saveState: () => {},
    generateVapidKeys: () => ({ publicKey: "pub", privateKey: "priv" }),
    listSessionNames: async () => new Map(),
  });
  bare.addSubscription({
    endpoint: "https://push.example.com/en",
    keys: { p256dh: "p", auth: "a" },
    locale: "en",
  });
  await bare.notifySessionComplete("s1");
  assert.equal(sent.length, 1);
  void notifier;
});
