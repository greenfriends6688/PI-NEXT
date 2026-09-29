import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const execFileAsync = promisify(execFile);

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");

function get(cwd) {
  return GET(new Request(`http://localhost/api/git/branch?cwd=${encodeURIComponent(cwd)}`));
}

test("cwd is required", async () => {
  const response = await GET(new Request("http://localhost/api/git/branch"));
  assert.equal(response.status, 400);
});

test("a directory outside the allowed roots is rejected", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-web-branch-denied-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const response = await get(cwd);
  assert.equal(response.status, 403);
});

test("non-git directory resolves to a null branch, not an error", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-web-branch-plain-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  allowFileRoot(cwd);

  const response = await get(cwd);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.branch, null);
  assert.equal(body.projectRoot, cwd);
});

test("git repository reports its current branch", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-web-branch-git-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  allowFileRoot(cwd);

  await execFileAsync("git", ["init", "-q", cwd]);
  await execFileAsync("git", ["-C", cwd, "config", "user.name", "Pi Web Test"]);
  await execFileAsync("git", ["-C", cwd, "config", "user.email", "pi-web-test@example.invalid"]);
  await execFileAsync("git", ["-C", cwd, "config", "commit.gpgsign", "false"]);
  await writeFile(path.join(cwd, "README.md"), "# test\n");
  await execFileAsync("git", ["-C", cwd, "add", "README.md"]);
  await execFileAsync("git", ["-C", cwd, "commit", "-m", "initial"]);
  await execFileAsync("git", ["-C", cwd, "checkout", "-q", "-b", "feature/ctxbar"]);

  const response = await get(cwd);
  assert.equal(response.status, 200);
  const body = await response.json();
  // 分支名里的 "/" 必须原样保留（git rev-parse 的第四行不是路径，不能过 toNativePath）。
  assert.equal(body.branch, "feature/ctxbar");
});
