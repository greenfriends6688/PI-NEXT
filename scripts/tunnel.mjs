#!/usr/bin/env node
/**
 * fork:mobile-shell —— 一条命令出门：`npm run tunnel`。
 *
 * 干四件事：
 *   1. 起 cloudflared quick tunnel 指向本机服务（`--url http://127.0.0.1:<port>`）
 *   2. 从输出解析 `https://xxx.trycloudflare.com` 地址
 *   3. 调本机 `POST /api/tunnel` 把新 host 追加进**运行时**放行名单
 *      （名单每次请求现读 process.env，免重启；该接口仅限本机 loopback 调用）
 *   4. 打印手机上该打开的地址，然后守着隧道直到 Ctrl+C
 *
 * 前置：`npm install -g cloudflared`（走 npm 国内镜像，绕开 brew 卡死），
 * 且 30141 有跑着的服务。quick tunnel 零账号；电脑重启/隧道断了就重跑本命令，
 * 新地址手机上重新填一次 + 输一次 6 位码（host-only cookie 跟着域名走）。
 */

import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const portFlag = args.indexOf("--port");
const PORT = Number(portFlag >= 0 ? args[portFlag + 1] : (process.env.PORT ?? "30141"));
const METRICS_PORT = 36500;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`[tunnel] 起动 cloudflared quick tunnel → http://127.0.0.1:${PORT}`);
  const child = spawn(
    "cloudflared",
    ["tunnel", "--url", `http://127.0.0.1:${PORT}`, "--no-autoupdate", "--metrics", `127.0.0.1:${METRICS_PORT}`],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  child.stderr.setEncoding("utf8");
  let tunnelLog = "";
  child.stderr.on("data", (chunk) => {
    tunnelLog += chunk;
    // 边收边打（去掉时间戳前缀太长的问题，原样转写 stderr）
    process.stderr.write(chunk);
  });

  // 等 URL + 等边缘注册（MusePi 同款解析：正则扫累积文本）
  let url = null;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(tunnelLog)?.[0] ?? null;
    const registered = /Registered tunnel connection/.test(tunnelLog);
    if (url && registered) break;
    if (child.exitCode != null) {
      console.error(`[tunnel] cloudflared 提前退出（code=${child.exitCode}）——重跑 npm run tunnel`);
      process.exit(1);
    }
    await wait(500);
  }
  if (!url) {
    console.error("[tunnel] 45 秒内没拿到隧道地址 —— 检查网络后重跑");
    child.kill("SIGTERM");
    process.exit(1);
  }

  // 运行时放行：loopback 专用接口（proxy 的令牌闸门只管远程，本机调用免令牌）
  let allowOk = false;
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/tunnel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: new URL(url).host }),
      signal: AbortSignal.timeout(8000),
    });
    allowOk = response.ok;
    if (!allowOk) {
      console.error(`[tunnel] 放行接口返回 ${response.status} —— 若经隧道访问 403，重启服务后重跑本命令`);
    }
  } catch (error) {
    console.error(`[tunnel] 放行接口调用失败：${error instanceof Error ? error.message : String(error)}`);
  }

  console.log("");
  console.log("════════════════════════════════════════════════════════");
  console.log(`  出门地址（手机 5G 打开）：`);
  console.log(`  ${url}/pair`);
  console.log("");
  console.log(`  配对码在桌面「设置 → 手机与推送」；放行${allowOk ? "已生效" : "未生效(见上)"}`);
  console.log("  Ctrl+C 停止隧道；电脑重启后重跑 npm run tunnel 换新地址");
  console.log("════════════════════════════════════════════════════════");

  const stop = () => {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 3000).unref();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => {
    console.error(`[tunnel] cloudflared 退出（code=${code}）—— 重跑 npm run tunnel`);
    process.exit(code ?? 1);
  });
  // 守着：脚本活多久，隧道多久。
  setInterval(() => {}, 60_000);
}

main().catch((error) => {
  console.error("[tunnel]", error);
  process.exit(1);
});
