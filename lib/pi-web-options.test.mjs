import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/**
 * fork:lan-access —— 令牌现在住在 `~/.pi/agent/lan-access.json` 里，所以**每个测试都必须
 * 指向临时 agent 目录**：否则「没有令牌」这条前提会被开发者自己机器上的真实配置满足掉
 * （这条就是被真实配置坑出来的：配置一存在，默认行为的断言全红）。
 */
const REAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
const TEMP_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-web-lan-test-"));
process.env.PI_CODING_AGENT_DIR = TEMP_AGENT_DIR;
after(() => {
  if (REAL_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = REAL_AGENT_DIR;
});

const { getHelpText, parseLaunchOptions } = require("../bin/pi-web-options.js");
const cliPath = fileURLToPath(new URL("../bin/pi-web.js", import.meta.url));

/** 一个空的 agent 目录：断言「默认不开」时用它，别读到用户真实那份。 */
const EMPTY_AGENT_ENV = { PI_CODING_AGENT_DIR: mkdtempSync(join(tmpdir(), "pi-web-opts-")) };

test("opens the browser by default", () => {
  const options = parseLaunchOptions([], EMPTY_AGENT_ENV);
  assert.equal(options.help, false);
  assert.equal(options.port, "30141");
  assert.equal(options.hostname, "127.0.0.1");
  assert.equal(options.openBrowser, true);
  // 没有令牌 → 不碰网卡（保持 loopback 默认）。
  assert.equal(options.lan.lan, false);
});

test("supports --help and -h without starting the server", () => {
  assert.deepEqual(parseLaunchOptions(["--help"], {}), { help: true });
  assert.deepEqual(parseLaunchOptions(["-h"], {}), { help: true });
  assert.match(getHelpText(), /Usage: pi-web/);
  assert.match(getHelpText(), /--port/);
  assert.match(getHelpText(), /--hostname/);
  assert.match(getHelpText(), /--no-open/);
  assert.match(getHelpText(), /--no-lan/);
  assert.match(getHelpText(), /PI_WEB_LAN_TOKEN/);
  assert.match(getHelpText(), /PI_WEB_SKIP_VERSION_CHECK/);
  assert.match(getHelpText(), /PI_WEB_IDLE_TIMEOUT_MS/);
});

test("rejects unknown options with a help hint", () => {
  assert.throws(
    () => parseLaunchOptions(["--unknown-flag"], {}),
    /Use --help to see available options/,
  );
});

test("rejects unexpected positional arguments", () => {
  assert.throws(
    () => parseLaunchOptions(["start"], {}),
    /Unexpected argument/,
  );
});

test("CLI writes help and parse errors before exiting", () => {
  const help = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: pi-web/);

  const invalid = spawnSync(process.execPath, [cliPath, "--unknown-flag"], {
    encoding: "utf8",
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Use --help to see available options/);
});

test("supports the no-open CLI option", () => {
  assert.equal(parseLaunchOptions(["--no-open"], {}).openBrowser, false);
});

test("supports truthy PI_WEB_NO_OPEN values", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(parseLaunchOptions([], { PI_WEB_NO_OPEN: value }).openBrowser, false);
  }
});

test("does not disable browser opening for false PI_WEB_NO_OPEN values", () => {
  for (const value of ["0", "false", "off", ""]) {
    assert.equal(parseLaunchOptions([], { PI_WEB_NO_OPEN: value }).openBrowser, true);
  }
});

test("preserves port and hostname options", () => {
  const options = parseLaunchOptions(["-p", "8080", "-H", "0.0.0.0"], {});
  assert.equal(options.port, "8080");
  assert.equal(options.hostname, "0.0.0.0");
  assert.equal(options.openBrowser, true);
});

test("fork:lan-access —— 有令牌就自己绑 ::（双栈），用户不用敲任何参数", () => {
  // `::` 而非 `0.0.0.0`：双栈绑定（v4+v6），v6 是「出门 5G 直连」的通道（c676847b）。
  assert.equal(parseLaunchOptions([], { PI_WEB_LAN_TOKEN: "0".repeat(48) }).hostname, "::");
  assert.equal(parseLaunchOptions([], { PI_WEB_LAN_TOKEN: "0".repeat(48) }).lan.source, "env");
});

test("fork:lan-access —— 存盘那份令牌形状不对就当没配，退回 loopback 而不是裸奔", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-lan-"));
  // 每个用例独占一个目录：这条会反复改写同一个文件。
  const file = join(dir, "lan-access.json");
  // 通过 env 传（parseLaunchOptions 的第二个参数就是 env），不去动 process.env。
  const options = () => parseLaunchOptions([], { PI_CODING_AGENT_DIR: dir });

  // 应用自己生成的那份：合法 → 自动绑网卡（双栈 `::`）。
  writeFileSync(file, JSON.stringify({ version: 1, token: "a".repeat(48), enabled: true }));
  assert.equal(options().hostname, "::");
  assert.equal(options().lan.source, "config");

  // 用户点了「停止」→ 只绑 loopback。
  writeFileSync(file, JSON.stringify({ version: 1, token: "a".repeat(48), enabled: false }));
  assert.equal(options().hostname, "127.0.0.1");

  // 形状不对（手写/旧版/空壳）→ 只绑 loopback。
  writeFileSync(file, JSON.stringify({ version: 1, token: "too-short", enabled: true }));
  assert.equal(options().hostname, "127.0.0.1");

  // 文件坏了 → 只绑 loopback。
  writeFileSync(file, "{ not json");
  assert.equal(options().hostname, "127.0.0.1");

  // env 里的空白等于没给。
  assert.equal(parseLaunchOptions([], { ...EMPTY_AGENT_ENV, PI_WEB_LAN_TOKEN: "   " }).hostname, "127.0.0.1");
});

test("fork:lan-access —— 显式网卡与 --no-lan 压过自动绑定", () => {
  assert.equal(parseLaunchOptions(["-H", "127.0.0.1"], { PI_WEB_LAN_TOKEN: "a".repeat(48) }).hostname, "127.0.0.1");
  assert.equal(parseLaunchOptions(["--no-lan"], { PI_WEB_LAN_TOKEN: "a".repeat(48) }).hostname, "127.0.0.1");
  assert.equal(parseLaunchOptions(["--no-lan"], {}).noLan, true);
});

test("rejects port values that could inject cmd arguments", () => {
  assert.throws(
    () => parseLaunchOptions(["-p", "30141&whoami"], {}),
    /Port must be a non-negative integer/,
  );
  assert.throws(
    () => parseLaunchOptions([], { PORT: "30141&whoami" }),
    /Port must be a non-negative integer/,
  );
});

test("supports PI_WEB_HOSTNAME without trusting the ambient system HOSTNAME", () => {
  assert.equal(
    parseLaunchOptions([], { ...EMPTY_AGENT_ENV, HOSTNAME: "container-id" }).hostname,
    "127.0.0.1",
  );
  assert.equal(
    parseLaunchOptions([], { PI_WEB_HOSTNAME: "0.0.0.0" }).hostname,
    "0.0.0.0",
  );
});
