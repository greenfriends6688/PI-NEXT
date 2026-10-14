import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorkspaceFiles, mutateWorkspaceFile } from "../src/main/engine/workspace-mutate.ts";

/**
 * The create/rename/delete guard.
 *
 * Same rule as writing a file, and the same reason: the caller may be a browser on another
 * machine, so the answer to "may I touch this?" cannot come from the path it sent. These are
 * the cases that would make it come from there.
 */

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "pinext-mutate-"));
  const project = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(join(project, "src"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(project, "src", "a.ts"), "a\n");
  writeFileSync(join(outside, "secret.txt"), "not yours\n");
  return { base, project, outside, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test("a folder and a file are created inside the project", () => {
  const f = fixture();
  try {
    mutateWorkspaceFile({ kind: "mkdir", path: join(f.project, "new") }, [f.project]);
    assert.equal(existsSync(join(f.project, "new")), true);
    mutateWorkspaceFile({ kind: "touch", path: join(f.project, "new", "b.md") }, [f.project]);
    assert.equal(readFileSync(join(f.project, "new", "b.md"), "utf8"), "");
  } finally {
    f.cleanup();
  }
});

test("creating over something that exists is refused rather than silently clobbering", () => {
  const f = fixture();
  try {
    assert.throws(() => mutateWorkspaceFile({ kind: "touch", path: join(f.project, "src", "a.ts") }, [f.project]));
    assert.equal(readFileSync(join(f.project, "src", "a.ts"), "utf8"), "a\n");
    assert.throws(() => mutateWorkspaceFile({ kind: "mkdir", path: join(f.project, "src") }, [f.project]));
  } finally {
    f.cleanup();
  }
});

test("every operation is refused outside the roots, and leaves the file alone", () => {
  const f = fixture();
  try {
    const target = join(f.outside, "secret.txt");
    assert.throws(() => mutateWorkspaceFile({ kind: "delete", path: target }, [f.project]));
    assert.throws(() => mutateWorkspaceFile({ kind: "rename", path: target, to: join(f.project, "moved.txt") }, [f.project]));
    assert.throws(() => mutateWorkspaceFile({ kind: "touch", path: join(f.outside, "new.txt") }, [f.project]));
    assert.throws(() => mutateWorkspaceFile({ kind: "mkdir", path: join(f.outside, "new") }, [f.project]));
    assert.equal(readFileSync(target, "utf8"), "not yours\n");
  } finally {
    f.cleanup();
  }
});

test("a rename cannot move a file out, and cannot overwrite something on the way", () => {
  const f = fixture();
  try {
    const inside = join(f.project, "src", "a.ts");
    assert.throws(() => mutateWorkspaceFile({ kind: "rename", path: inside, to: join(f.outside, "stolen.ts") }, [f.project]));
    assert.equal(existsSync(inside), true);

    writeFileSync(join(f.project, "src", "b.ts"), "b\n");
    assert.throws(() => mutateWorkspaceFile({ kind: "rename", path: inside, to: join(f.project, "src", "b.ts") }, [f.project]));
    assert.equal(readFileSync(join(f.project, "src", "b.ts"), "utf8"), "b\n");

    mutateWorkspaceFile({ kind: "rename", path: inside, to: join(f.project, "src", "c.ts") }, [f.project]);
    assert.equal(existsSync(join(f.project, "src", "c.ts")), true);
  } finally {
    f.cleanup();
  }
});

test("a symlinked directory does not carry an operation out of the project", () => {
  const f = fixture();
  try {
    const link = join(f.project, "shortcut");
    symlinkSync(f.outside, link);
    // The listing does not follow it either: `readWorkspaceDir` skips symlinks, so the tree
    // never showed anything under `shortcut/` to begin with, and the `@` menu should not
    // start offering files the tree refuses to draw.
    assert.equal(listWorkspaceFiles(f.project).some((name) => name.startsWith("shortcut/")), false);
    // And an operation through it is judged by where it really points.
    assert.throws(() => mutateWorkspaceFile({ kind: "delete", path: join(link, "secret.txt") }, [f.project]));
    assert.throws(() => mutateWorkspaceFile({ kind: "touch", path: join(link, "new.txt") }, [f.project]));
    assert.equal(readFileSync(join(f.outside, "secret.txt"), "utf8"), "not yours\n");
  } finally {
    f.cleanup();
  }
});

test("the project root itself cannot be deleted", () => {
  const f = fixture();
  try {
    assert.throws(() => mutateWorkspaceFile({ kind: "delete", path: f.project }, [f.project]));
    assert.equal(existsSync(f.project), true);
  } finally {
    f.cleanup();
  }
});

test("the flat listing is relative, skips the noise directories and nests with slashes", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.project, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(f.project, "node_modules", "pkg", "index.js"), "x\n");
    writeFileSync(join(f.project, "README.md"), "x\n");
    const files = listWorkspaceFiles(f.project);
    assert.ok(files.includes("README.md"));
    assert.ok(files.includes("src/a.ts"));
    assert.equal(files.some((name) => name.startsWith("node_modules")), false);
    assert.equal(files.every((name) => !name.startsWith("/")), true);
  } finally {
    f.cleanup();
  }
});
