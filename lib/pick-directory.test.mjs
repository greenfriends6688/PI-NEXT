import assert from "node:assert/strict";
import test from "node:test";

import { pickDirectory } from "./pick-directory.ts";

/*
 * fix:pick-directory-cancel —— 三个分支必须分得开：
 *   选取成功 → picked（切过去）
 *   用户取消 → cancelled（什么都不做）
 *   没有原生选框（501 / 网络失败）→ unavailable（才回退到手输弹窗）
 * 「取消」与「不可用」归约成同一个值的那一版，用户点了系统选框的取消之后
 * 会被再弹一个手输弹窗——就是这条测试要挡住的行为回归。
 */

function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve(run()).finally(() => { globalThis.fetch = original; });
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

test("picked when the native dialog returns a directory", async () => {
  await withFetch(async () => json(200, { cwd: "/tmp/project" }), async () => {
    assert.deepEqual(await pickDirectory(), { status: "picked", cwd: "/tmp/project" });
  });
});

test("cancelled when the user dismisses the native dialog", async () => {
  await withFetch(async () => json(200, { cancelled: true }), async () => {
    assert.deepEqual(await pickDirectory(), { status: "cancelled" });
  });
});

test("unavailable when the platform has no native picker or the request fails", async () => {
  await withFetch(async () => json(501, { fallback: true }), async () => {
    assert.deepEqual(await pickDirectory(), { status: "unavailable" });
  });
  await withFetch(async () => { throw new Error("offline"); }, async () => {
    assert.deepEqual(await pickDirectory(), { status: "unavailable" });
  });
});
