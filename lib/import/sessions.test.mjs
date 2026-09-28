import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  OPENCODE_MAX_MESSAGE_FILES,
  SESSIONS_MAX_FILES,
  SESSIONS_FULL_PARSE_MAX_BYTES,
  encodeSessionDirName,
  importedSessionId,
  scanSessionImports,
} = await jiti.import("./sessions.ts");

function fixtureHome(t) {
  const home = mkdtempSync(join(tmpdir(), "pi-import-sessions-"));
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

const piHeader = (cwd = "/Users/me/proj") => ({
  type: "session",
  version: 3,
  id: "ignored-for-id",
  timestamp: "2026-01-01T00:00:00.000Z",
  cwd,
});

const piMessage = (id, timestamp, role, content) => ({
  type: "message",
  id,
  parentId: null,
  timestamp,
  message: { role, content },
});

test("importedSessionId and encodeSessionDirName are stable derivations", () => {
  assert.equal(importedSessionId("pi", "abc"), "import-pi-abc");
  assert.equal(encodeSessionDirName("/Users/me/proj"), "--Users-me-proj--");
  assert.equal(encodeSessionDirName("C:\\work\\app"), "--C--work-app--");
});

test("pi: header/title/count and encoded destination", async (t) => {
  const home = fixtureHome(t);
  const file = join(home, ".pi", "agent", "sessions", "--Users-me-proj--", "sess-1.jsonl");
  write(file, jsonl([
    piHeader(),
    piMessage("m1", "2026-01-01T00:00:01.000Z", "user", "hello"),
    { type: "session_info", id: "s1", parentId: null, timestamp: "2026-01-01T00:00:02.000Z", name: "Named session" },
    piMessage("m2", "2026-01-01T00:00:03.000Z", "assistant", [{ type: "text", text: "hi" }]),
  ]));

  const result = await scanSessionImports({ home });
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.id, "pi:sess-1");
  assert.equal(importedSessionId("pi", "sess-1"), "import-pi-sess-1");
  assert.equal(candidate.source, "pi");
  assert.equal(candidate.title, "Named session");
  assert.equal(candidate.projectPath, "/Users/me/proj");
  assert.equal(candidate.messageCount, 2);
  assert.equal(candidate.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(candidate.updatedAt, "2026-01-01T00:00:03.000Z");
  assert.equal(
    candidate.destination,
    join(home, ".pi", "agent", "sessions", encodeSessionDirName("/Users/me/proj")),
  );
});

test("claude: synthetic user lines are not the title and sidechains are ignored", async (t) => {
  const home = fixtureHome(t);
  const file = join(home, ".claude", "projects", "-Users-me-proj", "uuid-1.jsonl");
  write(file, jsonl([
    { type: "user", isSidechain: false, cwd: "/Users/me/proj", timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: "<command-name>/clear</command-name>" } },
    { type: "user", isSidechain: false, cwd: "/Users/me/proj", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "Real question" } },
    { type: "assistant", isSidechain: true, timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", content: "sidechain noise" } },
    { type: "assistant", isSidechain: false, timestamp: "2026-01-01T00:00:03.000Z", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } },
  ]));

  const result = await scanSessionImports({ home });
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.id, "claude:uuid-1");
  assert.equal(candidate.title, "Real question");
  assert.equal(candidate.messageCount, 3);
  assert.equal(candidate.updatedAt, "2026-01-01T00:00:03.000Z");
});

test("codex: both the wrapper shape and the bare shape parse, and '# Role:' is a real prompt", async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".codex", "sessions", "2026", "01", "02", "rollout-new.jsonl"), jsonl([
    { timestamp: "2026-01-02T00:00:00.000Z", type: "session_meta", payload: { id: "codex-id-1", cwd: "/Users/me/codex", timestamp: "2026-01-02T00:00:00.000Z" } },
    { timestamp: "2026-01-02T00:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md\nsynthetic" }] } },
    { timestamp: "2026-01-02T00:00:02.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# Role: pirate\nReal prompt" }] } },
  ]));
  write(join(home, ".codex", "sessions", "2025", "12", "31", "rollout-old.jsonl"), jsonl([
    { id: "codex-id-2", timestamp: "2025-12-31T00:00:00.000Z", cwd: "/Users/me/old" },
    { type: "message", role: "user", timestamp: "2025-12-31T00:00:01.000Z", content: [{ type: "input_text", text: "hello old" }] },
    { type: "function_call", timestamp: "2025-12-31T00:00:02.000Z" },
    { type: "function_call_output", timestamp: "2025-12-31T00:00:03.000Z" },
  ]));

  const result = await scanSessionImports({ home });
  assert.equal(result.candidates.length, 2);
  const newer = result.candidates.find((candidate) => candidate.id === "codex:rollout-new");
  const older = result.candidates.find((candidate) => candidate.id === "codex:rollout-old");
  assert.ok(newer);
  assert.equal(newer.title, "# Role: pirate\nReal prompt".replace(/\s+/g, " "));
  assert.equal(newer.messageCount, 2);
  assert.ok(older);
  assert.equal(older.title, "hello old");
  assert.equal(older.messageCount, 3);
  assert.equal(older.projectPath, "/Users/me/old");
});

test("opencode: session id is the external id and message count comes from the message dir", async (t) => {
  const home = fixtureHome(t);
  const storage = join(home, ".local", "share", "opencode", "storage");
  write(join(storage, "session", "proj-hash", "ses_1.json"), JSON.stringify({
    id: "ses_1",
    title: "OpenCode session",
    directory: "/Users/me/oc",
    time: { created: 1767225600000, updated: 1767225605000 },
  }));
  write(join(storage, "message", "ses_1", "m1.json"), JSON.stringify({ id: "m1" }));
  write(join(storage, "message", "ses_1", "m2.json"), JSON.stringify({ id: "m2" }));

  const result = await scanSessionImports({ home });
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.id, "opencode:ses_1");
  assert.equal(candidate.externalId, "ses_1");
  assert.equal(candidate.title, "OpenCode session");
  assert.equal(candidate.messageCount, 2);
  assert.equal(candidate.projectPath, "/Users/me/oc");
});

test("malformed lines are skipped and an out-of-range timestamp falls back to the mtime", async (t) => {
  const home = fixtureHome(t);
  const file = join(home, ".pi", "agent", "sessions", "--x--", "broken.jsonl");
  write(file, `not json at all\n${JSON.stringify({ ...piHeader(), timestamp: "2026-13-45T99:00:00.000Z" })}\n{"type":"message","id":\n${JSON.stringify(piMessage("m1", "2026-01-01T00:00:00.000Z", "user", "still parsed"))}\n`);
  const result = await scanSessionImports({ home });
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.title, "still parsed");
  assert.equal(candidate.createdAt, new Date(statSync(file).mtimeMs).toISOString());
});

test("a whitespace-only first message yields no title, never an empty string", async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".pi", "agent", "sessions", "--x--", "blank.jsonl"), jsonl([
    piHeader("/Users/me/blank"),
    piMessage("m1", "2026-01-01T00:00:01.000Z", "user", "   "),
  ]));
  const result = await scanSessionImports({ home });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].title, undefined);
  assert.notEqual(result.candidates[0].title, "");
});

test("message bodies never reach the scan result", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-sessions-body-1a2b";
  write(join(home, ".pi", "agent", "sessions", "--x--", "secretive.jsonl"), jsonl([
    piHeader("/Users/me/secretive"),
    piMessage("m1", "2026-01-01T00:00:01.000Z", "user", "visible title"),
    piMessage("m2", "2026-01-01T00:00:02.000Z", "assistant", `answer ${secret}`),
  ]));
  const result = await scanSessionImports({ home });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].title, "visible title");
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("missing stores produce empty diagnostics instead of throwing", async (t) => {
  const home = fixtureHome(t);
  const result = await scanSessionImports({ home });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.sources.length, 4);
  for (const source of result.sources) {
    assert.equal(source.exists, false);
    assert.equal(source.count, 0);
    assert.equal(source.kind, "sessions");
  }
});

test("a corrupt opencode file becomes a diagnostic and never leaks the planted key", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-sessions-4f21";
  write(
    join(home, ".local", "share", "opencode", "storage", "session", "proj", "broken.json"),
    `{"id":"ses_x","apiKey":"${secret}",`,
  );
  const result = await scanSessionImports({ home });
  assert.deepEqual(result.candidates, []);
  const broken = result.sources.find((source) => source.path.endsWith("broken.json"));
  assert.ok(broken);
  assert.equal(broken.exists, true);
  assert.equal(broken.error, "malformed JSON");
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("oversized transcripts are sampled: header/title from the head, timestamp from the tail, count null", async (t) => {
  const home = fixtureHome(t);
  const file = join(home, ".pi", "agent", "sessions", "--x--", "huge.jsonl");
  const lines = [
    JSON.stringify(piHeader("/Users/me/huge")),
    JSON.stringify(piMessage("m1", "2026-01-01T00:00:01.000Z", "user", "head title")),
  ];
  let bytes = lines.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0);
  while (bytes <= SESSIONS_FULL_PARSE_MAX_BYTES + 4096) {
    const filler = JSON.stringify({ type: "padding", data: "x".repeat(2048) });
    lines.push(filler);
    bytes += Buffer.byteLength(filler) + 1;
  }
  lines.push(JSON.stringify(piMessage("m2", "2026-02-02T00:00:00.000Z", "assistant", "tail timestamp")));
  write(file, `${lines.join("\n")}\n`);

  const result = await scanSessionImports({ home });
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.title, "head title");
  assert.equal(candidate.updatedAt, "2026-02-02T00:00:00.000Z");
  assert.equal(candidate.messageCount, null);
});

test("opencode message counting stops at the cap and reports an unknown count", async (t) => {
  const home = fixtureHome(t);
  const storage = join(home, ".local", "share", "opencode", "storage");
  write(join(storage, "session", "proj", "ses_big.json"), JSON.stringify({ id: "ses_big", title: "Big" }));
  mkdirSync(join(storage, "message", "ses_big"), { recursive: true });
  for (let index = 0; index <= OPENCODE_MAX_MESSAGE_FILES; index += 1) {
    writeFileSync(join(storage, "message", "ses_big", `m-${String(index).padStart(5, "0")}.json`), "{}");
  }
  const result = await scanSessionImports({ home });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].messageCount, null);
});

test(`the ${SESSIONS_MAX_FILES}-file ceiling holds and reports truncation`, async (t) => {
  const home = fixtureHome(t);
  const total = SESSIONS_MAX_FILES + 5;
  for (let index = 0; index < total; index += 1) {
    const name = `sess-${String(index).padStart(4, "0")}`;
    write(join(home, ".pi", "agent", "sessions", "--x--", `${name}.jsonl`), jsonl([
      piHeader("/Users/me/cap"),
      piMessage("m1", "2026-01-01T00:00:01.000Z", "user", `message ${index}`),
    ]));
  }

  const result = await scanSessionImports({ home });
  assert.equal(result.candidates.length, SESSIONS_MAX_FILES);
  const piSource = result.sources.find((source) => source.source === "pi");
  assert.ok(piSource);
  assert.equal(piSource.truncated, true);
  assert.equal(piSource.exists, true);
});
