import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { legacyUserDataSource } = require("./legacy-user-data.js");

const APP = "PI NEXT";
const LEGACY = ["Pinkslab", "Pi Codex", "pi-web"];

function sandbox(dirs = []) {
  const dir = mkdtempSync(join(tmpdir(), "pi-next-"));
  for (const name of dirs) mkdirSync(join(dir, name));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("fresh install: nothing to migrate", () => {
  const s = sandbox();
  assert.equal(legacyUserDataSource(s.dir, APP, LEGACY), null);
  s.done();
});

test("migrates from the newest legacy name when both exist", () => {
  const s = sandbox(["pi-web", "Pi Codex", "Pinkslab"]);
  assert.equal(legacyUserDataSource(s.dir, APP, LEGACY), join(s.dir, "Pinkslab"));
  s.done();
});

test("falls back to the oldest name when only it exists", () => {
  const s = sandbox(["pi-web"]);
  assert.equal(legacyUserDataSource(s.dir, APP, LEGACY), join(s.dir, "pi-web"));
  s.done();
});

test("skips the migration once the current directory exists", () => {
  const s = sandbox([APP, "Pi Codex"]);
  assert.equal(legacyUserDataSource(s.dir, APP, LEGACY), null);
  s.done();
});
