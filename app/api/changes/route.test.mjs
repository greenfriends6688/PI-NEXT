import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

function request(body, headers = {}) {
  return new NextRequest("http://localhost/api/changes", {
    method: "POST",
    headers: {
      Host: "localhost",
      Origin: "http://localhost",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/*
 * fork:proma-39-changes — 改动面板接口的授权边界与 `/api/files` 同源：
 * 未授权的 cwd 在读到任何 git 数据之前就被拒。
 */
test("rejects a cross-origin request before anything else", async () => {
  const res = await POST(request({ cwd: "/tmp" }, { Origin: "http://evil.example", "Sec-Fetch-Site": "cross-site" }));
  assert.equal(res.status, 403);
});

test("requires a JSON content type", async () => {
  const res = await POST(new NextRequest("http://localhost/api/changes", {
    method: "POST",
    headers: { Host: "localhost", Origin: "http://localhost", "Sec-Fetch-Site": "same-origin", "Content-Type": "text/plain" },
    body: "{}",
  }));
  assert.equal(res.status, 415);
});

test("rejects a relative cwd", async () => {
  const res = await POST(request({ cwd: "relative/path" }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /absolute/);
});

test("rejects a cwd outside the allowed roots", async () => {
  const res = await POST(request({ cwd: "/etc" }));
  assert.equal(res.status, 403);
});
