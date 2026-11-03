// 启动器那一半的绑定判定。这里的每条规则都是「手机连不上」的一次真实故障：
// 设置里打开了局域网，而进程还绑在 127.0.0.1 上 —— 服务端读得到配置文件，但
// 绑定发生在它之前，所以必须在启动器里决定。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

// bin/*.js 是 CommonJS（启动器就是 require 的），测试用 createRequire 载入它。
const require = createRequire(import.meta.url);
const { resolveHostname, reachableUrls, readLanAccessConfig, lanAccessEnabled } = require("./lan-bind.js");

/** 一个假的 agent 目录，里面放（或不放）lan-access.json。 */
function agentDirWith(config) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-lanbind-"));
  if (config !== undefined) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "lan-access.json"), typeof config === "string" ? config : JSON.stringify(config));
  }
  return dir;
}

const TOKEN = "a".repeat(48);

test("an explicit -H is always honoured", () => {
  const env = { PI_CODING_AGENT_DIR: agentDirWith({ token: TOKEN, enabled: true }) };
  assert.equal(resolveHostname({ requested: "127.0.0.1", explicit: true, env }), "127.0.0.1");
  assert.equal(resolveHostname({ requested: "192.168.1.9", explicit: true, env }), "192.168.1.9");
});

test("without an explicit -H, an enabled lan-access.json binds every interface", () => {
  const env = { PI_CODING_AGENT_DIR: agentDirWith({ token: TOKEN, enabled: true }) };
  assert.equal(resolveHostname({ requested: "127.0.0.1", explicit: false, env }), "0.0.0.0");
  assert.equal(lanAccessEnabled(env), true);
});

test("no config, a disabled one, a corrupt one or a bad token stays loopback", () => {
  for (const config of [
    undefined,
    { token: TOKEN, enabled: false },
    "{not json",
    { token: "short", enabled: true },
    { enabled: true },
  ]) {
    const env = { PI_CODING_AGENT_DIR: agentDirWith(config) };
    assert.equal(readLanAccessConfig(env), null, `config ${JSON.stringify(config)} reads as none`);
    assert.equal(resolveHostname({ requested: "127.0.0.1", explicit: false, env }), "127.0.0.1");
  }
});

test("PI_WEB_LAN_TOKEN alone enables it (headless / CI)", () => {
  const env = { PI_CODING_AGENT_DIR: agentDirWith(undefined), PI_WEB_LAN_TOKEN: TOKEN };
  assert.equal(lanAccessEnabled(env), true);
  assert.equal(resolveHostname({ requested: "localhost", explicit: false, env }), "0.0.0.0");
});

test("a concrete host is left alone even without a token", () => {
  const env = { PI_CODING_AGENT_DIR: agentDirWith(undefined) };
  assert.equal(resolveHostname({ requested: "10.0.0.5", explicit: false, env }), "10.0.0.5");
});

test("reachable URLs name the LAN interfaces, never the wildcard", () => {
  const urls = reachableUrls("0.0.0.0", 30142);
  for (const url of urls) {
    assert.match(url, /^http:\/\/\d+\.\d+\.\d+\.\d+:30142$/);
    assert.ok(!url.includes("0.0.0.0"));
    assert.ok(!url.includes("127.0.0.1"));
  }
  assert.deepEqual(reachableUrls("127.0.0.1", 30142), ["http://127.0.0.1:30142"]);
  assert.deepEqual(reachableUrls("0.0.0.0", 0), [], "an OS-picked port has no address to print");
});
