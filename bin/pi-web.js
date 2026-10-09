#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");

if (!isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getHelpText, parseLaunchOptions } = require("./pi-web-options");
// fork:lan-access —— 局域网开关的监督器（scripts/next-mode.mjs 用同一份）。
const { superviseLanBind } = require("./lan-supervisor.cjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getNextNodeArgs } = require("./pi-web-node-args");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { wireChildProcessLifecycle } = require("./process-lifecycle");
// fork:rotate-preview-secrets —— 启动前重写 .next 里构建期固定的 preview 密钥。
const { rotatePreviewSecrets, getRotationWarning } = require("./rotate-preview-secrets");

let launchOptions;
try {
  launchOptions = parseLaunchOptions();
} catch (error) {
  fs.writeSync(
    process.stderr.fd,
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

if (launchOptions.help) {
  fs.writeSync(process.stdout.fd, getHelpText());
  process.exit(0);
}

const { port, hostname: launchHostname, openBrowser } = launchOptions;
let hostname = launchHostname;



const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
// fork:lan-access（2026-10-03）：产品**没有登录**，`PI_WEB_PASSWORD` 也不再被读。
// 局域网的实际闸门是 `PI_WEB_LAN_TOKEN`（见 lib/lan-access.ts）。
const lanToken = (process.env.PI_WEB_LAN_TOKEN || "").trim();

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

// fork:rotate-preview-secrets（上游 cf3ebfba5）—— 把公开包里固定的 previewModeId
// 换成新随机值，否则带 `x-prerender-revalidate` 的请求会跳过 proxy.ts（见模块头注）。
// 必须在 `next start` 之前。
const rotation = rotatePreviewSecrets(nextDir);
if (!rotation.ok) {
  console.warn(getRotationWarning(rotation.reason));
}

if (!loopbackHostnames.has(hostname)) {
  if (lanToken) {
    console.warn(
      `Warning: pi-web is listening on ${hostname} and requires PI_WEB_LAN_TOKEN for other machines. The token travels over plain HTTP — use HTTPS or a trusted VPN.`,
    );
  } else {
    console.warn(
      `Warning: pi-web is listening on ${hostname} without authentication. Anyone on this network has full control.`
      + ` To let a phone connect: open Settings -> Phone & push and press Start (no flags needed after that).`,
    );
  }
}

const nextArgs = ["start", "-p", port];
nextArgs.push("-H", hostname);

// Always run next's JS entry with node directly — avoids .bin symlink issues
// and path-with-spaces problems on Windows when shell: true is used.
function startChild() {
  const spawned = spawn(process.execPath, getNextNodeArgs(nextBin, nextArgs), {
    cwd: pkgDir,
    stdio: ["inherit", "pipe", "inherit"],
    env: { ...process.env, PI_WEB_HOSTNAME: hostname },
  });
  wireChildProcessLifecycle(spawned);
  return spawned;
}

// fork:lan-access —— 点「启动」后由这里重启子进程生效，细节见 lan-supervisor.cjs 的头注。
superviseLanBind({
  getHost: () => hostname,
  restart: (nextHost) => {
    hostname = nextHost;
    nextArgs[nextArgs.indexOf("-H") + 1] = hostname;
    child.kill("SIGTERM");
    child = startChild();
  },
});

let child = startChild();

let browserOpened = false;
// fork:lan-access：`-H 0.0.0.0` 时自动打开的浏览器，Host 会是 `0.0.0.0`，而 0.0.0.0
// 刻意不算 loopback，所以本机浏览器也会被闸门拦。把令牌带在 `?t=` 上：proxy 会把它
// 种成 cookie（lib/lan-access.ts），页面随后就是普通请求了。同一行也是给手机的配对链接。
// 通配绑定（0.0.0.0 / ::）不能直接拼 URL：本机浏览器要用 127.0.0.1。
const displayHost = hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname;
const url = lanToken
  ? `http://${displayHost}:${port}/?t=${encodeURIComponent(lanToken)}`
  : `http://${displayHost}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (openBrowser && !browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    // Avoid `shell: true` to suppress Node.js DEP0190 deprecation
    // ("Passing args to a child process with shell option true can lead to
    // security vulnerabilities, as the arguments are not escaped").
    // Pass a structured argv so Node.js handles escaping instead of
    // concatenating the args into a shell command string.
    let opener;
    if (isWindows) {
      // `start` is a cmd.exe built-in, so invoke cmd directly. The empty
      // title argument is required by `start` before the target URL.
      opener = spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", url], {
        stdio: "ignore",
        detached: true,
      });
    } else if (isMac) {
      opener = spawn("open", [url], {
        stdio: "ignore",
        detached: true,
      });
    } else {
      opener = spawn("xdg-open", [url], {
        stdio: "ignore",
        detached: true,
      });
    }

    opener.on("error", (error) => {
      console.warn(`Could not open browser automatically: ${error.message}`);
    });

    opener.unref();
  }
});
