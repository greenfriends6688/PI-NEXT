"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync, readFileSync } = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { homedir } = require("node:os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { join } = require("node:path");

/**
 * 启动器这一半的局域网判定：**「手机能连上」不是配置问题，是绑定问题**。
 *
 * 之前只有 `-H 0.0.0.0`（或 `npm run dev:lan`）才能让手机连上，而设置里的开关只写了
 * `lan-access.json` —— 那个文件服务端读得到，可 Next 进程早就绑在 127.0.0.1 上了，
 * 于是「开关打开了、手机还是连不上」。用户实测反馈的就是这个。
 *
 * 现在的规则（fail closed）：
 * - `-H` / `PI_WEB_HOSTNAME` 显式给了具体地址 → 听用户的，一个字节不改。
 * - 没给，且 `~/.pi/agent/lan-access.json` 里 `enabled: true` 且令牌合法 → 绑通配地址
 *   `0.0.0.0`（IPv6 也听，Node 默认双栈），并在终端打印每个网卡的地址。
 * - 没给，且文件不存在 / `enabled: false` / 坏了 → 仍然只绑回环。
 *
 * 令牌格式与 `lib/lan-access.ts` 里那份校验保持一致（32-128 位十六进制）。
 */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const WILDCARD = "0.0.0.0";
const TOKEN_PATTERN = /^[0-9a-f]{32,128}$/i;

function agentDir(env = process.env) {
  // pi 的 ENV_AGENT_DIR 是 `<APP>_CODING_AGENT_DIR`，APP 名默认 "pi"。
  const override = env.PI_CODING_AGENT_DIR;
  if (override) return override.startsWith("~") ? join(homedir(), override.slice(1)) : override;
  return join(homedir(), ".pi", "agent");
}

function lanAccessConfigPath(env = process.env) {
  return join(agentDir(env), "lan-access.json");
}

/** 读 `lan-access.json`；不存在、坏了、关了、令牌形状不对都返回 null。 */
function readLanAccessConfig(env = process.env) {
  const path = lanAccessConfigPath(env);
  if (!existsSync(path)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
  if (!TOKEN_PATTERN.test(token)) return null;
  if (parsed.enabled === false) return null;
  return { token, enabled: true };
}

/** 这次运行要不要接受局域网访问（令牌在、且没被显式关掉）。 */
function lanAccessEnabled(env = process.env) {
  const fromEnv = (env.PI_WEB_LAN_TOKEN || "").trim();
  if (fromEnv) return true;
  return readLanAccessConfig(env) !== null;
}

/**
 * 最终绑定的地址。`requested` 是 `-H` / `PI_WEB_HOSTNAME` / 缺省的 "127.0.0.1"。
 * `explicit` 表示用户自己给了地址（那就照办）。
 */
function resolveHostname({ requested, explicit, env = process.env }) {
  if (explicit) return requested;
  if (!LOOPBACK_HOSTNAMES.has(requested)) return requested;
  return lanAccessEnabled(env) ? WILDCARD : requested;
}

/** 手机该打开的地址（通配绑定时列出每个网卡；具体地址原样返回）。 */
function reachableUrls(hostname, port) {
  if (String(port) === "0") return [];
  if (!["0.0.0.0", "::", "[::]"].includes(hostname)) {
    const host = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
    return [`http://${host}:${port}`];
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { networkInterfaces } = require("node:os");
  const urls = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const info of addresses ?? []) {
      if (String(info.family) !== "IPv4" || info.internal || info.address.startsWith("169.254.")) continue;
      urls.push(`http://${info.address}:${port}`);
    }
  }
  return urls;
}

module.exports = {
  WILDCARD,
  agentDir,
  lanAccessConfigPath,
  lanAccessEnabled,
  readLanAccessConfig,
  reachableUrls,
  resolveHostname,
};
