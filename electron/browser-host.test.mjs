import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertHostNavigableUrl, persistentPartition } = require("./browser-host.js");

test("宿主侧只放行 http/https —— 这是 file:// 的最后一道", () => {
  assert.equal(assertHostNavigableUrl("https://example.com/x"), "https://example.com/x");
  assert.equal(assertHostNavigableUrl("http://localhost:5173/"), "http://localhost:5173/");
  for (const input of [
    "file:///etc/passwd",
    "FILE:///C:/Users/x/secret.txt",
    "javascript:alert(document.cookie)",
    "data:text/html,<script>alert(1)</script>",
    "chrome://settings",
    "vbscript:msgbox(1)",
  ]) {
    assert.throws(() => assertHostNavigableUrl(input), input);
  }
});

test("空地址 / 缺主机名的地址 fail closed", () => {
  assert.throws(() => assertHostNavigableUrl("   "));
  assert.throws(() => assertHostNavigableUrl("https://"));
});

test("profile 分区名不泄露会话 id / 目录名", () => {
  const partition = persistentPartition("session:6f1a0b2c-secret-cwd");
  assert.ok(partition.startsWith("persist:pi-web-browser-"));
  assert.equal(partition.includes("6f1a0b2c"), false);
  // 同一 key 稳定，不同 key 不同 —— 这就是「按会话隔离且持久化在本机」的全部含义。
  assert.equal(partition, persistentPartition("session:6f1a0b2c-secret-cwd"));
  assert.notEqual(partition, persistentPartition("session:other"));
});