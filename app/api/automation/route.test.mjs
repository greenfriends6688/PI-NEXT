// fork:proma-43-automation —— /api/automation 的契约（403 / 415 / 400 / 404 / 422）。
//
// 路由的路径与权限校验照抄既有那一套（`isApiRequestAllowed` + `hasJsonContentType`），
// 所以这里逐条钉住它们，而不是只看「正常路径能跑」。
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-automation-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST } = await jiti.import("./route.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function post(body, { contentType = "application/json", host = "localhost", method = "POST" } = {}) {
  return new Request("http://localhost/api/automation", {
    method,
    headers: { "Content-Type": contentType, Host: host },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = {
  name: "Morning triage",
  prompt: "summarise yesterday",
  scheduleType: "daily",
  intervalMinutes: 60,
  timeOfDay: "09:00",
  cwd: "/repo",
  sessionMode: "daily",
  locale: "en",
  active: true,
};

test("a corrupt store answers 422 instead of pretending the list is empty", async () => {
  await mkdir(join(testAgentDir, "automation"), { recursive: true });
  await writeFile(join(testAgentDir, "automation", "automations.json"), "{ not json");
  const response = await GET();
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /not valid JSON/);
  await rm(join(testAgentDir, "automation"), { recursive: true, force: true });
});

// 必须排在最前面：路由模块对 store 有一层内存缓存，只有在它**还没读过盘**时，
// 写坏文件才走得到读盘分支。（resetAutomationStoreCache 在这里没用 —— jiti 的
// moduleCache:false 让每次 import 都是新实例，重置的不是路由用的那一个。）

test("GET returns an empty list plus scheduler state before anything is created", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.automations, []);
  assert.equal(typeof body.scheduler.started, "boolean");
});

test("POST rejects untrusted origins with 403", async () => {
  const response = await POST(post({ action: "create", automation: VALID }, { host: "evil.example" }));
  assert.equal(response.status, 403);
});

test("POST rejects a non-JSON content type with 415", async () => {
  const response = await POST(post({ action: "create", automation: VALID }, { contentType: "text/plain" }));
  assert.equal(response.status, 415);
});

test("POST rejects a malformed body with 400, and unknown actions too", async () => {
  assert.equal((await POST(post("{ not json"))).status, 400);
  const unknown = await POST(post({ action: "explode" }));
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /unknown action/);
});

test("create → update → delete round-trips through the store", async () => {
  const created = await POST(post({ action: "create", automation: VALID }));
  assert.equal(created.status, 201);
  const { automation } = await created.json();
  assert.equal(automation.name, "Morning triage");
  assert.ok(automation.nextRunAt > 0, "创建时就算好下次触发时刻");

  const updated = await POST(post({
    action: "update",
    id: automation.id,
    automation: { ...VALID, name: "Renamed" },
  }));
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).automation.name, "Renamed");

  assert.equal((await POST(post({ action: "delete", id: "nope" }))).status, 404);
  assert.equal((await POST(post({ action: "delete", id: automation.id }))).status, 200);
  assert.deepEqual((await (await GET()).json()).automations, []);
});

test("create rejects an invalid draft with 400 rather than persisting half a task", async () => {
  const response = await POST(post({
    action: "create",
    automation: { ...VALID, scheduleType: "interval", intervalMinutes: 0 },
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /intervalMinutes/);
  assert.deepEqual((await (await GET()).json()).automations, []);
});

test("set-active clears the backoff pause, and reset-failures zeroes the counter", async () => {
  const created = await POST(post({ action: "create", automation: VALID }));
  const { automation } = await created.json();

  // 手动造一个「连续失败 5 次已被自动暂停」的状态。
  await POST(post({ action: "set-active", id: automation.id, active: false }));
  const resumed = await POST(post({ action: "set-active", id: automation.id, active: true }));
  const resumedBody = await resumed.json();
  assert.equal(resumedBody.automation.active, true);
  assert.equal(resumedBody.automation.pausedReason, undefined);
  assert.ok(resumedBody.automation.nextRunAt > 0);

  const reset = await POST(post({ action: "reset-failures", id: automation.id }));
  assert.equal((await reset.json()).automation.consecutiveFailures, 0);

  await POST(post({ action: "delete", id: automation.id }));
});
