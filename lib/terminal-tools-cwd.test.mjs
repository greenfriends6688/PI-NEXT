import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { resolveAgentTerminalCwd } = await jiti.import("./terminal-tools-cwd.ts");

function workspace() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-web-term-cwd-")));
  mkdirSync(join(root, "repo"));
  mkdirSync(join(root, "repo", "packages"));
  writeFileSync(join(root, "repo", "README.md"), "# hi\n");
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "pi-web-term-outside-")));
  writeFileSync(join(outside, "secret.txt"), "nope\n");
  symlinkSync(outside, join(root, "repo", "escape"));
  return { root, repo: join(root, "repo"), outside };
}

test("相对路径解析到会话 cwd 下", async () => {
  const { root, repo } = workspace();
  try {
    assert.equal(await resolveAgentTerminalCwd({ sessionCwd: repo, requested: "packages" }),
      realpathSync(join(repo, "packages")));
    assert.equal(await resolveAgentTerminalCwd({ sessionCwd: repo }), realpathSync(repo));
    assert.equal(await resolveAgentTerminalCwd({ sessionCwd: repo, requested: "" }), realpathSync(repo));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("会话 cwd 本身永远算已授权（子代理只有受限 roots 时也能在会话目录里开终端）", async () => {
  const { root, repo } = workspace();
  try {
    const cwd = await resolveAgentTerminalCwd({ sessionCwd: repo, allowedRoots: new Set() });
    assert.equal(cwd, realpathSync(repo));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("授权面之外的目录一律拒", async () => {
  const { root, repo, outside } = workspace();
  try {
    await assert.rejects(
      () => resolveAgentTerminalCwd({ sessionCwd: repo, requested: outside, allowedRoots: new Set([repo]) }),
      /不在当前会话已授权的目录范围内/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("指向授权面之外的符号链接不算授权（#748 那一类）", async () => {
  const { root, repo } = workspace();
  try {
    await assert.rejects(
      () => resolveAgentTerminalCwd({ sessionCwd: repo, requested: "escape", allowedRoots: new Set([repo]) }),
      /不在当前会话已授权的目录范围内/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("`..` 分段一律拒（字典序等于 root、文件系统不等于）", async () => {
  const { root, repo } = workspace();
  try {
    await assert.rejects(
      () => resolveAgentTerminalCwd({ sessionCwd: repo, requested: "../", allowedRoots: new Set([repo]) }),
      /不能包含 `..` 分段/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("不存在的目录与没有会话 cwd 都有明确报错", async () => {
  const { root, repo } = workspace();
  try {
    await assert.rejects(
      () => resolveAgentTerminalCwd({ sessionCwd: repo, requested: "nope", allowedRoots: new Set([repo]) }),
      /不存在或不是目录/,
    );
    await assert.rejects(
      () => resolveAgentTerminalCwd({ sessionCwd: undefined }),
      /没有可用工作目录/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});