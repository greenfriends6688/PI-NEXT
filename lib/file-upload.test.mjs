import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./file-upload.ts");
}

test("validates upload names without accepting paths or duplicates", async () => {
  const { validateUploadFileNames } = await loadSubject();

  assert.equal(validateUploadFileNames(["one.txt", "two file.md"]), null);
  assert.match(validateUploadFileNames(["../secret.txt"]), /must not contain a path/);
  assert.match(validateUploadFileNames(["folder\\secret.txt"]), /must not contain a path/);
  assert.match(validateUploadFileNames(["same.txt", "same.txt"]), /Duplicate/);
  assert.match(validateUploadFileNames([]), /No files/);
});

test("finds conflicts and prevents replacing directories", async (t) => {
  const { inspectUploadTargets } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, "file.txt"), "old");
  fs.mkdirSync(path.join(root, "directory"));

  assert.deepEqual(
    inspectUploadTargets(root, ["new.txt", "file.txt", "directory"]),
    {
      conflicts: ["file.txt", "directory"],
      nonReplaceable: ["directory"],
    },
  );
});

test("prevents replacing symbolic links", async (t) => {
  const { inspectUploadTargets } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, "file.txt"), "old");
  try {
    fs.symlinkSync("file.txt", path.join(root, "link.txt"));
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Creating symbolic links requires additional privileges on this platform");
      return;
    }
    throw error;
  }

  assert.deepEqual(
    inspectUploadTargets(root, ["link.txt"]),
    {
      conflicts: ["link.txt"],
      nonReplaceable: ["link.txt"],
    },
  );
});

test("parses only supported conflict strategies", async () => {
  const { parseUploadConflictStrategy } = await loadSubject();

  assert.equal(parseUploadConflictStrategy(null), "error");
  assert.equal(parseUploadConflictStrategy("overwrite"), "overwrite");
  assert.equal(parseUploadConflictStrategy("skip"), "skip");
  assert.equal(parseUploadConflictStrategy("rename"), null);
});

// fork:file-integrity（上游 #1039）—— 覆盖上传必须原子替换：旧文件留到新内容
// 完整写入并 rename 成功为止。旧写法先 unlink 再 write，写失败就永久丢原文件。
test("replaceUploadFile swaps in the new bytes and keeps only the destination", async (t) => {
  const { replaceUploadFile } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-replace-ok-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const destination = path.join(root, "important.txt");
  fs.writeFileSync(destination, "original contents");

  replaceUploadFile(destination, Buffer.from("replacement"));

  assert.equal(fs.readFileSync(destination, "utf8"), "replacement");
  assert.deepEqual(fs.readdirSync(root), ["important.txt"]);
});

test("a failed write leaves the original file intact and cleans the staging dir", async (t) => {
  const { replaceUploadFile } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-replace-fail-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const destination = path.join(root, "important.txt");
  fs.writeFileSync(destination, "original contents");

  const write = fs.writeFileSync;
  t.mock.method(fs, "writeFileSync", (target, ...args) => {
    if (String(target).startsWith(root + path.sep)) {
      throw Object.assign(new Error("simulated ENOSPC"), { code: "ENOSPC" });
    }
    return write(target, ...args);
  });

  assert.throws(() => replaceUploadFile(destination, Buffer.from("replacement")), /simulated ENOSPC/);
  assert.equal(fs.readFileSync(destination, "utf8"), "original contents");
  assert.deepEqual(fs.readdirSync(root), ["important.txt"], "staging dir must not be left behind");
});

test("a failed rename leaves the original file intact and cleans the staging dir", async (t) => {
  const { replaceUploadFile } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-replace-rename-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const destination = path.join(root, "important.txt");
  fs.writeFileSync(destination, "original contents");

  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === destination) throw Object.assign(new Error("simulated EACCES"), { code: "EACCES" });
    return rename(from, to);
  });

  assert.throws(() => replaceUploadFile(destination, Buffer.from("replacement")), /simulated EACCES/);
  assert.equal(fs.readFileSync(destination, "utf8"), "original contents");
  assert.deepEqual(fs.readdirSync(root), ["important.txt"], "staging dir must not be left behind");
});

test("replaceUploadFile refuses a directory or a symbolic link", async (t) => {
  const { replaceUploadFile } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-replace-refuse-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "directory");
  fs.mkdirSync(directory);
  assert.throws(() => replaceUploadFile(directory, Buffer.from("x")), /directory or symbolic link/);
});
