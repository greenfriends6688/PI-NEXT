// fork:lan-access —— 监督器：只在开关方向变化时重启，且有次数上限。
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { lanConfigPath, lanEnabledByConfig, superviseLanBind, AUTO_RESTART_LIMIT } = require("../bin/lan-supervisor.cjs");

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-sup-"));
  // 回调可能是 async：这里把 promise 原样返回，别在同步包装里吃掉它。
  return fn({ dir, env: { PI_CODING_AGENT_DIR: dir } });
}

const TOKEN = "a".repeat(48);

test("配置路径跟随 PI_CODING_AGENT_DIR（与 SDK 的 getAgentDir 一致）", () => {
  withDir(({ dir, env }) => {
    assert.equal(lanConfigPath(env), join(dir, "lan-access.json"));
  });
});

test("enabled 的判定：形状不对 / 停了 / 文件坏，都算没开", () => {
  withDir(({ dir, env }) => {
    const file = join(dir, "lan-access.json");
    assert.equal(lanEnabledByConfig(env), false);
    writeFileSync(file, JSON.stringify({ token: TOKEN, enabled: true }));
    assert.equal(lanEnabledByConfig(env), true);
    writeFileSync(file, JSON.stringify({ token: TOKEN, enabled: false }));
    assert.equal(lanEnabledByConfig(env), false);
    writeFileSync(file, JSON.stringify({ token: "short", enabled: true }));
    assert.equal(lanEnabledByConfig(env), false);
    writeFileSync(file, "{ not json");
    assert.equal(lanEnabledByConfig(env), false);
  });
});

test("监督器：off→on 与 on→off 各重启一次；反复改同一个值不重启", async () => {
  await withDir(async ({ dir, env }) => {
    const file = join(dir, "lan-access.json");
    writeFileSync(file, JSON.stringify({ token: TOKEN, enabled: false }));
    let host = "127.0.0.1";
    const restarts = [];
    const stop = superviseLanBind({
      getHost: () => host,
      restart: (next) => { restarts.push(next); host = next; },
      env,
      log: () => {},
    });
    // 真正去抖那一档（500ms），再留一点余量给文件系统事件。
    const settle = () => new Promise((resolve) => setTimeout(resolve, 900));

    writeFileSync(file, JSON.stringify({ token: TOKEN, enabled: true }));
    await settle();
    assert.deepEqual(restarts, ["0.0.0.0"]);

    writeFileSync(file, JSON.stringify({ token: TOKEN, enabled: true })); // 同方向再来一次
    await settle();
    assert.deepEqual(restarts, ["0.0.0.0"], "同方向不应重复重启");

    writeFileSync(file, JSON.stringify({ token: TOKEN, enabled: false }));
    await settle();
    assert.deepEqual(restarts, ["0.0.0.0", "127.0.0.1"]);
    stop();
  });
});

test("监督器：抖动超过上限就停手，并打日志", async () => {
  await withDir(async ({ dir, env }) => {
    const file = join(dir, "lan-access.json");
    let host = "127.0.0.1";
    const restarts = [];
    const logs = [];
    const stop = superviseLanBind({
      getHost: () => host,
      restart: (next) => { restarts.push(next); host = next; },
      env,
      log: (line) => logs.push(line),
    });
    for (let i = 0; i < AUTO_RESTART_LIMIT + 3; i++) {
      writeFileSync(file, JSON.stringify({ token: TOKEN, enabled: i % 2 === 0 }));
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    assert.equal(restarts.length, AUTO_RESTART_LIMIT);
    assert.ok(logs.some((line) => /不再自动重启/.test(line)));
    stop();
  });
});
