"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const CLI_OPTIONS = {
  port: { type: "string", short: "p" },
  hostname: { type: "string", short: "H" },
  "no-lan": { type: "boolean" },
  "no-open": { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

/**
 * fork:lan-access —— 启动器侧的「手机能不能连上」。
 *
 * 用户 2026-10-03 的原话是「默认给我暂停，还让我自己启动」：之前绑哪张网卡只能靠命令行
 * 传 `-H 0.0.0.0`，而令牌又只能从 env 来，所以「开箱能用」和「不裸奔」被做成了二选一。
 * 现在反过来：**应用自己生成并存了令牌**（`~/.pi/agent/lan-access.json`，见
 * `lib/lan-access.ts`），启动器只要看到这份配置就自动绑 0.0.0.0，闸门同步生效。
 *
 * 优先级（从高到低）：`--hostname` / `PI_WEB_HOSTNAME` → `--no-lan` → 有令牌则 `::`（双栈） → 127.0.0.1。
 * 文件不存在或损坏 = 没令牌 = 只绑 loopback（fail closed，绝不退回裸奔）。
 */
function readLanAccessState(env) {
  // env 是操作员显式给的，形状由他负责（MusePi 的 --remote-token 也只要求 ≥16）。
  const token = (env.PI_WEB_LAN_TOKEN || "").trim();
  if (token) return { lan: true, source: "env" };
  try {
    const { readFileSync } = require("fs");
    const { join } = require("path");
    const { homedir } = require("os");
    // **与 SDK 的 getAgentDir() 逐项一致**（`dist/config.js:450`）：
    // PI_CODING_AGENT_DIR 优先，否则 ~/.pi/agent。两边算错路径 = 启动器以为没令牌而
    // 应用以为有，于是「以为裸奔其实没开」或反过来 —— 所以这里必须对齐常量。
    const agentDir = (env.PI_CODING_AGENT_DIR || "").trim() || join(homedir(), ".pi", "agent");
    const parsed = JSON.parse(readFileSync(join(agentDir, "lan-access.json"), "utf8"));
    const stored = typeof parsed?.token === "string" ? parsed.token.trim() : "";
    // 存盘的那份是我们自己生成的，所以**要验形状**：手写的、旧的、空壳的都当没配。
    if (parsed?.enabled !== false && /^[0-9a-f]{32,128}$/i.test(stored)) return { lan: true, source: "config" };
  } catch {
    // 没有 / 坏了 / 读不到 → 当作没令牌（fail closed）
  }
  return { lan: false, source: "none" };
}

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function normalizePort(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("Port must be a non-negative integer.");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error("Port must be between 0 and 65535.");
  }

  return String(port);
}

function getHelpText() {
  return `Usage: pi-web [options]

Start the Pi Web UI server.

Options:
  -p, --port <port>          Server port (default: 30141, or PORT)
  -H, --hostname <host>      Bind hostname (default: 127.0.0.1, or PI_WEB_HOSTNAME)
      --no-lan               Never bind the LAN, even if a LAN token is stored
      --no-open              Do not open a browser automatically
  -h, --help                 Show this help message and exit

Environment:
  PORT                       Default port when --port is omitted
  PI_WEB_HOSTNAME            Default hostname when --hostname is omitted
  PI_WEB_NO_OPEN             Set to 1/true/yes/on to disable browser open
  PI_WEB_LAN_TOKEN           Require this token for requests that do not come from
                             this machine. Takes precedence over the stored one.
                             A token is generated and stored on first start
                             (~/.pi/agent/lan-access.json); when one exists the
                             server binds 0.0.0.0 by itself so a phone can pair.
  PI_WEB_ALLOWED_HOSTS       Extra exact proxy/custom hostnames, comma-separated
  PI_WEB_SKIP_VERSION_CHECK  Set to 1 to disable Pi Web update checks
  PI_WEB_IDLE_TIMEOUT_MS     Session idle timeout in ms (0 disables; default 600000)
  PI_WEB_MAX_BODY_SIZE       Max buffered request body (default 128mb)
`;
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: CLI_OPTIONS,
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const err = new Error(`${message}\nUse --help to see available options.`);
    err.code = "ERR_PARSE_ARGS_UNKNOWN_OPTION";
    throw err;
  }

  if (values.help) {
    return { help: true };
  }

  if (positionals.length > 0) {
    throw new Error(
      `Unexpected argument(s): ${positionals.join(" ")}\nUse --help to see available options.`,
    );
  }

  // fork:lan-access —— 没显式指定网卡时：有令牌就绑 `::`（双栈：macOS/Linux 默认
  // v6only=0，同时收 IPv4 与 IPv6——IPv6 是「出门 5G 直连」的唯一通道），否则只绑 loopback。
  const explicitHostname = values.hostname ?? env.PI_WEB_HOSTNAME;
  const lan = readLanAccessState(env);
  const hostname = explicitHostname ?? (values["no-lan"] ? "127.0.0.1" : lan.lan ? "::" : "127.0.0.1");

  return {
    help: false,
    port: normalizePort(values.port ?? env.PORT ?? "30141"),
    hostname,
    lan,
    noLan: Boolean(values["no-lan"]),
    openBrowser: !values["no-open"] && !isEnabled(env.PI_WEB_NO_OPEN),
  };
}

module.exports = { parseLaunchOptions, getHelpText, readLanAccessState };
