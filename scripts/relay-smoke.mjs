#!/usr/bin/env node
/**
 * fork:mobile-shell —— 自建中继全链路冒烟（node scripts/relay-smoke.mjs）。
 *
 * 本机一条龙验证「手机 → 中继 → Mac 拨号端 → 本机服务」：
 *   1. 用 deno 起中继（:9800，RELAY_TOKEN=smoke-token）
 *   2. 用 lib/relay-dialer.ts 真拨号（配置指向 127.0.0.1:9800，目标 = 30141 的真服务）
 *   3. 穿透请求验证：/api/home（JSON）、/（大 HTML 多分片流式）、
 *      /api/sync/manifest（同步清单）、POST /api/lan/pair/redeem（带 body 的请求）
 * 前置：30141 有跑着的服务（npm run prod / dev:clean）。
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RELAY_PORT = 9800;
const SERVER_ID = "smoke-test";
const TOKEN = "smoke-token";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // 1. 中继（deno）
  const deno = spawn("deno", ["run", "--allow-net", "--allow-env", "relay/deno/relay.ts"], {
    env: { ...process.env, RELAY_TOKEN: TOKEN, PORT: String(RELAY_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  deno.stdout.on("data", () => {});
  deno.stderr.on("data", (data) => process.stderr.write(`[relay] ${data}`));
  try {
    // 等中继监听
    for (let i = 0; i < 40; i += 1) {
      try {
        const health = await fetch(`http://127.0.0.1:${RELAY_PORT}/_health`);
        if (health.ok) break;
      } catch { /* not yet */ }
      await wait(250);
    }

    // 2. 拨号端（真代码，临时配置）
    const { createJiti } = await import("jiti");
    const jiti = createJiti(import.meta.url, { moduleCache: false });
    const dialer = await jiti.import("../lib/relay-dialer.ts");
    const tempDir = mkdtempSync(join(tmpdir(), "pi-relay-smoke-"));
    const configPath = join(tempDir, "relay-link.json");
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      url: `http://127.0.0.1:${RELAY_PORT}`,
      token: TOKEN,
      serverId: SERVER_ID,
      createdAt: new Date().toISOString(),
    }));
    dialer.setRelayLinkConfigPathForTests(configPath);
    dialer.startRelayDialer();

    // 等连接建立
    let state = dialer.getRelayDialerState();
    for (let i = 0; i < 40 && state.status !== "connected"; i += 1) {
      await wait(250);
      state = dialer.getRelayDialerState();
    }
    if (state.status !== "connected") {
      throw new Error(`dialer did not connect: ${state.status} ${state.lastError ?? ""}`);
    }
    console.log(`✔ 拨号端已连上中继（${state.url}）`);

    // 3. 穿透验证
    const base = `http://127.0.0.1:${RELAY_PORT}/m/${SERVER_ID}`;
    let failures = 0;
    const check = (ok, label, detail = "") => {
      if (!ok) failures += 1;
      console.log(`${ok ? "✔" : "✘"} ${label}${detail ? ` —— ${detail}` : ""}`);
    };

    const home = await fetch(`${base}/api/home`);
    check(home.status === 200, "穿透 GET /api/home", `status=${home.status}`);
    const homeBody = await home.json().catch(() => null);
    check(Boolean(homeBody && typeof homeBody === "object"), "返回 JSON 可解析");

    const page = await fetch(`${base}/`);
    const pageText = await page.text();
    check(
      page.status === 200 && /text\/html/.test(page.headers.get("content-type") ?? "")
        && pageText.length > 10000,
      "穿透 GET /（大 HTML 多分片流式）",
      `status=${page.status} bytes=${pageText.length}`,
    );

    const manifest = await fetch(`${base}/api/sync/manifest`);
    const manifestBody = await manifest.json().catch(() => null);
    check(
      manifest.status === 200 && Array.isArray(manifestBody?.sessions),
      "穿透 GET /api/sync/manifest（镜像同步的数据源）",
      `sessions=${manifestBody?.sessions?.length ?? "?"}`,
    );

    const redeem = await fetch(`${base}/api/lan/pair/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    check(
      redeem.status === 401 || redeem.status === 409,
      "穿透 POST 带请求体（兑码错误码被正确拒绝，说明闸门在）",
      `status=${redeem.status}`,
    );

    // 4. 中继断开后，穿透应当 502（而不是无限等）
    dialer.stopRelayDialer();
    await wait(300);
    const down = await fetch(`${base}/api/home`);
    check(down.status === 502, "拨号端断开后穿透拿 502", `status=${down.status}`);

    console.log(failures === 0 ? "\n全链路冒烟通过。" : `\n${failures} 项失败。`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    deno.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("smoke failed:", error);
  process.exit(1);
});
