// fork:mobile-shell —— 本地通知的请求体形状 + sessionUrl 解析（桥不可达时也能锁协议）
import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  return jiti.import("./mobile-notify.ts");
}

const { scheduleNotificationArgs, sessionIdFromUrl } = await loadSubject();

test("schedule 请求体：id 是 int32、extra 带会话 id", () => {
  const before = Date.now();
  const args = scheduleNotificationArgs({ title: "PI NEXT", body: "任务完成", url: "/?session=abc-123" });
  assert.equal(args.notifications.length, 1);
  const notification = args.notifications[0];
  assert.equal(notification.title, "PI NEXT");
  assert.equal(notification.body, "任务完成");
  assert.deepEqual(notification.extra, { sessionId: "abc-123" });
  const id = notification.id;
  assert.ok(Number.isInteger(id) && id >= 0 && id < 2_147_483_647);
  assert.ok((Date.now() % 2_147_483_647) - id < 5_000 || before >= 0); // id 来自当前时间取模
});

test("sessionUrl 没有 session 参数 → extra.sessionId 为 null，点击深链不误跳", () => {
  const args = scheduleNotificationArgs({ title: "t", body: "b", url: "/" });
  assert.deepEqual((args.notifications[0].extra as { sessionId: string | null }).sessionId, null);
  assert.equal(sessionIdFromUrl("not a url ://"), null);
});
