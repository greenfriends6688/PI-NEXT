#!/usr/bin/env node
/**
 * dev / 生产 模式切换器
 *
 * 为什么需要它：`next dev`（Turbopack）和 `next build`（webpack）**共用同一个
 * `.next` 目录**，但两者的产物互不兼容。混用会表现为
 * "Failed to compile" 或浏览器里 "Module ... factory is not available" 的假故障。
 * 本脚本在切换模式前把不匹配的缓存挪走（挪到系统临时目录，不留在项目里）。
 *
 * 用法：
 *   node scripts/next-mode.mjs dev     # 清掉生产缓存 → next dev（改代码用）
 *   node scripts/next-mode.mjs prod    # 清掉 dev 缓存 → next build → next start（日常使用）
 *   node scripts/next-mode.mjs status  # 只看当前 .next 是什么模式
 */

import { existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const NEXT_DIR = join(ROOT, ".next");
const PORT = "30141";

// fork:lan-access —— 有令牌就绑 0.0.0.0（手机可连），否则只绑本机。
// 判定与启动器共用一份，见 bin/lan-supervisor.cjs 的头注。
const { lanEnabledByConfig, superviseLanBind } = createRequire(import.meta.url)("../bin/lan-supervisor.cjs");
let HOST = lanEnabledByConfig() ? "0.0.0.0" : "127.0.0.1";

/** 生产构建会写 BUILD_ID；dev（Turbopack）会写 dev/ 子目录。 */
function currentMode() {
  if (!existsSync(NEXT_DIR)) return "empty";
  const isProd = existsSync(join(NEXT_DIR, "BUILD_ID"));
  const isDev = existsSync(join(NEXT_DIR, "dev"));
  if (isProd && !isDev) return "prod";
  if (isDev && !isProd) return "dev";
  if (isProd && isDev) return "mixed";
  return "unknown";
}

/**
 * 直接调用 next 的 JS 入口，不要 spawn "next" 这个命令名。
 * Windows 上 `next` 只是 next.cmd，spawn(..., { shell: false }) 会直接 ENOENT
 * 让构建静默失败；走 JS 入口则在三个平台上都稳定。
 */
function nextCli() {
  const pkgPath = createRequire(import.meta.url).resolve("next/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.next;
  return join(dirname(pkgPath), bin ?? "dist/bin/next");
}

function runNext(args) {
  return spawnSync(process.execPath, [nextCli(), ...args], { stdio: "inherit", cwd: ROOT });
}

/**
 * 起服务（异步，因为要能被监督器重启）。
 *
 * `npm run prod` 是日常入口（`AGENTS.md` 的「Quick Start」），所以**它也必须**接上
 * 局域网监督器：否则界面上点「启动」在日常入口下不生效 —— 这正是第一版踩到的坑。
 */
function serveWithLanWatch() {
  let child = null;
  let restarting = false;

  const start = () => {
    child = spawn(process.execPath, [nextCli(), "start", "-H", HOST, "-p", PORT], {
      stdio: "inherit",
      cwd: ROOT,
      env: { ...process.env, PI_WEB_HOSTNAME: HOST },
    });
    child.on("exit", (code, signal) => {
      // 我们自己重启的那次不算退出；意外退出才带走整个进程。
      if (restarting || signal === "SIGTERM") return;
      process.exit(code ?? 0);
    });
    return child;
  };

  start();
  superviseLanBind({
    getHost: () => HOST,
    restart: (nextHost) => {
      HOST = nextHost;
      const previous = child;
      if (!previous) return start();
      restarting = true;
      // **必须等端口真的空出来再起新的**：SIGTERM 是异步的，直接 kill→start 会撞上
      // EADDRINUSE，next-server 起不来 → 父进程跟着退出 → 整套服务没���。这个坑实测踩过。
      let settled = false;
      const once = () => {
        if (settled) return;
        settled = true;
        clearTimeout(hardKill);
        restarting = false;
        start();
      };
      previous.once("exit", once);
      const hardKill = setTimeout(() => {
        if (settled) return;
        previous.kill("SIGKILL");
        once();
      }, 5_000);
      previous.kill("SIGTERM");
    },
  });
  // 让这个进程常驻：子进程活着时不退出。
  process.stdin.resume();
}

function stash(label) {
  if (!existsSync(NEXT_DIR)) return;
  const dest = join(tmpdir(), `.next-${label}-${Date.now()}`);
  renameSync(NEXT_DIR, dest);
  const mb = Math.round(statSync(dest).size / 1048576);
  console.log(`  已把旧的 .next 挪到 ${dest}`);
  console.log(`  （可随时删除；里面是 ${mb}MB 可重建的编译缓存）`);
}

const mode = process.argv[2];

if (mode === "status") {
  console.log(`.next 当前模式: ${currentMode()}`);
  process.exit(0);
}

if (mode === "dev") {
  const cur = currentMode();
  console.log(`[dev] 当前 .next: ${cur}`);
  if (cur === "prod" || cur === "mixed") stash("prod-cache");
  console.log("[dev] 启动 next dev ...");
  const r = runNext(["dev", "-H", HOST, "-p", PORT]);
  process.exit(r.status ?? 1);
}

if (mode === "prod") {
  const cur = currentMode();
  console.log(`[prod] 当前 .next: ${cur}`);
  if (cur === "dev" || cur === "mixed") stash("dev-cache");

  console.log("[prod] 构建中 ...");
  const b = runNext(["build", "--webpack"]);
  if (b.status !== 0) {
    console.error("[prod] 构建失败，未启动服务");
    process.exit(b.status ?? 1);
  }

  console.log(`[prod] 启动 next start（http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}）...`);
  serveWithLanWatch();
} else {
  console.error("用法: node scripts/next-mode.mjs <dev|prod|status>");
  process.exit(2);
}
