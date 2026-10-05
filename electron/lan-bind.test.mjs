import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * fork:lan-access（2026-10-04）—— 桌面壳的局域网绑定。
 *
 * 这一条以前只在 `bin/pi-web.js` / `scripts/next-mode.mjs` 上跑：桌面壳自己 spawn
 * `next` 并自己挑 `-H 127.0.0.1`，监督器从未参与，于是令牌建好了网卡一直没绑，
 * `lanAccessState().needsRebind` 永远为 true —— 界面永远写着「正在开启局域网…」，
 * 二维码里的地址本机也连不上。
 */
const source = readFileSync(new URL("./main.js", import.meta.url), "utf8");

test("桌面壳复用与其它启动器同一份局域网绑定监督器", () => {
  assert.match(source, /require\("\.\.\/bin\/lan-supervisor\.cjs"\)/);
  assert.match(source, /lanEnabledByConfig\(\) \? "0\.0\.0\.0" : "127\.0\.0\.1"/);
  assert.match(source, /superviseLanBind\(\{/);
  // 换网卡的重启要走子进程的 `exit`（端口还在监听时新进程会 EADDRINUSE）。
  assert.match(source, /old\.once\("exit", \(\) => spawnServer\(nextHost\)\)/);
  assert.match(source, /old\.kill\("SIGTERM"\)/);
});

test("子进程拿到 PI_WEB_HOSTNAME —— 服务端判定「真的绑上网卡了吗」的唯一依据", () => {
  assert.match(source, /PI_WEB_HOSTNAME: host/);
  // 硬编码的 -H 127.0.0.1 就是那个 bug 本身，不能再出现。
  assert.doesNotMatch(source, /"start", "-p", String\(port\), "-H", "127\.0\.0\.1"/);
});

test("换网卡不算「服务意外退出」，不与退避重启抢同一个子进程", () => {
  assert.match(source, /if \(quitting \|\| useDevServer \|\| lanRebinding\) return;/);
  // 每次 startServer 先退订上一个监督器，崩溃重启不会叠出第二个。
  assert.match(source, /if \(stopLanSupervisor\) \{\s*stopLanSupervisor\(\);\s*stopLanSupervisor = null;\s*\}/);
});