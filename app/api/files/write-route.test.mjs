import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-files-write-")));
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { PUT } = await jiti.import("./[...path]/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/allowed-roots.ts");
allowFileRoot(root);

const target = path.join(root, "notes.txt");
fs.writeFileSync(target, "first\n");

function save(body, filePath = target) {
  const segments = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return PUT(
    new NextRequest(`http://localhost/api/files/x`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", host: "localhost" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: segments }) },
  );
}

test("saves a text file inside an allowed root", async () => {
  const response = await save({ content: "second\n" });
  assert.equal(response.status, 200);
  assert.equal(fs.readFileSync(target, "utf8"), "second\n");
});

test("refuses a file changed on disk since it was read", async () => {
  const stale = new Date(Date.now() - 60_000).toISOString();
  const response = await save({ content: "third\n", mtime: stale });
  assert.equal(response.status, 409);
  assert.equal(fs.readFileSync(target, "utf8"), "second\n");
});

test("refuses a path outside every allowed root", async () => {
  const outside = path.join(os.tmpdir(), `pi-web-outside-${process.pid}.txt`);
  fs.writeFileSync(outside, "keep\n");
  test.after(() => fs.rmSync(outside, { force: true }));
  const response = await save({ content: "nope\n" }, outside);
  assert.equal(response.status, 403);
  assert.equal(fs.readFileSync(outside, "utf8"), "keep\n");
});

test("refuses binary content", async () => {
  const response = await save({ content: "a\u0000b" });
  assert.equal(response.status, 400);
  assert.equal(fs.readFileSync(target, "utf8"), "second\n");
});
