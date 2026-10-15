import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OutsideLinkError,
  allowOutsideLink,
  checkLinkedDirectoryApproval,
  getOutsideLinkTarget,
  isPathWithinRoots,
  resolveRealRoots,
} from "../src/main/engine/linked-directory.ts";
import { readWorkspaceDir } from "../src/main/engine/workspace-fs.ts";

/**
 * fork:linked-directory —— 项目外符号链接目录。
 *
 * 失败模式要锁住的是「仓库内容不得自己放宽 roots」：一条提交进来的软链必须**先被列出来
 * （带目标）但不能读**，只有显式 allow 之后才读得到；而链接指向项目内的目标照常可用。
 */

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pinext-linked-")));
const project = path.join(root, "project");
const outside = path.join(root, "outside");
fs.mkdirSync(project);
fs.mkdirSync(path.join(project, "src"));
fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
fs.writeFileSync(path.join(project, "src", "inside.txt"), "inside");
fs.symlinkSync(outside, path.join(project, "escape"), "dir");
fs.symlinkSync(path.join(project, "src"), path.join(project, "self"), "dir");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("inside links are browsable; outside links are marked, not silently dropped", async () => {
  const entries = await readWorkspaceDir(project, [project]);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  assert.equal(byName.get("src")?.outsideLinkTarget, undefined);
  assert.equal(byName.get("self")?.outsideLinkTarget, undefined);
  assert.equal(byName.get("escape")?.outsideLinkTarget, fs.realpathSync(outside));
});

test("descending into an outside link is refused until it is explicitly allowed", async () => {
  const link = path.join(project, "escape");
  await assert.rejects(() => readWorkspaceDir(link, [project]), (error: unknown) => {
    assert.ok(error instanceof OutsideLinkError);
    assert.equal(error.target, fs.realpathSync(outside));
    return true;
  });
  allowOutsideLink(fs.realpathSync(outside));
  const entries = await readWorkspaceDir(link, [project]);
  assert.deepEqual(entries.map((entry) => entry.name), ["secret.txt"]);
});

test("path containment is decided on resolved real paths", () => {
  const realRoots = resolveRealRoots([project]);
  assert.equal(isPathWithinRoots(path.join(project, "src"), realRoots), true);
  assert.equal(isPathWithinRoots(outside, realRoots), false);
  assert.equal(getOutsideLinkTarget(path.join(project, "self"), realRoots), null);
  assert.equal(getOutsideLinkTarget(path.join(project, "escape"), realRoots), fs.realpathSync(outside));
});

test("approval requires the link to sit directly under a root and to match the listed target", () => {
  const link = path.join(project, "escape");
  assert.equal(checkLinkedDirectoryApproval(link, fs.realpathSync(outside), [project]).ok, true);
  // A link reached through another, unapproved link does not qualify.
  assert.equal(checkLinkedDirectoryApproval(path.join(outside, "x"), fs.realpathSync(outside), [project]).ok, false);
  // The target must still be the one the listing showed.
  assert.equal(checkLinkedDirectoryApproval(link, path.join(root, "elsewhere"), [project]).ok, false);
  // A plain directory is not a link.
  assert.equal(checkLinkedDirectoryApproval(path.join(project, "src"), path.join(project, "src"), [project]).ok, false);
});
