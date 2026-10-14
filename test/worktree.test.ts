import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConversationCatalog } from "../src/main/engine/conversation-catalog.ts";
import {
  defaultWorktreeDir,
  defaultWorktreePath,
  expandUserPath,
  isManagedWorktreePath,
  parseWorktreePorcelain,
  sanitizeSegment,
  worktreeHome,
} from "../src/main/engine/worktree.ts";

test("default worktree paths live under ~/.pinext/worktree/<project-name>", () => {
  const home = "/Users/demo";
  assert.equal(worktreeHome(home), join(home, ".pinext", "worktree"));
  assert.equal(defaultWorktreeDir("Pinext", home), join(home, ".pinext", "worktree", "pinext"));
  assert.equal(
    defaultWorktreePath("Pinext", "feat auth", home),
    join(home, ".pinext", "worktree", "pinext", "feat-auth"),
  );
});

test("sanitizeSegment strips junk and keeps a usable folder name", () => {
  assert.equal(sanitizeSegment("Feat: Auth / Login"), "feat-auth-login");
  assert.equal(sanitizeSegment("..."), "");
  assert.equal(sanitizeSegment("A".repeat(80)).length, 64);
});

test("expandUserPath resolves a leading tilde against the given home", () => {
  assert.equal(expandUserPath("~/wt/demo", "/Users/demo"), join("/Users/demo", "wt", "demo"));
  assert.equal(expandUserPath("~", "/Users/demo"), "/Users/demo");
  assert.equal(expandUserPath("/abs/path", "/Users/demo"), "/abs/path");
});

test("isManagedWorktreePath only matches Pinext-owned roots", () => {
  const home = "/Users/demo";
  const owned = join(home, ".pinext", "worktree", "pinext", "run-abc");
  const extra = join("/tmp", "app-wt");
  assert.equal(isManagedWorktreePath(owned, [], home), true);
  assert.equal(isManagedWorktreePath(join(extra, "run"), [extra], home), true);
  assert.equal(isManagedWorktreePath("/Users/demo/code/pinext", [], home), false);
  assert.equal(isManagedWorktreePath(join(home, ".pinext-other", "wt"), [], home), false);
});

test("parseWorktreePorcelain reads path, branch and detached HEAD", () => {
  const parsed = parseWorktreePorcelain(
    [
      "worktree /repo",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /repo/.pinext/wt/run",
      "HEAD def",
      "detached",
      "",
    ].join("\n"),
  );
  assert.deepEqual(parsed, [
    { path: "/repo", head: "abc", branch: "main" },
    { path: "/repo/.pinext/wt/run", head: "def", detached: true },
  ]);
});

test("catalog setWorktree binds cwd to the checkout and keeps the project", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pinext-wt-catalog-"));
  const cat = new ConversationCatalog(join(dir, "conversations.json"), join(dir, "scratch"));
  const created = cat.create("/tmp/demo");
  const updated = cat.setWorktree(created.id, { path: "/tmp/wt/demo", branch: "pinext/run" });
  assert.equal(updated?.project, "/tmp/demo");
  assert.equal(updated?.cwd, "/tmp/wt/demo");
  assert.deepEqual(updated?.worktree, { path: "/tmp/wt/demo", branch: "pinext/run" });

  const restored = cat.setWorktree(created.id, undefined);
  assert.equal(restored?.cwd, "/tmp/demo");
  assert.equal(restored?.worktree, undefined);
});

test("catalog setProject clears a bound worktree and restores cwd", () => {
  const dir = mkdtempSync(join(tmpdir(), "pinext-wt-project-"));
  const cat = new ConversationCatalog(join(dir, "conversations.json"), join(dir, "scratch"));
  const created = cat.create("/tmp/demo");
  cat.setWorktree(created.id, { path: "/tmp/wt/demo", branch: "pinext/run" });
  const next = cat.setProject(created.id, "/tmp/other");
  assert.equal(next?.project, "/tmp/other");
  assert.equal(next?.cwd, "/tmp/other");
  assert.equal(next?.worktree, undefined);
  assert.equal(resolve(next?.cwd ?? ""), resolve("/tmp/other"));
});
