"use strict";

/**
 * fork:lan-access —— 局域网绑定的**监督器**（两个启动器共用一份）。
 *
 * 绑哪张网卡是 `next start` 启动时定的，**进程内改不了**。MusePi 之所以能「点一下启动
 * 立刻生效」，是因为它的 relay 由 daemon 在运行中自己开另一个 socket（`collab/local-share.ts`）；
 * 本仓只有一个 Next 服务，所以只能由**父进程**重启子进程来生效。
 *
 * 规则收得很窄，因为重启会打断正在跑的会话：
 * - `false → true`（用户点「启动」）：自动重启，立刻能用。
 * - `true → false`（用户点「停止」）：自动重启，回到只绑本机。
 * - **换令牌：不重启**，只是下次启动生效（那会作废所有已发的链接，重启时机交给用户）。
 *
 * 护栏：去抖 500ms；同方向最多自动重启 3 次（防配置抖动变成重启循环）；每次都打日志。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const CONFIG_FILE = "lan-access.json";
const AUTO_RESTART_LIMIT = 3;
const DEBOUNCE_MS = 500;

/** 与 SDK 的 getAgentDir() 一致（`dist/config.js:450`）：env 优先，否则 ~/.pi/agent。 */
function lanConfigPath(env = process.env) {
  // `PI_CODING_AGENT_DIR` 指的是**目录**（与 SDK 的 getAgentDir() 同义），所以要拼上文件名。
  const explicit = (env.PI_CODING_AGENT_DIR || "").trim();
  return explicit ? path.join(explicit, CONFIG_FILE) : path.join(os.homedir(), ".pi", "agent", CONFIG_FILE);
}

/** 与 `lib/lan-access.ts` 的形状校验一致：形状不对当没配（fail closed）。 */
function lanEnabledByConfig(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(lanConfigPath(env), "utf8"));
    const token = typeof parsed?.token === "string" ? parsed.token.trim() : "";
    return parsed?.enabled !== false && /^[0-9a-f]{32,128}$/i.test(token);
  } catch {
    return false;
  }
}

/**
 * 盯住那份配置；开关变了就重启。`getHost()` 返回当前绑的网卡，`restart()` 重启子进程。
 *
 * @param {{ getHost: () => string, restart: (nextHost: string) => void, env?: NodeJS.ProcessEnv, log?: (line: string) => void }} options
 * @returns {() => void} 取消监听（测试用）
 */
function superviseLanBind(options) {
  const { getHost, restart, env = process.env, log = (line) => console.warn(line) } = options;
  const target = lanConfigPath(env);
  let last = lanEnabledByConfig(env);
  let restarts = 0;
  let timer = null;

  const onChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const next = lanEnabledByConfig(env);
      if (next === last) return;
      last = next;
      if (restarts >= AUTO_RESTART_LIMIT) {
        log("[pi-web] 局域网开关变了太多次，不再自动重启；请手动重启一次。");
        return;
      }
      restarts += 1;
      const host = next ? "0.0.0.0" : "127.0.0.1";
      if (host === getHost()) return;
      log(`[pi-web] 局域网接入${next ? "已开启" : "已关闭"}，正在重启以生效（${restarts}/${AUTO_RESTART_LIMIT}）…`);
      restart(host);
    }, DEBOUNCE_MS);
  };

  const relevant = (filename) => !filename || String(filename).endsWith(CONFIG_FILE);

  // 两次监听**各自**兜错：文件还不存在时 `fs.watch(文件)` 直接抛 ENOENT，
  // 如果两个监听写在同一个 try 里，第一处失败会连带把目录监听也丢掉 —— 那样就永远收不到
  // 「用户第一次打开面板生成配置」这个事件（这个坑真踩过：令牌建了，网卡一直没绑上）。
  try {
    if (fs.existsSync(target)) {
      fs.watch(target, { persistent: false }, (_event, filename) => {
        if (relevant(filename)) onChange();
      });
    }
  } catch {
    // 盯不住这个文件就算了，目录监听还在。
  }
  try {
    // 目录级监听负责「文件从无到有」（令牌刚生成）与「原地改写」两种情况。
    fs.watch(path.dirname(target), { persistent: false }, (_event, filename) => {
      if (relevant(filename)) onChange();
    });
  } catch {
    // 盯不住就算了：手动重启一样生效，不影响功能。
  }

  return () => {
    if (timer) clearTimeout(timer);
  };
}

module.exports = { lanConfigPath, lanEnabledByConfig, superviseLanBind, AUTO_RESTART_LIMIT };