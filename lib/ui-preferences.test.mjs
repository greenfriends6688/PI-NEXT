import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  isValidKey,
  parsePreferencePatch,
  readUiPreferences,
  uiPreferencesPath,
  writeUiPreferences,
} = await jiti.import("./ui-preferences.ts");

function agentDir() {
  return mkdtempSync(join(tmpdir(), "pi-web-prefs-"));
}

test("writes each key with a timestamp and reads it back", async () => {
  const dir = agentDir();
  const saved = await writeUiPreferences([{ key: "pi-theme", value: "dark" }], 1000, dir);
  assert.deepEqual(saved.preferences["pi-theme"], { value: "dark", updatedAt: 1000 });
  assert.equal(readUiPreferences(dir).preferences["pi-theme"].value, "dark");
  // 文件是逐条 JSON，方便人手改与排查。
  const onDisk = JSON.parse(readFileSync(uiPreferencesPath(dir), "utf8"));
  assert.equal(onDisk.preferences["pi-theme"].value, "dark");
});

test("merges per key: a second write keeps keys it did not touch", async () => {
  const dir = agentDir();
  await writeUiPreferences([{ key: "pi-theme", value: "dark" }], 1000, dir);
  const saved = await writeUiPreferences([{ key: "pi-chat-content-font-size", value: "18" }], 2000, dir);
  assert.equal(saved.preferences["pi-theme"].value, "dark");
  assert.equal(saved.preferences["pi-chat-content-font-size"].value, "18");
});

test("a newer write wins, an older one does not overwrite it", async () => {
  const dir = agentDir();
  await writeUiPreferences([{ key: "pi-locale", value: "zh-CN" }], 5000, dir);
  const older = await writeUiPreferences([{ key: "pi-locale", value: "en" }], 1000, dir);
  assert.equal(older.preferences["pi-locale"].value, "zh-CN", "a stale client must not win");
  const newer = await writeUiPreferences([{ key: "pi-locale", value: "en" }], 9000, dir);
  assert.equal(newer.preferences["pi-locale"].value, "en");
});

test("a corrupt or missing file reads as no preferences", async () => {
  const dir = agentDir();
  assert.deepEqual(readUiPreferences(dir), { version: 1, preferences: {} });
  writeFileSync(uiPreferencesPath(dir), "{not json");
  assert.deepEqual(readUiPreferences(dir), { version: 1, preferences: {} });
});

test("only well-formed keys and values are accepted", () => {
  assert.equal(isValidKey("pi-theme"), true);
  assert.equal(isValidKey(""), false);
  assert.equal(isValidKey("has space"), false);
  assert.equal(isValidKey("x".repeat(200)), false);
  assert.deepEqual(
    parsePreferencePatch({ "pi-theme": "dark", "bad key": "x", "pi-locale": 5 }),
    [{ key: "pi-theme", value: "dark" }],
  );
});

test("an empty patch changes nothing on disk", async () => {
  const dir = agentDir();
  await writeUiPreferences([{ key: "pi-theme", value: "dark" }], 1000, dir);
  const before = readFileSync(uiPreferencesPath(dir), "utf8");
  const saved = await writeUiPreferences([], 2000, dir);
  assert.equal(saved.preferences["pi-theme"].value, "dark");
  assert.equal(readFileSync(uiPreferencesPath(dir), "utf8"), before);
});
