// fork:pr12-a6-thinking-budget — GET/PUT 的契约（含 415/403/422/400）
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-thinking-budget-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

const settingsPath = join(testAgentDir, "settings.json");

function request(body, contentType = "application/json") {
  return new Request("http://localhost/api/thinking-budget-settings", {
    method: "PUT",
    headers: { "Content-Type": contentType, Host: "localhost" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("GET returns pi-ai's built-in defaults before anything is written", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { minimal: 1024, low: 2048, medium: 8192, high: 16384 });
});

test("PUT persists each level and answers with the settings re-read from disk", async () => {
  let response = await PUT(request({ high: 32768 }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).high, 32768);

  response = await PUT(request({ medium: 12000, low: 3000 }));
  const body = await response.json();
  assert.equal(body.medium, 12000);
  assert.equal(body.low, 3000);
  assert.equal(body.minimal, 1024);

  // 把某档改回内建默认 = 删掉那个键，不是写一份一模一样的值。
  response = await PUT(request({ medium: 8192 }));
  const stored = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.deepEqual(stored.thinkingBudgets, { high: 32768, low: 3000 });
  assert.equal((await response.json()).medium, 8192);
});

test("invalid bodies are 400 and leave the file untouched", async () => {
  const before = await readFile(settingsPath, "utf8");
  for (const body of [
    {},
    { minimal: 0 },
    { low: 1.5 },
    { high: "16384" },
    { off: 1024 },
    { xhigh: 32768 },
    { unknown: 1 },
    "not json",
  ]) {
    const response = await PUT(request(body));
    assert.equal(response.status, 400, `should reject ${JSON.stringify(body)}`);
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.equal(await readFile(settingsPath, "utf8"), before);
});

test("a non-JSON content type is 415 and an untrusted host is 403", async () => {
  const wrongType = await PUT(new Request("http://localhost/api/thinking-budget-settings", {
    method: "PUT",
    headers: { "Content-Type": "text/plain", Host: "localhost" },
    body: "high=1",
  }));
  assert.equal(wrongType.status, 415);

  const untrusted = await PUT(new Request("http://localhost/api/thinking-budget-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Host: "evil.example" },
    body: JSON.stringify({ high: 1 }),
  }));
  assert.equal(untrusted.status, 403);
});

test("a broken settings.json is 422 on both verbs, and never gets overwritten", async () => {
  await writeFile(settingsPath, "{ broken");
  assert.equal((await GET()).status, 422);
  assert.equal((await PUT(request({ high: 1 }))).status, 422);
  assert.equal(await readFile(settingsPath, "utf8"), "{ broken");
});
