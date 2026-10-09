"use strict";

// pi-web 桌面壳（macOS）：在 Electron 里托管 Next.js 服务（next start），
// 复用 bin/pi-web.js 的启动方式，用 Electron 自身二进制（ELECTRON_RUN_AS_NODE=1）
// 当作 Node 来跑 next 的 CLI，避免依赖系统 Node。

// 宿主 shell（pi / 类 agent 环境）会注入这两个变量，会让 Electron 以纯 Node 模式
// 启动导致无窗口退出，这里必须清除，保证 app 本体正常进入 Electron 主流程。
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_RUNNING;

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerSaveBlocker,
  screen,
  shell,
  WebContentsView,
} = require("electron");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const APP_NAME = "PI NEXT";
/** Previous product names, newest first; the migration below picks the first that exists. */
const LEGACY_APP_NAMES = ["Pinkslab", "Pi Codex", "pi-web"];
// fork:lan-access —— 桌面壳与 `bin/pi-web.js` / `scripts/next-mode.mjs` 共用**同一份**
// 局域网绑定监督器（`build.files` 收 `bin/**`，所以打包后 require 得到）。
//
// 为什么以前桌面端「局域网」是死的：这里自己 spawn `next` 并自己挑 `-H`，从来没跑过
// 那份监督器，于是令牌建好了、网卡一直没绑，`lib/lan-access.ts` 的 `needsRebind`
// 永远是 true —— 界面就一直写着「正在开启局域网…/重启中」，二维码里的地址本机也连不上。
// 绑哪张网卡是 next 启动时定的、进程内改不了，所以「点一下立刻生效」只能由父进程重启
// 子进程；桌面壳就是那个父进程。
const { lanEnabledByConfig, superviseLanBind } = require("../bin/lan-supervisor.cjs");
// fork:rotate-preview-secrets —— 桌面壳自己 spawn `next start`，不走 bin/pi-web.js，
// 所以这里也必须接同一份轮换器（上游只接了 npm CLI 一条路径）。
const { rotatePreviewSecrets, getRotationWarning } = require("../bin/rotate-preview-secrets.js");
const { legacyUserDataSource } = require("./legacy-user-data");
const { attachRendererRecovery } = require("./renderer-recovery");
const {
  createCrashBudget,
  SERVER_RESTART_MAX_ATTEMPTS,
  SERVER_RESTART_MAX_DELAY_MS,
} = require("./server-crash-budget");
let mainWindow = null;
let tray = null;
let serverProc = null;
let serverPort = null;
/* fork:desktop-crash-budget —— 服务意外退出后的有界退避重启。
   预算状态从 main.js 本地的 `restartAttempt` 搬进这个模块（带单测），因为旧写法
   把清零写在 `startServer()` 里面，导致退避永远停在 1s、`MAX_ATTEMPTS` 从不触发。 */
const crashBudget = createCrashBudget();
/** `before-quit` 只跑一轮清理（否则 preventDefault + app.quit() 会自递归）。 */
let serverCleanupStarted = false;
/** fork:lan-access —— 当前绑的网卡（`0.0.0.0` = 局域网可达）与监督器的退订函数。 */
let lanHost = "127.0.0.1";
let stopLanSupervisor = null;
/** 换网卡的重启不算「意外退出」，否则下面的退避重启会和它抢同一个子进程。 */
let lanRebinding = false;
/** fork:proma-42-browser —— 受管浏览器宿主；startServer() 里赋值，will-quit 时停。 */
let browserHost = null;
let quitting = false;
let keepAwakeId = null;

// ── 路径解析 ────────────────────────────────────────────────────────────────
function getAppRoot() {
  // 打包后整个项目被平铺到 Contents/Resources/app（asar:false）
  return app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : path.join(__dirname, "..");
}

function getNextBin(appRoot) {
  const candidates = [
    path.join(appRoot, "node_modules", "next", "dist", "bin", "next"),
  ];
  try {
    candidates.push(require.resolve("next/dist/bin/next", { paths: [appRoot] }));
  } catch {
    /* fall through to candidates */
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// ── 端口分配 ────────────────────────────────────────────────────────────────
//
// fork:desktop-stable-port —— 端口必须**稳定**，这里以前是每次启动 listen(0)
// 拿一个随机空闲端口，于是窗口的 origin（http://127.0.0.1:<port>）每次都变。
// Chromium 的 localStorage 是按 origin 分库的，origin 一变就等于换了个空库：
// 用户在设置里改的主题、语言、聊天宽度、过程显示……全部“保存不下来”。
// （窗口大小却能记住 —— 它存在 userData/window-state.json，与 origin 无关。）
//
// 现在按固定端口依次尝试；全被占用才退回随机端口，而且那时设置会丢，
// 所以打一行警告。应用有 requestSingleInstanceLock，自己不会跟自己撞端口。
const DESKTOP_PORTS = [30142, 30143, 30144, 30145];

/** fork:desktop-ready-probe —— 就绪探测的三个地址（见 `waitReady` 头注）。 */
const READY_PROBE_HOSTS = ["127.0.0.1", "localhost", "::1"];

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/** 这个端口现在能占用吗（占一下再放掉）。 */
function canBind(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function pickPort(requested) {
  if (requested > 0 && requested < 65536) return requested;
  for (const port of DESKTOP_PORTS) {
    if (await canBind(port)) return port;
  }
  const fallback = await getFreePort();
  console.warn(
    `[pi-next] 固定端口 ${DESKTOP_PORTS.join("/")} 全被占用，退回随机端口 ${fallback}；` +
    "本次启动的界面设置不会保留（origin 变了）。",
  );
  return fallback;
}

// ── 启动 Next.js 服务 ───────────────────────────────────────────────────────
async function startServer(appRoot) {
  // fork:pr48-restart —— 重启时旧句柄可能还在（kill 未完全完成）。先掉引用，
  // 否则两次 spawn 的子进程都会挂 exit 监听，退避计数会翻倍。
  serverProc = null;
  // 优先使用外部指定的端口（冒烟测试/运维固定端口），否则用固定端口列表
  const requested = Number(process.env.PI_WEB_PORT || process.env.PORT || 0);
  const port = await pickPort(requested);
  const nextBin = getNextBin(appRoot);
  if (!nextBin) {
    dialog.showErrorBox(
      `${APP_NAME} 启动失败`,
      "找不到 Next.js CLI（node_modules/next/dist/bin/next），请重新打包。",
    );
    app.quit();
    return null;
  }

  const isDev = !app.isPackaged;
  const useDevServer = isDev && !fs.existsSync(path.join(appRoot, ".next"));

  // fork:rotate-preview-secrets（上游 cf3ebfba5）—— `next start` 之前把构建期固定的
  // previewModeId 换成新随机值，否则 `x-prerender-revalidate` 会跳过 proxy.ts。
  // dev 服务器没有 prerender manifest，跳过以免打无用告警。
  if (!useDevServer) {
    const rotation = rotatePreviewSecrets(path.join(appRoot, ".next"));
    if (!rotation.ok) console.warn(getRotationWarning(rotation.reason));
  }

  // fork:lan-access —— 开机就按那份配置选网卡（令牌存在且 enabled 就绑 0.0.0.0）；
  // 监督器负责之后 off→on / on→off 的自动重启。每次 startServer 都先退订上一个，
  // 否则崩溃重启会叠出第二个监督器，两个都去 kill 同一个子进程。
  if (stopLanSupervisor) {
    stopLanSupervisor();
    stopLanSupervisor = null;
  }
  lanHost = lanEnabledByConfig() ? "0.0.0.0" : "127.0.0.1";

  // spawn + 全部事件接线收成一处：换网卡的重启要走同一条路（参数只差一个 `-H`）。
  const spawnServer = (host) => {
    const args = useDevServer
      ? ["dev", "-H", host, "-p", String(port)]
      : ["start", "-p", String(port), "-H", host];
    const proc = spawn(process.execPath, [nextBin, ...args], {
      cwd: appRoot,
      // fork:lan-access —— `PI_WEB_HOSTNAME` 是服务端判定「真的绑上网卡了吗」的唯一
      // 依据（`lanAccessState()` → `needsRebind`），不给它界面就永远停在「重启中」。
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), PI_WEB_HOSTNAME: host },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // fork:desktop-crash-budget —— 记下它的出生时刻：退出时用它算存活时长，
    // 「跑够稳定窗口才翻篇」这条必须靠它，不能靠「我们调过 startServer」。
    proc.startedAt = Date.now();
    proc.stdout.on("data", (chunk) => process.stdout.write(chunk));
    proc.stderr.on("data", (chunk) => process.stderr.write(chunk));
    proc.on("error", (err) => {
      console.error("pi-web server spawn error:", err);
      app.quit();
    });
    proc.on("exit", (code, signal) => {
      if (serverProc === proc) serverProc = null;
      console.error(`pi-web server exited (code=${code} signal=${signal})`);
      // `lanRebinding` = 是监督器在换网卡，不是意外退出：不能去抢那个子进程。
      if (quitting || useDevServer || lanRebinding) return;
      // fork:pr48-restart —— 服务意外退出**不要立刻退出应用**。
      //
      // 原来这里直接 app.quit()：Next 服务一崩，整个窗口就停在“无法连接”的死页上，
      // 用户什么都没了。PR-47 的崩溃苏底页只管**渲染进程**崩（页面已经加载出来、
      // 只是某个视图炸了），管不了**服务进程**没���——那时候页面根本加载不出来。
      //
      // 现在改成有界退避重启：给几次机会，每次间隔翻倍。理由是多数“意外退出”是
      // 可恢复的（端口被占、临时 OOM、依赖装到一半），重启一下就回来了；而连续失败
      // 多次说明是真的起不来，那时候再退出，并**把最后一次原因带进提示里**。
      //
      // 退避上限 5 次 / 累计约 31s（1+2+4+8+16）。超过就退出 —— 无限重启会把用户
      // 锁在一个永远转圈的窗口里，比退出更糟。
      //
      // fork:desktop-crash-budget —— 判定搬进 `server-crash-budget.js`；那句「什么时候
      // 把预算还回去」原来写在 `startServer()` 结尾（`restartAttempt = 0`），而重启正是
      // 靠 startServer 完成的，所以计数器每次都被清零：退避永远 1s、上面那条上限
      // 从来没触发过。现在只有**稳定运行够久**才翻篇（见该模块头注）。
      const uptimeMs = typeof proc.startedAt === "number" ? Date.now() - proc.startedAt : 0;
      const verdict = crashBudget.recordExit(uptimeMs);
      if (verdict.exhausted) {
        dialog.showErrorBox(
          `${APP_NAME} 服务反复退出`,
          `本地服务连续 ${SERVER_RESTART_MAX_ATTEMPTS} 次启动失败，已关闭应用。最后一次退出：code=${code} signal=${signal ?? "-"}\n\n请检查终端输出后重试。`,
        );
        app.quit();
        return;
      }
      const delayMs = verdict.delayMs;
      console.warn(`[pi-next] 服务意外退出，${delayMs / 1000}s 后第 ${verdict.attempts}/${SERVER_RESTART_MAX_ATTEMPTS} 次重启…`);
      // 前端不用动：EventSource 在连接断开时会自己重连，服务端回来它就接上了。
      setTimeout(() => {
        if (quitting) return;
        startServer(getAppRoot()).catch((error) => {
          console.error("[pi-next] 服务重启失败:", error);
        });
      }, delayMs);
    });

    serverProc = proc;
    return proc;
  };

  lanRebinding = false;
  spawnServer(lanHost);

  // fork:lan-access —— 点「启动 / 停止」后由这里重启子进程生效，细节见
  // `bin/lan-supervisor.cjs` 的头注（去抖 500ms / 同方向最多 3 次 / 每次打日志）。
  stopLanSupervisor = superviseLanBind({
    getHost: () => lanHost,
    restart: (nextHost) => {
      if (nextHost === lanHost || quitting) return;
      const old = serverProc;
      lanHost = nextHost;
      lanRebinding = true;
      console.log(`[pi-next] 局域网改绑 ${nextHost}，重启本地服务…`);
      if (!old) {
        spawnServer(nextHost);
        return;
      }
      // 等它真的退了再拉起来：端口还在监听时新进程会直接 EADDRINUSE。
      old.once("exit", () => spawnServer(nextHost));
      old.kill("SIGTERM");
      // SIGTERM 没人接（卡住的 next）就别无限等下去。
      const force = setTimeout(() => {
        if (serverProc === old) old.kill("SIGKILL");
      }, 3000);
      force.unref?.();
    },
  });

  serverPort = port;
  console.log(`[pi-next] Next.js 服务启动: http://127.0.0.1:${port} (dev=${useDevServer}, lan=${lanHost})`);
  // fork:proma-42-browser —— 受管浏览器宿主。必须在 **serverPort 定下来之后**起：
  // 它要把自己注册进 ~/.pi/agent/browser-host.json，Web 端靠那个文件发现宿主；
  // 端口没定就注册会让服务端连到一个错的端口。
  const { createBrowserHost } = require("./browser-host");
  browserHost = createBrowserHost({ WebContentsView }, {
    getWindow: () => mainWindow,
    serverOrigin: () => (serverPort ? `http://127.0.0.1:${serverPort}` : null),
  });
  browserHost.start().catch((error) => {
    // 宿主起不来**不应该**让整个应用起不来：浏览器只是右栏的一个标签页，
    // 没它的时候用户仍能用「在默认浏览器打开」。
    console.error("[pi-next] 受管浏览器宿主启动失败（浏览器标签页会走降级）:", error);
  });
  return { port, useDevServer };
}

function waitReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    /* fork:desktop-ready-probe —— 只探 `127.0.0.1` 是不够的：局域网一开，服务绑的是
       `::`（双栈），某些环境下 v4 那一条会先吃一个 ECONNREFUSED；而 `localhost` 在
       本机可能先解析成 `::1`。三个地址轮着探，**任一通了就算就绪**，只有全部超时才失败。
       （ZCode 的开发态启动器同口径：localhost / 127.0.0.1 / [::1] 三个都轮。） */
    let settled = false;
    const probe = (host) => new Promise((done) => {
      const req = http.get({ host, port, path: "/" }, (res) => {
        res.resume();
        done(Boolean(res.statusCode && res.statusCode < 500));
      });
      req.on("error", () => done(false));
      req.setTimeout(1000, () => {
        req.destroy();
        done(false);
      });
    });
    const tick = async () => {
      if (settled) return;
      if (Date.now() > deadline) {
        settled = true;
        reject(new Error("等待 pi-web 服务就绪超时"));
        return;
      }
      for (const host of READY_PROBE_HOSTS) {
        if (await probe(host)) {
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }
      }
      setTimeout(() => { void tick(); }, 300);
    };
    void tick();
  });
}

// ── 窗口 ────────────────────────────────────────────────────────────────────
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  const state = loadWindowState();
  // fork:desktop-win — 窗口边框按平台分叉。
  //
  // macOS 保持 `hidden` + 原生红绿灯浮在应用自己的顶栏上（顶栏由 fork-ui.css 的
  // drag 区域负责拖动，lib/desktop-shell.ts 给 darwin 预留 64px 让位）。
  //
  // Windows 上不能用同一套：`titleBarStyle: "hidden"` 会连最小化/最大化/关闭一起
  // 去掉，而 `titleBarOverlay` 画出来的系统按钮区（约 138px）正好压在顶栏右侧的
  // 面板切换按钮上，应用又没有用 `env(titlebar-area-*)` 让位——结果是"能看见窗口
  // 但关不掉"。所以 Windows 保留系统原生边框：按钮一定可用，顶栏整体下移一条，
  // 拖动/双击最大化也由系统负责。`desktopTrafficLightInset()` 对非 darwin 返回 0，
  // 顶栏不会被多推一段空白。
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 940,
    minHeight: 600,
    title: APP_NAME,
    ...(isMac
      ? {
        // macOS keeps the native traffic lights and native fullscreen; the web app draws
        // its own bar, so the title bar stays hidden. `movable` is on and the renderer
        // marks the bar as a drag region (see lib/desktop-shell.ts + fork-ui.css) —
        // without that region a hidden-title-bar window cannot be dragged at all.
        titleBarStyle: "hidden",
        trafficLightPosition: { x: 14, y: 16 },
      }
      : { titleBarStyle: "default" }),
    movable: true,
    fullscreenable: true,
    backgroundColor: "#0f1117",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      spellcheck: false,
    },
  });

  if (state.maximized) mainWindow.maximize();

  for (const event of ["resize", "move"]) {
    mainWindow.on(event, () => saveWindowState(mainWindow));
  }
  mainWindow.on("close", (event) => {
    saveWindowState(mainWindow);
    // fork:close-to-tray — 关窗 = 收进托盘，而不是结束进程：后台任务（长回答、
    // 定时任务）不该因为用户顺手点一下关闭就断。托盘双击/单击恢复窗口，
    // 只有托盘「退出」、Cmd+Q 或 quitting 标记才真正退出。
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    mainWindow = null;
  });

  // fork:renderer-recovery —— 白屏是桌面端最糟的失败形态。
  // 崩溃/无响应/主框架加载失败由 electron/renderer-recovery.js 统一处理：
  // 有限次自动重启，超限回退到本地兜底页（electron/renderer-crash.html）。
  const recovery = attachRendererRecovery(mainWindow, {
    appName: APP_NAME,
    retryUrl: `http://127.0.0.1:${serverPort}`,
    crashPagePath: path.join(__dirname, "renderer-crash.html"),
    isQuitting: () => quitting,
  });
  mainWindow.on("closed", () => recovery.dispose());

  // 外部链接一律交给系统浏览器；页面内跳转到其它 host 也走同一规则
  //
  // fork:fix-desktop-blocked-nav — 这里必须留痕。
  // 之前被拦掉的导航是**静默**的（既不开系统浏览器也可能被 deny），
  // 用户看到的现象就是"某个按钮点了没反应、也不报错"，而主进程日志里什么都没有，
  // 排查只能靠猜。现在每次拦截都打一行日志，冒烟脚本会去收集它。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) {
      console.log(`[pi-next] blocked window.open → 交给系统浏览器: ${url}`);
      shell.openExternal(url);
    } else {
      console.log(`[pi-next] blocked window.open（非 http(s)/mailto，已丢弃）: ${url}`);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const target = new URL(url);
    if (target.port && Number(target.port) === serverPort) return;
    event.preventDefault();
    if (/^(https?|mailto):/.test(url)) {
      console.log(`[pi-next] blocked will-navigate → 交给系统浏览器: ${url}（应用内表现为"按钮无反应"）`);
      shell.openExternal(url);
    } else {
      console.log(`[pi-next] blocked will-navigate（非 http(s)/mailto，已丢弃）: ${url}`);
    }
  });

  const url = `http://127.0.0.1:${serverPort}`;
  // fork:proma-42-browser —— 把窗口交给浏览器宿主：它要在窗口上叠 WebContentsView
  // （那层画在 DOM 之外，所以必须在窗口创建之后 attach，不能在 start() 里做）。
  try { browserHost?.attach(); } catch (error) {
    console.error("[pi-next] 受管浏览器 attach 失败（标签页会走降级）:", error);
  }
  mainWindow.loadURL(url);
  return mainWindow;
}

// ── 原生集成（通知 / Dock 角标 / 防休眠 / 外部工具） ─────────────────────────
function setupDesktopIpc() {
  ipcMain.handle("desktop:notify", (_event, payload) => {
    if (!Notification.isSupported()) return false;
    const { title, body, tag, url } = payload ?? {};
    if (!title && !body) return false;
    const notification = new Notification({
      title: String(title ?? APP_NAME),
      body: String(body ?? ""),
      // The app already plays its own completion sound; the system one would double it.
      silent: payload?.silent !== false,
      ...(tag ? { tag: String(tag) } : {}),
    });
    notification.on("click", () => {
      showWindow();
      if (url) {
        mainWindow?.webContents.send("desktop:action", { kind: "notification-clicked", url: String(url) });
      }
    });
    notification.show();
    return true;
  });

  ipcMain.on("desktop:badge", (_event, text) => {
    // Dock badge: the macOS-native place for "there are unread conversations".
    if (process.platform !== "darwin" || !app.dock) return;
    app.dock.setBadge(text ? String(text) : "");
  });

  ipcMain.on("desktop:keep-awake", (_event, active) => {
    // Long agent runs should not be interrupted by the display sleeping.
    if (active && keepAwakeId === null) {
      keepAwakeId = powerSaveBlocker.start("prevent-display-sleep");
    } else if (!active && keepAwakeId !== null) {
      powerSaveBlocker.stop(keepAwakeId);
      keepAwakeId = null;
    }
  });

  ipcMain.on("desktop:open-external", (_event, url) => {
    if (typeof url === "string" && /^(https?|mailto):/.test(url)) void shell.openExternal(url);
  });

  ipcMain.on("desktop:reveal", (_event, target) => {
    if (typeof target === "string" && target) shell.showItemInFolder(target);
  });

  // The renderer keeps its own palette; this only tells it when the *system* flipped
  // so an "auto" palette can follow without a reload.
  nativeTheme.on("updated", () => {
    mainWindow?.webContents.send("desktop:action", {
      kind: "theme-changed",
      dark: nativeTheme.shouldUseDarkColors,
    });
  });
}

function showWindow() {
  const win = createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function setupTray() {
  const isMac = process.platform === "darwin";
  // fork:desktop-win — macOS 用 template 图标（单色遮罩，系统按亮/暗自动反白）；
  // Windows 托盘铺在深色任务栏上，同一个黑色字形等于看不见，所以改用彩色应用图标
  // 并缩到 16px。extraResources 里的 appIcon.png 与 build/icon.png 是同一张图。
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, isMac ? "trayTemplate.png" : "appIcon.png")
    : path.join(getAppRoot(), "build", isMac ? "trayTemplate.png" : "icon.png");
  if (!fs.existsSync(iconPath)) return;

  // Template image must be set on the nativeImage, not on the Tray (Tray has no
  // setTemplateImage — calling it throws an unhandled rejection and the menu bar
  // icon keeps its original colours).
  let trayIcon = nativeImage.createFromPath(iconPath);
  if (isMac) trayIcon.setTemplateImage(true);
  else trayIcon = trayIcon.resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip(APP_NAME);
  tray.on("click", showWindow);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示窗口", click: showWindow },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// ── 改名后的一次性迁移 ──────────────────────────────────────────────────────
// The product name decides `app.getPath("userData")`, and the renderer keeps its
// window geometry, drafts and layout state there (localStorage), so a renamed
// product would silently start with an empty directory. Copy the newest legacy
// one once (a user can arrive from any older name, pi-web or Pi Codex).
function migrateLegacyUserData() {
  if (process.platform !== "darwin") return;
  try {
    const support = path.join(app.getPath("appData"));
    const legacy = legacyUserDataSource(support, APP_NAME, LEGACY_APP_NAMES);
    if (!legacy) return;
    const next = path.join(support, APP_NAME);
    fs.cpSync(legacy, next, { recursive: true });
    console.log(`[pi-next] migrated user data: ${legacy} → ${next}`);
  } catch (error) {
    console.error("[pi-next] user data migration failed:", error);
  }
}

// ── 窗口位置/尺寸记忆 ───────────────────────────────────────────────────────
function windowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState() {
  const fallback = { width: 1280, height: 820 };
  try {
    const parsed = JSON.parse(fs.readFileSync(windowStatePath(), "utf8"));
    const state = { width: Number(parsed.width) || fallback.width, height: Number(parsed.height) || fallback.height };
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      // Keep the window on a screen that still exists (a monitor may be gone).
      const area = screen.getDisplayMatching({ x: parsed.x, y: parsed.y, width: state.width, height: state.height }).workArea;
      const onScreen = parsed.x + 80 > area.x && parsed.y + 40 > area.y && parsed.x < area.x + area.width - 80 && parsed.y < area.y + area.height - 40;
      if (onScreen) {
        state.x = parsed.x;
        state.y = parsed.y;
      }
    }
    if (parsed.maximized === true) state.maximized = true;
    return state;
  } catch {
    return fallback;
  }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    fs.writeFileSync(windowStatePath(), JSON.stringify({
      ...bounds,
      maximized: win.isMaximized(),
    }, null, 2));
  } catch (error) {
    console.error("[pi-next] failed to persist window state:", error);
  }
}

// ── 应用生命周期 ────────────────────────────────────────────────────────────
// fork:pack-smoke —— 打包冒烟旁路：单实例锁按 userData 路径判定，把它指到
// 临时目录就能在不退出正在使用的正式实例的情况下冒烟打包产物（pack-mac-dmg
// 的 Step 6 和真窗口验证都靠它；此前只能 osascript 退出用户的 app）。
if (process.env.PI_WEB_USER_DATA_DIR) {
  app.setPath("userData", process.env.PI_WEB_USER_DATA_DIR);
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  // fork:proma-42-browser —— 退出时停宿主：它持有 WebContentsView 与 CDP 调试通道，
  // 不停会留下孤儿视图（退出时被系统回收，但调试端口可能占着）。
  app.on("will-quit", () => {
    try { browserHost?.stop(); } catch { /* 退出路径上不抛 */ }
  });

  // Must run before the first window/state write so the migrated state is the one
  // that gets read.
  migrateLegacyUserData();

  app.whenReady().then(async () => {
    const appRoot = getAppRoot();
    if (!fs.existsSync(path.join(appRoot, ".next"))) {
      dialog.showErrorBox(
        `${APP_NAME} 缺少构建产物`,
        ".next 目录不存在。打包前请先执行 npm run build。",
      );
      app.quit();
      return;
    }

    const result = await startServer(appRoot);
    if (!result) return;
    try {
      await waitReady(result.port, 90_000);
    } catch (err) {
      console.error(err.message);
      app.quit();
      return;
    }

    // 角色化菜单：Cmd+Q/W/M/H、复制粘贴、缩放、原生全屏等快捷键自动生效
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      version: `Electron ${process.versions.electron} · Node ${process.versions.node}`,
      copyright: "PI NEXT — local coding agent workbench",
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        // fork:desktop-win — `appMenu` 是 macOS 专有 role。Windows 上它不报错，
        // 但会留下一个空的顶级菜单项（"应用" 点了没东西），所以只在 darwin 加。
        ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
        { role: "fileMenu" },
        { role: "editMenu" },
        {
          label: "视图",
          submenu: [
            { role: "reload" },
            { role: "forceReload" },
            { role: "toggleDevTools" },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        { role: "windowMenu" },
        {
          role: "help",
          submenu: [
            {
              label: "GitHub 仓库",
              click: () => void shell.openExternal("https://github.com/greenfriends6688/PI-NEXT"),
            },
            {
              label: "打开数据目录",
              click: () => void shell.openPath(app.getPath("userData")),
            },
            { type: "separator" },
            {
              label: "显示窗口",
              click: showWindow,
            },
          ],
        },
      ]),
    );

    setupDesktopIpc();
    createWindow();
    setupTray();

    app.on("activate", () => {
      // macOS 上点击 Dock 图标时若无窗口则重建
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });
}

// macOS 上关闭全部窗口不退出应用
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    quitting = true;
    app.quit();
  }
});

app.on("before-quit", (event) => {
  quitting = true;
  if (keepAwakeId !== null) {
    powerSaveBlocker.stop(keepAwakeId);
    keepAwakeId = null;
  }
  /* fork:desktop-quit-cleanup —— 原来这里只发一次 SIGTERM 就放行退出：
     Next 会派生子 worker，一次信号被吞就留下**孤儿 next 进程**占着端口，
     下次启动直接 EADDRINUSE（表现就是「壳子老是连不上」）。
     现在：SIGTERM → 3s 后 SIGKILL 兑底 → 等它真的退了再放行退出；
     最多等 5s，超时也放行（不能因为子进程卡住就退不掉应用）。
     `serverCleanupStarted` 只让这一轮清理跑一次 —— 否则 preventDefault +
     app.quit() 会自递归。 */
  if (serverCleanupStarted || !serverProc || serverProc.killed) return;
  serverCleanupStarted = true;
  event.preventDefault();
  const proc = serverProc;
  proc.kill("SIGTERM");
  const forceKill = setTimeout(() => {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* 已经退了 */
    }
  }, 3000);
  forceKill.unref?.();
  const proceed = () => {
    clearTimeout(forceKill);
    clearTimeout(giveUp);
    app.quit();
  };
  const giveUp = setTimeout(proceed, 5000);
  giveUp.unref?.();
  proc.once("exit", proceed);
});