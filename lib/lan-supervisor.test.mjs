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

/**
 * fork:flake-2026-10-03 —— 监督器靠 **fs.watch + 500ms 去抖**，本测试靠它活着。
 *
 * 全量套件里几十个测试文件并行时，macOS 的 FSEvents 偶尔会**丢事件**而不是迟到
 * （实测固定 sleep 到 8s 仍然没等到），所以光等更久没用：事件根本没到。
 * 正确解法是**重发**：没等到条件成立就再写一次同一个文件，watch 会重新触发，
 * 去抖会合并掉重复，监督器看到的内容没变。
 *
 * 重发间隔必须**大于去抖窗口**（500ms）—— 否则每 200ms 一次就把那个 timer 反复
 * clearTimeout 掉，它永远到不了 500ms，反而把条件饿死。所以这里取 700ms。
 * 20s 上限 = 大约 28 次重发；正常路径一次就用不到。
 */
const RETRIGGER_MS = 700;

async function until(check, retrigger, what, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    retrigger();
    await new Promise((resolve) => setTimeout(resolve, RETRIGGER_MS));
  }
  assert.fail(`等不到：${what}`);
}

/** 负向断言用：等一个**不该发生**的事发生那么久，然后断言它没发生。 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    // 重发写的是同一个内容：watch 会再触发，去抖会合并，监督器看到的方向没变。
    const write = (enabled) => writeFileSync(file, JSON.stringify({ token: TOKEN, enabled }));
    const settle = (enabled, cond, what) => until(cond, () => write(enabled), what);

    write(true);
    await settle(true, () => restarts.length > 0, "第一次重启落地");
    assert.deepEqual(restarts, ["0.0.0.0"]);

    write(true); // 同方向再来一次
    // 负向断言只能靠等：写几次同方向内容（每次都会重新触发去抖），等够一个
    // 完整窗口再加一点，然后断言重启数没变。
    for (let i = 0; i < 3; i++) {
      write(true);
      await sleep(700);
    }
    assert.deepEqual(restarts, ["0.0.0.0"], "同方向不应重复重启");

    write(false);
    await settle(false, () => restarts.length > 1, "关方向的重启落地");
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
      const enabled = i % 2 === 0;
      writeFileSync(file, JSON.stringify({ token: TOKEN, enabled }));
      const want = Math.min(i + 1, AUTO_RESTART_LIMIT);
      // 上限日志只在**又一次**切换之后才出现（监督器先看有没有到上限），所以它
      // 是 i+1 > 上限 时的条件，不是「重启数达到上限」时。
      await until(
        () => restarts.length >= want
          && (i + 1 <= AUTO_RESTART_LIMIT || logs.some((line) => /不再自动重启/.test(line))),
        () => writeFileSync(file, JSON.stringify({ token: TOKEN, enabled })),
        `第 ${i + 1} 次切换：重启数到 ${want}${i + 1 > AUTO_RESTART_LIMIT ? " 且已打出上限日志" : ""}`,
      );
    }
    assert.equal(restarts.length, AUTO_RESTART_LIMIT);
    assert.ok(logs.some((line) => /不再自动重启/.test(line)));
    stop();
  });
});
