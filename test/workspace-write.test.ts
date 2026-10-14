import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeWorkspaceFile } from "../src/main/engine/workspace-fs.ts";

/**
 * The write guard.
 *
 * Reading a file the user pointed at is not destructive, so the read side of the workspace
 * opens whatever path it is handed. Writing is the destructive direction, and the caller is
 * a remote client as far as this function knows — "the path it sent" cannot be the
 * authorisation. These are the cases that would make it one.
 */

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "pinext-write-"));
  const project = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(join(project, "src"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  const inside = join(project, "src", "a.ts");
  const secret = join(outside, "secret.txt");
  writeFileSync(inside, "original\n");
  writeFileSync(secret, "not yours\n");
  return { base, project, outside, inside, secret, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test("a file inside the project is written, and the text lands byte for byte", () => {
  const f = fixture();
  try {
    writeWorkspaceFile(f.inside, "export const one = 1;\n", [f.project]);
    assert.equal(readFileSync(f.inside, "utf8"), "export const one = 1;\n");
  } finally {
    f.cleanup();
  }
});

test("a file outside every root is refused, and left untouched", () => {
  const f = fixture();
  try {
    assert.throws(() => writeWorkspaceFile(f.secret, "clobbered\n", [f.project]), /拒绝写入|Refused/);
    assert.equal(readFileSync(f.secret, "utf8"), "not yours\n");
  } finally {
    f.cleanup();
  }
});

test("a sibling directory whose name merely starts with the root is not inside it", () => {
  // `startsWith(root)` without a separator would accept `/tmp/project-evil` for root
  // `/tmp/project` — the classic prefix bug, and the reason the comparison appends `sep`.
  const f = fixture();
  try {
    const sibling = `${f.project}-evil`;
    mkdirSync(sibling, { recursive: true });
    const file = join(sibling, "x.txt");
    writeFileSync(file, "original\n");
    assert.throws(() => writeWorkspaceFile(file, "clobbered\n", [f.project]), /拒绝写入|Refused/);
    assert.equal(readFileSync(file, "utf8"), "original\n");
    rmSync(sibling, { recursive: true, force: true });
  } finally {
    f.cleanup();
  }
});

test("a symlink pointing out of the project does not carry a write with it", () => {
  // The reason both sides go through `realpath`: the link itself is inside the project, so
  // a naive containment check on the given path would allow it.
  const f = fixture();
  try {
    const link = join(f.project, "shortcut.txt");
    symlinkSync(f.secret, link);
    assert.throws(() => writeWorkspaceFile(link, "clobbered\n", [f.project]), /拒绝写入|Refused/);
    assert.equal(readFileSync(f.secret, "utf8"), "not yours\n");
  } finally {
    f.cleanup();
  }
});

test("a directory is refused, and a missing file is refused", () => {
  const f = fixture();
  try {
    assert.throws(() => writeWorkspaceFile(f.project, "x", [f.project]));
    assert.throws(() => writeWorkspaceFile(join(f.project, "nope.txt"), "x", [f.project]));
  } finally {
    f.cleanup();
  }
});
