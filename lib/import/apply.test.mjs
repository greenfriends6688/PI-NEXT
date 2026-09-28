import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
});
const { applyImports, IMPORT_APPLY_MAX_IDS } = await jiti.import("./apply.ts");
const { importedSessionId } = await jiti.import("./sessions.ts");
const { POST } = await jiti.import("../../app/api/import/apply/route.ts");

function fixtureHome(t) {
  const home = mkdtempSync(join(tmpdir(), "pi-import-apply-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function jsonl(entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function readJsonl(file) {
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function claudeSession(cwd = "/Users/me/proj") {
  return jsonl([
    {
      type: "user",
      isSidechain: false,
      cwd,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "user", content: "hello" },
    },
    {
      type: "assistant",
      isSidechain: false,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "hi" },
          { type: "tool_use", id: "t1", name: "bash", input: { command: "ls" } },
        ],
      },
    },
  ]);
}

test("ids not returned by the latest scan fail and write nothing", async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".claude", "settings.json"), JSON.stringify({
    env: { ANTHROPIC_MODEL: "claude-sonnet-4", ANTHROPIC_BASE_URL: "https://api.example.com" },
  }));

  const result = await applyImports("models", ["ghost:one", "ghost:two"], { home });
  assert.equal(result.imported, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 2);
  assert.deepEqual(result.items.map((item) => item.status), ["failed", "failed"]);
  assert.equal(result.items[0].error, "not returned by the latest scan");
  assert.ok(!existsSync(join(home, ".pi", "agent", "models.json")));
});

test("applying the same session twice skips the second run", async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".claude", "projects", "-Users-me-proj", "uuid-1.jsonl"), claudeSession());

  const first = await applyImports("sessions", ["claude:uuid-1"], { home });
  assert.equal(first.imported, 1);
  assert.equal(first.failed, 0);
  const destination = first.items[0].destination;
  assert.ok(destination && existsSync(destination));

  const second = await applyImports("sessions", ["claude:uuid-1"], { home });
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 1);
  assert.equal(second.failed, 0);
  assert.equal(second.items[0].status, "skipped");
  assert.equal(second.items[0].destination, destination);
});

test("a batch skips a colliding session and still lands the new one", async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".claude", "projects", "-Users-me-proj", "uuid-1.jsonl"), claudeSession());
  write(join(home, ".claude", "projects", "-Users-me-proj", "uuid-2.jsonl"), claudeSession());

  const first = await applyImports("sessions", ["claude:uuid-1"], { home });
  assert.equal(first.imported, 1);

  const second = await applyImports("sessions", ["claude:uuid-1", "claude:uuid-2"], { home });
  assert.equal(second.imported, 1);
  assert.equal(second.skipped, 1);
  assert.equal(second.failed, 0);
  assert.equal(second.items[0].status, "skipped");
  assert.equal(second.items[1].status, "imported");
  assert.ok(second.items[1].destination && existsSync(second.items[1].destination));
});

test("ids over the cap and non-array ids are rejected with 400", async () => {
  const overCap = await POST(new Request("http://localhost/api/import/apply", {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({
      kind: "models",
      ids: Array.from({ length: IMPORT_APPLY_MAX_IDS + 1 }, (_, index) => `id-${index}`),
    }),
  }));
  assert.equal(overCap.status, 400);

  const nonArray = await POST(new Request("http://localhost/api/import/apply", {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ kind: "models", ids: "not-an-array" }),
  }));
  assert.equal(nonArray.status, 400);

  const nonString = await POST(new Request("http://localhost/api/import/apply", {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ kind: "models", ids: [42] }),
  }));
  assert.equal(nonString.status, 400);
});

test("session conversion writes a pi header and chains parentId", async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".claude", "projects", "-Users-me-proj", "uuid-1.jsonl"), claudeSession());

  const result = await applyImports("sessions", ["claude:uuid-1"], { home });
  assert.equal(result.imported, 1);
  const lines = readJsonl(result.items[0].destination);
  const header = lines[0];
  assert.equal(header.type, "session");
  assert.equal(header.version, 3);
  assert.equal(header.id, importedSessionId("claude", "uuid-1"));
  assert.equal(header.cwd, "/Users/me/proj");

  const messages = lines.filter((entry) => entry.type === "message");
  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map((entry) => entry.message.role), ["user", "assistant", "assistant"]);
  assert.equal(messages[0].message.content, "hello");
  assert.deepEqual(messages[1].message.content, [{ type: "text", text: "hi" }]);
  assert.deepEqual(messages[2].message.content, [{ type: "text", text: "[tool: bash]" }]);
  assert.equal(messages[0].parentId, null);
  for (let index = 1; index < messages.length; index += 1) {
    assert.equal(messages[index].parentId, messages[index - 1].id);
  }
  for (const message of messages) assert.match(message.id, /^[0-9a-f]{8}$/);
});

test("pi to pi re-keys the session id and keeps the transcript", async (t) => {
  const home = fixtureHome(t);
  const source = join(home, ".pi", "agent", "sessions", "--Users-me-proj--", "src.jsonl");
  write(source, jsonl([
    { type: "session", version: 3, id: "old-id", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/Users/me/proj" },
    {
      type: "message",
      id: "aaaaaaaa",
      parentId: null,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "user", content: "hello" },
    },
    {
      type: "message",
      id: "bbbbbbbb",
      parentId: "aaaaaaaa",
      timestamp: "2026-01-01T00:00:02.000Z",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", toolCallId: "t1", toolName: "bash", input: {} }],
      },
    },
  ]));

  const result = await applyImports("sessions", ["pi:src"], { home });
  assert.equal(result.imported, 1);
  const lines = readJsonl(result.items[0].destination);
  assert.equal(lines[0].id, importedSessionId("pi", "src"));
  assert.equal(lines[0].cwd, "/Users/me/proj");
  const toolCall = lines.find((entry) => entry.message?.content?.[0]?.type === "toolCall");
  assert.ok(toolCall, "pi -> pi keeps the original toolCall block instead of textifying it");
});

test("opencode text and tool parts convert in order", async (t) => {
  const home = fixtureHome(t);
  const storage = join(home, ".local", "share", "opencode", "storage");
  write(join(storage, "session", "proj", "ses_1.json"), JSON.stringify({
    id: "ses_1",
    title: "OC",
    directory: "/Users/me/oc",
    time: { created: 1767225600000, updated: 1767225602000 },
  }));
  write(join(storage, "message", "ses_1", "m1.json"), JSON.stringify({
    id: "m1", sessionID: "ses_1", role: "user", time: { created: 1767225600000 },
  }));
  write(join(storage, "part", "m1", "p1.json"), JSON.stringify({ id: "p1", type: "text", text: "hello" }));
  write(join(storage, "message", "ses_1", "m2.json"), JSON.stringify({
    id: "m2", sessionID: "ses_1", role: "assistant", time: { created: 1767225601000 },
  }));
  write(join(storage, "part", "m2", "p1.json"), JSON.stringify({ id: "p1", type: "text", text: "hi" }));
  write(join(storage, "part", "m2", "p2.json"), JSON.stringify({
    id: "p2", type: "tool", tool: "bash", state: { status: "completed", output: "ok" },
  }));

  const result = await applyImports("sessions", ["opencode:ses_1"], { home });
  assert.equal(result.imported, 1);
  const messages = readJsonl(result.items[0].destination).filter((entry) => entry.type === "message");
  assert.deepEqual(messages.map((entry) => entry.message.content), [
    "hello",
    [{ type: "text", text: "hi" }],
    [{ type: "text", text: "[tool: bash]" }],
  ]);
  assert.equal(messages[0].parentId, null);
  assert.equal(messages[1].parentId, messages[0].id);
  assert.equal(messages[2].parentId, messages[1].id);
});

test("models apply never returns or writes a planted key and is idempotent", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-apply-models-7f3a";
  write(join(home, ".claude", "settings.json"), JSON.stringify({
    env: {
      ANTHROPIC_API_KEY: secret,
      ANTHROPIC_BASE_URL: "https://api.example.com",
      ANTHROPIC_MODEL: "claude-sonnet-4",
    },
  }));

  const result = await applyImports("models", ["claude:default"], { home });
  assert.equal(result.imported, 1);
  assert.ok(!JSON.stringify(result).includes(secret));

  const modelsPath = join(home, ".pi", "agent", "models.json");
  const written = readFileSync(modelsPath, "utf8");
  assert.ok(!written.includes(secret));
  const config = JSON.parse(written);
  assert.equal(config.providers.default.name, "Claude Code");
  assert.equal(config.providers.default.baseUrl, "https://api.example.com");
  assert.equal(config.providers.default.api, "anthropic-messages");
  assert.deepEqual(config.providers.default.models, [{ id: "claude-sonnet-4" }]);
  assert.equal(config.providers.default.apiKey, undefined);

  const second = await applyImports("models", ["claude:default"], { home });
  assert.equal(second.skipped, 1);
  assert.equal(second.imported, 0);
});

test("mcp apply never returns or writes a planted key", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-apply-mcp-9c1e";
  write(join(home, ".cursor", "mcp.json"), JSON.stringify({
    mcpServers: {
      files: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        env: { API_KEY: secret },
      },
    },
  }));

  const result = await applyImports("mcp", ["cursor:files"], { home });
  assert.equal(result.imported, 1);
  assert.ok(!JSON.stringify(result).includes(secret));

  const mcpPath = join(home, ".pi", "agent", "mcp.json");
  const written = readFileSync(mcpPath, "utf8");
  assert.ok(!written.includes(secret));
  const config = JSON.parse(written);
  assert.equal(config.mcpServers.files.command, "npx");
  assert.deepEqual(config.mcpServers.files.args, ["-y", "@modelcontextprotocol/server-filesystem"]);
  assert.equal(config.mcpServers.files.env, undefined);

  const second = await applyImports("mcp", ["cursor:files"], { home });
  assert.equal(second.skipped, 1);
  assert.equal(second.imported, 0);
});

test("session conversion keeps the newest 2000 turns and records truncation", async (t) => {
  const home = fixtureHome(t);
  const total = 2001;
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  const entries = [];
  for (let index = 0; index < total; index += 1) {
    entries.push({
      type: "user",
      isSidechain: false,
      cwd: "/Users/me/proj",
      timestamp: new Date(base + index * 1000).toISOString(),
      message: { role: "user", content: `turn-${index}` },
    });
  }
  write(join(home, ".claude", "projects", "-Users-me-proj", "big.jsonl"), jsonl(entries));

  const result = await applyImports("sessions", ["claude:big"], { home });
  assert.equal(result.imported, 1);
  assert.equal(result.items[0].error, "truncated");
  const messages = readJsonl(result.items[0].destination).filter((entry) => entry.type === "message");
  assert.equal(messages.length, 2000);
  assert.equal(messages[0].message.content, "turn-1");
  assert.equal(messages.at(-1).message.content, "turn-2000");
  assert.equal(messages[0].parentId, null);
});

test("session conversion enforces the 4 MiB byte cap keeping the newest turns", async (t) => {
  const home = fixtureHome(t);
  const payload = "x".repeat(2000);
  const total = 2500;
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  const entries = [];
  for (let index = 0; index < total; index += 1) {
    entries.push({
      type: "user",
      isSidechain: false,
      cwd: "/Users/me/proj",
      timestamp: new Date(base + index * 1000).toISOString(),
      message: { role: "user", content: `turn-${index}-${payload}` },
    });
  }
  write(join(home, ".claude", "projects", "-Users-me-proj", "bytes.jsonl"), jsonl(entries));

  const result = await applyImports("sessions", ["claude:bytes"], { home });
  assert.equal(result.imported, 1);
  assert.equal(result.items[0].error, "truncated");
  const raw = readFileSync(result.items[0].destination);
  assert.ok(raw.byteLength <= 4 * 1024 * 1024, `file is ${raw.byteLength} bytes`);
  const messages = readJsonl(result.items[0].destination).filter((entry) => entry.type === "message");
  assert.ok(messages.length > 0 && messages.length < total);
  assert.equal(messages.at(-1).message.content, `turn-${total - 1}-${payload}`);
});

test("models apply never overwrites an existing provider or a corrupt file", async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".claude", "settings.json"), JSON.stringify({
    env: { ANTHROPIC_MODEL: "claude-sonnet-4", ANTHROPIC_BASE_URL: "https://api.example.com" },
  }));
  const modelsPath = join(home, ".pi", "agent", "models.json");
  write(modelsPath, JSON.stringify({ providers: { default: { name: "Mine", apiKey: "keep-me" } } }));

  const existing = await applyImports("models", ["claude:default"], { home });
  assert.equal(existing.skipped, 1);
  const config = JSON.parse(readFileSync(modelsPath, "utf8"));
  assert.equal(config.providers.default.name, "Mine");
  assert.equal(config.providers.default.apiKey, "keep-me");

  write(modelsPath, "{ not json");
  const broken = await applyImports("models", ["claude:default"], { home });
  assert.equal(broken.failed, 1);
  assert.equal(broken.items[0].error, "malformed JSON");
  assert.equal(readFileSync(modelsPath, "utf8"), "{ not json");
});

test("the route response body never contains a planted key", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-apply-route-2d8b";
  write(join(home, ".claude", "settings.json"), JSON.stringify({
    env: { ANTHROPIC_API_KEY: secret, ANTHROPIC_MODEL: "claude-sonnet-4" },
  }));

  const previousHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });

  const response = await POST(new Request("http://localhost/api/import/apply", {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ kind: "models", ids: ["claude:default"] }),
  }));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes(secret));
  const body = JSON.parse(text);
  assert.equal(body.imported, 1);
  assert.equal(body.failed, 0);
  assert.ok(!readFileSync(join(home, ".pi", "agent", "models.json"), "utf8").includes(secret));
});

test("skill import copies the directory and refuses to overwrite it", async (t) => {
  const home = fixtureHome(t);
  write(
    join(home, ".claude", "skills", "alpha", "SKILL.md"),
    "---\nname: alpha-skill\ndescription: Alpha\n---\n\nBody\n",
  );
  write(join(home, ".claude", "skills", "alpha", "helper.md"), "helper\n");

  const first = await applyImports("skills", [`claude:${join(home, ".claude", "skills", "alpha", "SKILL.md")}`], { home });
  assert.equal(first.imported, 1);
  assert.equal(first.items[0].destination, join(home, ".agents", "skills", "alpha-skill"));
  assert.ok(existsSync(join(home, ".agents", "skills", "alpha-skill", "SKILL.md")));
  assert.ok(existsSync(join(home, ".agents", "skills", "alpha-skill", "helper.md")));

  const second = await applyImports("skills", [`claude:${join(home, ".claude", "skills", "alpha", "SKILL.md")}`], { home });
  assert.equal(second.skipped, 1);
  assert.deepEqual(readdirSync(join(home, ".agents", "skills")), ["alpha-skill"]);
});
