#!/usr/bin/env node
/**
 * fork:mobile-shell —— 手机远程访问自检（`npm run mobile:doctor`）。
 *
 * 检查「手机在局域网外打开 PI NEXT」这条链路的每一环，全部通过时打印手机上该打开的
 * 地址。零依赖、只读：不写任何文件、不改任何配置。
 *
 * 检查项（顺序即报告顺序）：
 *   1. LAN 令牌（~/.pi/agent/lan-access.json 存在且 enabled）—— 没有 = 闸门没开，
 *      远程地址就是唯一的秘密（`lib/lan-access.ts` 的 checkLanAccess 无令牌恒放行）。
 *   2. 本机网卡地址列表（与 `lib/lan-pair.ts` listLanUrls 同一个过滤器），
 *      Tailscale 的 100.64/10 地址单独标出 —— 它是「家里外面同一个地址」的那一个。
 *   3. tailscale CLI（`tailscale ip -4`）—— 装了才有 100.x 地址。
 *   4. 服务探活（本机端口）。
 *   5. `PI_WEB_ALLOWED_HOSTS`（域名隧道场景才需要；IP 访问不用配）。
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const portFlag = args.indexOf("--port");
const PORT = Number(
  portFlag >= 0 ? args[portFlag + 1] : (process.env.PORT ?? "30141"),
);

const agentDir = process.env.PI_CODING_AGENT_DIR
  ?? join(homedir(), ".pi", "agent");

const lines = [];
let failures = 0;
function check(ok, label, detail = "") {
  if (!ok) failures += 1;
  lines.push(`${ok ? "✔" : "✘"} ${label}${detail ? ` —— ${detail}` : ""}`);
}
function info(label, detail = "") {
  lines.push(`  ${label}${detail ? ` —— ${detail}` : ""}`);
}

// 1. LAN 令牌 ---------------------------------------------------------------
const lanConfigPath = join(agentDir, "lan-access.json");
let lanConfig = null;
if (existsSync(lanConfigPath)) {
  try {
    const parsed = JSON.parse(readFileSync(lanConfigPath, "utf8"));
    if (parsed && typeof parsed === "object" && typeof parsed.token === "string") {
      lanConfig = parsed;
    }
  } catch {
    // 文件损坏按没配算（与 lib/lan-access.ts 的 fail closed 一致）
  }
}
const tokenOk = Boolean(
  lanConfig && lanConfig.enabled !== false && /^[0-9a-f]{32,128}$/i.test(lanConfig.token ?? ""),
);
check(
  tokenOk,
  "LAN 令牌闸门",
  tokenOk
    ? `${lanConfigPath} 已开`
    : "未开启 —— 先在桌面「设置 → 手机与推送」点「启动」，否则远程地址就是唯一的秘密",
);

// 2. 网卡地址 ---------------------------------------------------------------
// 与 lib/lan-pair.ts listLanUrls 同一个过滤器：剔 internal 与 169.254 链路本地。
const isIpv4 = (info) => String(info?.family) === "4" || info?.family === "IPv4";
const lanAddresses = [];
for (const addresses of Object.values(networkInterfaces())) {
  for (const entry of addresses ?? []) {
    if (!isIpv4(entry) || entry.internal) continue;
    if (entry.address.startsWith("169.254.")) continue;
    lanAddresses.push(entry.address);
  }
}
const isTailscaleAddress = (address) =>
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address);
const tailscaleAddresses = lanAddresses.filter(isTailscaleAddress);
const plainLanAddresses = lanAddresses.filter((a) => !isTailscaleAddress(a));

check(
  lanAddresses.length > 0,
  "本机可达地址",
  lanAddresses.join(", ") || "一块可用网卡都没找到",
);
for (const address of plainLanAddresses) {
  info(`局域网地址`, `http://${address}:${PORT}`);
}
for (const address of tailscaleAddresses) {
  info(`Tailscale 地址（家里/外面同一个）`, `http://${address}:${PORT}`);
}

// IPv6 全局地址：**出门 5G 直连**的通道（国内 5G 基本支持 IPv6；家里宽带通常有公网
// IPv6 段）。剔掉链路本地（fe80）与回环；带 %zone 的接口后缀去掉。
const globalV6Addresses = [];
for (const addresses of Object.values(networkInterfaces())) {
  for (const entry of addresses ?? []) {
    const isV6 = String(entry?.family) === "6" || entry?.family === "IPv6";
    if (!isV6 || entry.internal) continue;
    const address = entry.address.split("%")[0];
    if (address.startsWith("fe80")) continue;
    globalV6Addresses.push(address);
  }
}
for (const address of globalV6Addresses) {
  info(`IPv6 地址（出门 5G 用这个）`, `http://[${address}]:${PORT}`);
}

// 3. tailscale CLI ----------------------------------------------------------
let tailscaleIp = null;
try {
  const { stdout } = await execFileAsync("tailscale", ["ip", "-4"], { timeout: 5000 });
  tailscaleIp = stdout.trim().split("\n")[0]?.trim() || null;
} catch {
  tailscaleIp = null;
}
info(
  "tailscale CLI",
  tailscaleIp
    ? `已安装，本机 tailnet IP ${tailscaleIp}`
    : "未安装（可选）—— 手机与电脑各装一个（免费），才有「不在局域网也能用」的稳定地址",
);

// 4. 服务探活 ---------------------------------------------------------------
let serverUp = false;
try {
  const response = await fetch(`http://127.0.0.1:${PORT}/api/home`, {
    signal: AbortSignal.timeout(3000),
  });
  serverUp = response.ok;
} catch {
  serverUp = false;
}
check(
  serverUp,
  `服务探活 (127.0.0.1:${PORT})`,
  serverUp ? "正常" : "没起来 —— 先 npm run prod（或 dev:clean）",
);

// 5. 放行域名 ---------------------------------------------------------------
const allowedHosts = (process.env.PI_WEB_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
info(
  "PI_WEB_ALLOWED_HOSTS",
  allowedHosts.length > 0
    ? allowedHosts.join(", ")
    : "未配置（走 IP 访问不需要；用 tailscale serve / cloudflared 域名时才把域名加进来，逗号分隔）",
);

// 汇总 ----------------------------------------------------------------------
const recommended = tailscaleAddresses[0] ?? plainLanAddresses[0];
lines.push("");
if (tokenOk && serverUp && recommended) {
  lines.push(`手机上打开：  http://${recommended}:${PORT}/pair`);
  lines.push("（或在桌面「设置 → 手机与推送」扫二维码；配对一次后该地址永久有效）");
  if (!tailscaleAddresses.length) {
    lines.push("提示：现在给的是局域网地址，出了这个网络就够不着。装 Tailscale 后重跑本命令。");
  }
  if (globalV6Addresses[0]) {
    lines.push(`出门 5G 直连： http://[${globalV6Addresses[0]}]:${PORT}/pair`);
    lines.push("（手机流量下打开这个；打不开多半是路由器的 IPv6 防火墙拦了入站，去路由器管理页放行）");
  }
} else {
  lines.push("先把上面的 ✘ 项解决，再回来重跑 npm run mobile:doctor。");
}
console.log(lines.join("\n"));
process.exit(failures > 0 ? 1 : 0);
