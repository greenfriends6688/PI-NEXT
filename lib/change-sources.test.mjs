import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadSubject() {
  return jiti.import("./change-sources.ts");
}

test("hides files under dot-directories but keeps root dotfiles", async () => {
  const { isHiddenChangePath } = await loadSubject();
  assert.equal(isHiddenChangePath("src/a.ts"), false);
  assert.equal(isHiddenChangePath("src/nested/a.ts"), false);
  assert.equal(isHiddenChangePath(".gitignore"), false);
  assert.equal(isHiddenChangePath(".env.example"), false);
  assert.equal(isHiddenChangePath(".git/config"), true);
  assert.equal(isHiddenChangePath(".github/workflows/ci.yml"), true);
  assert.equal(isHiddenChangePath("src/.cache/a.ts"), true);
  assert.equal(isHiddenChangePath("src/.cache/nested/a.ts"), true);
  assert.equal(isHiddenChangePath("C:\\repo\\.idea\\workspace.xml"), true);
  assert.equal(isHiddenChangePath("C:\\repo\\src\\a.ts"), false);
});

test("makes a path relative to the workspace without treating the workspace's own dotted parent as hidden", async () => {
  const { isHiddenChangePath, workspaceRelativePath } = await loadSubject();
  assert.equal(workspaceRelativePath("/repo/src/a.ts", "/repo"), "src/a.ts");
  const underDottedRoot = workspaceRelativePath("/home/me/.config/proj/src/a.ts", "/home/me/.config/proj");
  assert.equal(underDottedRoot, "src/a.ts");
  assert.equal(isHiddenChangePath(underDottedRoot), false);
  // Outside the workspace the absolute path is kept so its dot dirs still filter.
  assert.equal(isHiddenChangePath(workspaceRelativePath("/other/.hidden/a.ts", "/repo")), true);
});

test("non-git projects fall back to the session's written files", async () => {
  const { mergeChangeSources } = await loadSubject();
  const changes = mergeChangeSources({
    cwd: "/repo",
    git: { isGitRepository: false, repositoryRoot: null, files: [], additions: 0, deletions: 0 },
    writtenFiles: [{ filePath: "/repo/src/a.ts" }, { filePath: "/repo/.vscode/settings.json" }],
  });
  assert.deepEqual(changes, [{ filePath: "/repo/src/a.ts", source: "session" }]);
});

test("git repositories ignore the session fallback and keep git metadata", async () => {
  const { mergeChangeSources } = await loadSubject();
  const changes = mergeChangeSources({
    cwd: "/repo",
    git: {
      isGitRepository: true,
      repositoryRoot: "/repo",
      files: [{
        filePath: "/repo/src/a.ts",
        status: "modified",
        code: "M",
        indexStatus: " ",
        worktreeStatus: "M",
        additions: 3,
        deletions: 1,
      }],
      additions: 3,
      deletions: 1,
    },
    writtenFiles: [{ filePath: "/repo/src/only-session.ts" }],
  });
  assert.deepEqual(changes, [{
    filePath: "/repo/src/a.ts",
    source: "git",
    status: "modified",
    additions: 3,
    deletions: 1,
    repositoryRoot: "/repo",
  }]);
});

test("memory changes always merge and dedupe by samePath", async () => {
  const { mergeChangeSources } = await loadSubject();
  const changes = mergeChangeSources({
    cwd: "/repo",
    git: {
      isGitRepository: true,
      repositoryRoot: "/repo",
      files: [{
        filePath: "/repo/AGENTS.md",
        status: "modified",
        code: "M",
        indexStatus: " ",
        worktreeStatus: "M",
      }],
      additions: 0,
      deletions: 0,
    },
    memoryFiles: [{ filePath: "/repo/AGENTS.md" }, { filePath: "/repo/memory/fact.md" }],
  });
  assert.deepEqual(changes.map((entry) => [entry.filePath, entry.source]), [
    ["/repo/AGENTS.md", "git"],
    ["/repo/memory/fact.md", "memory"],
  ]);
});

test("summarizeChanges only counts the filtered list", async () => {
  const { summarizeChanges } = await loadSubject();
  assert.deepEqual(summarizeChanges([
    { filePath: "/repo/a.ts", source: "git", additions: 2, deletions: 1 },
    { filePath: "/repo/b.ts", source: "git", additions: null, deletions: null },
    { filePath: "/repo/c.ts", source: "session" },
  ]), { additions: 2, deletions: 1 });
});
