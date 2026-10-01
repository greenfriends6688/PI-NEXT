// fork:upstream-0.9.3-retry-settings — GET/PUT 的契约（含 415/403/422/400）
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-retry-route-"));
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
  return new Request("http://localhost/api/retry-settings", {
    method: "PUT",
    headers: { "Content-Type": contentType, Host: "localhost" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("GET returns pi's built-in defaults before anything is written", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, maxRetries: 3, baseDelayMs: 2000 });
});

test("PUT persists each field and answers with the settings re-read from disk", async () => {
  let response = await PUT(request({ maxRetries: 5 }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, maxRetries: 5, baseDelayMs: 2000 });

  response = await PUT(request({ baseDelayMs: 750 }));
  assert.deepEqual(await response.json(), { enabled: true, maxRetries: 5, baseDelayMs: 750 });

  response = await PUT(request({ enabled: false }));
  assert.deepEqual(await response.json(), { enabled: false, maxRetries: 5, baseDelayMs: 750 });

  const stored = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.deepEqual(stored.retry, { maxRetries: 5, baseDelayMs: 750, enabled: false });
});

test("invalid bodies are 400 and leave the file untouched", async () => {
  const before = await readFile(settingsPath, "utf8");
  for (const body of [{}, { enabled: "no" }, { maxRetries: 21 }, { maxAgentDelayMs: 5 }, "not json"]) {
    const response = await PUT(request(body));
    assert.equal(response.status, 400, `should reject ${JSON.stringify(body)}`);
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.equal(await readFile(settingsPath, "utf8"), before);
});

test("a non-JSON content type is 415 and an untrusted host is 403", async () => {
  const wrongType = await PUT(new Request("http://localhost/api/retry-settings", {
    method: "PUT",
    headers: { "Content-Type": "text/plain", Host: "localhost" },
    body: "enabled=false",
  }));
  assert.equal(wrongType.status, 415);

  const untrusted = await PUT(new Request("http://localhost/api/retry-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Host: "evil.example" },
    body: JSON.stringify({ enabled: false }),
  }));
  assert.equal(untrusted.status, 403);
});

test("a broken settings.json is 422 on both verbs, and never gets overwritten", async () => {
  await writeFile(settingsPath, "{ broken");
  const get = await GET();
  assert.equal(get.status, 422);
  const put = await PUT(request({ maxRetries: 2 }));
  assert.equal(put.status, 422);
  assert.equal(await readFile(settingsPath, "utf8"), "{ broken");
});