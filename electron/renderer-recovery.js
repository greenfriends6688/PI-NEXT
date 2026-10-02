"use strict";

// fork:renderer-recovery —— 渲染进程崩溃自动恢复 + 兜底页。
//
// 背景：Electron 里主界面渲染进程一旦崩溃（或长时间无响应），窗口就停在白屏上，
// 用户除了强杀没有别的出路。这里把「崩溃判定 + 有限次自动重启 + 失败兜底页」
// 从 `main.js` 里抽出来，主进程只负责挂接线（见 main.js 的 `createWindow()`）。
//
// 关键不变量：
//   1. 自动恢复有预算：`RENDERER_RECOVERY_WINDOW_MS` 窗口内最多
//      `MAX_RENDERER_RECOVERY_ATTEMPTS` 次，超出就加载兜底页，绝不无限重启。
//   2. 预算不因「加载成功」立刻清零 —— 只有渲染进程稳定存活超过一个恢复窗口
//      才清零；否则「加载成功→立刻崩溃」的循环会被 did-finish-load 反复清零，
//      变成重启风暴。
//   3. 兜底页是本地静态 HTML（`electron/renderer-crash.html`），不依赖 Next 服务，
//      诊断信息经 `loadFile({ query })` 传入，页面用 textContent 渲染，无注入面。

/** 自动恢复的滑动窗口（毫秒）。窗口内的失败次数才算数。 */
const RENDERER_RECOVERY_WINDOW_MS = 30_000;
/** 一个恢复窗口内允许的自动重启次数；第 3 次失败就回退兜底页。 */
const MAX_RENDERER_RECOVERY_ATTEMPTS = 2;
/** `unresponsive` 后先观察这么久，渲染进程自己缓过来就取消重启。 */
const UNRESPONSIVE_GRACE_MS = 5_000;

/**
 * 兜底页读取的 query 参数。改这里必须同步改 `renderer-crash.html`，
 * `renderer-recovery.test.mjs` 会逐键断言两边对得上。
 */
const CRASH_PAGE_PARAM_KEYS = [
  "appName",
  "reason",
  "exitCode",
  "occurredAt",
  "attempts",
  "retryUrl",
];

/**
 * 滑动窗口内是否还有自动重启预算。纯函数。
 *
 * @param {number[]} attempts 历史恢复时间戳（毫秒）
 * @param {number} now 当前时间戳（毫秒）
 * @returns {boolean}
 */
function canRecoverRenderer(attempts, now) {
  const recentAttempts = attempts.filter(
    (attemptAt) => now - attemptAt < RENDERER_RECOVERY_WINDOW_MS,
  );
  return recentAttempts.length < MAX_RENDERER_RECOVERY_ATTEMPTS;
}

/**
 * 丢掉窗口之外的旧记录，返回窗口内的恢复时间戳。纯函数。
 *
 * @param {number[]} attempts
 * @param {number} now
 * @returns {number[]}
 */
function pruneRecoveryAttempts(attempts, now) {
  return attempts.filter((attemptAt) => now - attemptAt < RENDERER_RECOVERY_WINDOW_MS);
}

/**
 * 把崩溃详情格式化成给人看的多行诊断文本（写日志用）。纯函数。
 *
 * @param {{ reason?: string, exitCode?: number | null, errorDescription?: string }} details
 * @param {{ attempts?: number, occurredAt?: number }} [context]
 * @returns {string}
 */
function formatCrashDiagnostics(details = {}, context = {}) {
  const attempts = Number.isFinite(context.attempts) ? context.attempts : 0;
  const occurredAt = Number.isFinite(context.occurredAt) ? context.occurredAt : Date.now();
  const reason = typeof details.reason === "string" && details.reason ? details.reason : "unknown";
  const exitCode = Number.isFinite(details.exitCode) ? String(details.exitCode) : "unknown";
  const description =
    typeof details.errorDescription === "string" && details.errorDescription
      ? `（${details.errorDescription}）`
      : "";
  return [
    `原因：${reason}${description}`,
    `退出码：${exitCode}`,
    `时间：${new Date(occurredAt).toISOString()}`,
    `重试次数：${attempts}`,
  ].join("\n");
}

/**
 * 生成兜底页的 query 参数对象。纯函数；所有值都是字符串，
 * 供 `BrowserWindow.loadFile(path, { query })` 使用。
 *
 * @param {{ appName?: string, details?: object, attempts?: number, occurredAt?: number, retryUrl?: string }} input
 * @returns {Record<string, string>}
 */
function buildCrashPageQuery(input = {}) {
  const details = input.details || {};
  const attempts = Number.isFinite(input.attempts) ? input.attempts : 0;
  const occurredAt = Number.isFinite(input.occurredAt) ? input.occurredAt : Date.now();
  return {
    appName: String(input.appName ?? ""),
    reason: typeof details.reason === "string" && details.reason ? details.reason : "unknown",
    exitCode: Number.isFinite(details.exitCode) ? String(details.exitCode) : "unknown",
    occurredAt: new Date(occurredAt).toISOString(),
    attempts: String(attempts),
    retryUrl: String(input.retryUrl ?? ""),
  };
}

/**
 * 两个 URL 是否同源（兜底页的「重新加载」按钮会导航回应用入口）。纯函数。
 * 不能用字符串相等：Chromium 会把 `http://127.0.0.1:30142` 规范化成带尾斜杠的形式。
 *
 * @param {string} url
 * @param {string} reference
 * @returns {boolean}
 */
function isSameOrigin(url, reference) {
  try {
    return new URL(url).origin === new URL(reference).origin;
  } catch {
    return false;
  }
}

/**
 * 给一个 BrowserWindow 挂上渲染进程恢复逻辑。
 *
 * @param {import("electron").BrowserWindow} win
 * @param {{
 *   appName?: string,
 *   retryUrl: string,
 *   crashPagePath: string,
 *   isQuitting?: () => boolean,
 *   log?: Pick<Console, "log" | "warn" | "error">,
 *   now?: () => number,
 *   unresponsiveGraceMs?: number,
 *   stabilityWindowMs?: number,
 * }} options
 * @returns {{ reset: () => void, dispose: () => void, getAttempts: () => number[], hasGivenUp: () => boolean }}
 */
function attachRendererRecovery(win, options = {}) {
  const webContents = win && win.webContents;
  if (!webContents || typeof webContents.on !== "function") {
    throw new Error("attachRendererRecovery: window.webContents is required");
  }

  const appName = options.appName ?? "PI NEXT";
  const retryUrl = options.retryUrl;
  const crashPagePath = options.crashPagePath;
  const isQuitting = options.isQuitting ?? (() => false);
  const log = options.log ?? console;
  const now = options.now ?? (() => Date.now());
  const unresponsiveGraceMs = options.unresponsiveGraceMs ?? UNRESPONSIVE_GRACE_MS;
  const stabilityWindowMs = options.stabilityWindowMs ?? RENDERER_RECOVERY_WINDOW_MS;

  /** 窗口内的自动恢复时间戳。 */
  let attempts = [];
  /** 已经放弃自动恢复、正在显示兜底页。 */
  let gaveUp = false;
  let unresponsiveTimer = null;
  let stabilityTimer = null;

  function clearUnresponsiveTimer() {
    if (unresponsiveTimer) {
      clearTimeout(unresponsiveTimer);
      unresponsiveTimer = null;
    }
  }

  function clearStabilityTimer() {
    if (stabilityTimer) {
      clearTimeout(stabilityTimer);
      stabilityTimer = null;
    }
  }

  function reset() {
    attempts = [];
    gaveUp = false;
    clearUnresponsiveTimer();
    clearStabilityTimer();
  }

  function loadCrashPage(details, occurredAt, attemptCount) {
    gaveUp = true;
    clearUnresponsiveTimer();
    clearStabilityTimer();
    log.error(
      `[renderer-recovery] 自动恢复失败，加载兜底页\n${formatCrashDiagnostics(details, {
        attempts: attemptCount,
        occurredAt,
      })}`,
    );
    try {
      const pending = win.loadFile(crashPagePath, {
        query: buildCrashPageQuery({ appName, details, attempts: attemptCount, occurredAt, retryUrl }),
      });
      if (pending && typeof pending.catch === "function") {
        pending.catch((error) => log.error("[renderer-recovery] 兜底页加载失败:", error));
      }
    } catch (error) {
      log.error("[renderer-recovery] 兜底页加载失败:", error);
    }
  }

  function reloadRenderer() {
    if (typeof win.isDestroyed === "function" && win.isDestroyed()) return;
    try {
      webContents.reload();
    } catch (error) {
      // 某些崩溃状态下 reload() 会抛 “Render frame was disposed”，退到 loadURL。
      log.error("[renderer-recovery] reload() 失败，改走 loadURL():", error);
      try {
        const pending = win.loadURL(retryUrl);
        if (pending && typeof pending.catch === "function") {
          pending.catch((loadError) => log.error("[renderer-recovery] loadURL() 恢复失败:", loadError));
        }
      } catch (loadError) {
        log.error("[renderer-recovery] loadURL() 恢复失败:", loadError);
      }
    }
  }

  /** 崩溃/无响应/加载失败共用的恢复入口：有预算就重启，没有就兜底。 */
  function recover(kind, details) {
    if (gaveUp || isQuitting()) return;
    clearUnresponsiveTimer();
    clearStabilityTimer();
    const occurredAt = now();
    attempts = pruneRecoveryAttempts(attempts, occurredAt);
    if (canRecoverRenderer(attempts, occurredAt)) {
      attempts.push(occurredAt);
      log.warn(
        `[renderer-recovery] ${kind}：自动重启渲染进程` +
          `（第 ${attempts.length}/${MAX_RENDERER_RECOVERY_ATTEMPTS} 次，` +
          `窗口 ${RENDERER_RECOVERY_WINDOW_MS}ms）`,
      );
      reloadRenderer();
      return;
    }
    loadCrashPage(details, occurredAt, attempts.length);
  }

  const onRenderProcessGone = (_event, details = {}) => {
    // clean-exit 是正常关闭（含应用退出），不是故障。
    if (isQuitting() || details.reason === "clean-exit") return;
    log.error(
      `[renderer-recovery] render-process-gone\n${formatCrashDiagnostics(details, {
        attempts: attempts.length,
        occurredAt: now(),
      })}`,
    );
    recover("渲染进程崩溃", details);
  };

  const onUnresponsive = () => {
    if (gaveUp || isQuitting() || unresponsiveTimer) return;
    log.warn(
      `[renderer-recovery] 渲染进程无响应，先观察 ${unresponsiveGraceMs}ms 看它能否自行恢复…`,
    );
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null;
      if (isQuitting() || gaveUp) return;
      recover("渲染进程持续无响应", { reason: "unresponsive", exitCode: null });
    }, unresponsiveGraceMs);
    if (unresponsiveTimer && typeof unresponsiveTimer.unref === "function") {
      unresponsiveTimer.unref();
    }
  };

  const onResponsive = () => {
    if (!unresponsiveTimer) return;
    clearUnresponsiveTimer();
    log.log("[renderer-recovery] 渲染进程已恢复响应，取消重启");
  };

  const onDidFailLoad = (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 是被取消的导航（例如恢复时的 reload 打断），不是故障；子框架失败也不管。
    if (!isMainFrame || errorCode === -3 || gaveUp || isQuitting()) return;
    log.error(
      `[renderer-recovery] 主框架加载失败 (${errorCode}): ${errorDescription} ${validatedURL}`,
    );
    // 服务/网络问题重试多半也没用，直接给出诊断页，不消耗渲染进程恢复预算。
    loadCrashPage(
      { reason: "did-fail-load", exitCode: errorCode, errorDescription },
      now(),
      attempts.length,
    );
  };

  const onDidFinishLoad = () => {
    if (gaveUp) return;
    // 活过一个完整恢复窗口才算稳定，之前不重置预算（见文件头不变量 2）。
    clearStabilityTimer();
    stabilityTimer = setTimeout(() => {
      stabilityTimer = null;
      attempts = [];
    }, stabilityWindowMs);
    if (stabilityTimer && typeof stabilityTimer.unref === "function") {
      stabilityTimer.unref();
    }
  };

  const onWillNavigate = (_event, url) => {
    // 兜底页上的「重新加载」是页面发起的导航；用户明确重试，重置预算。
    if (retryUrl && isSameOrigin(url, retryUrl)) reset();
  };

  webContents.on("render-process-gone", onRenderProcessGone);
  webContents.on("unresponsive", onUnresponsive);
  webContents.on("responsive", onResponsive);
  webContents.on("did-fail-load", onDidFailLoad);
  webContents.on("did-finish-load", onDidFinishLoad);
  webContents.on("will-navigate", onWillNavigate);

  return {
    reset,
    dispose() {
      clearUnresponsiveTimer();
      clearStabilityTimer();
      webContents.removeListener("render-process-gone", onRenderProcessGone);
      webContents.removeListener("unresponsive", onUnresponsive);
      webContents.removeListener("responsive", onResponsive);
      webContents.removeListener("did-fail-load", onDidFailLoad);
      webContents.removeListener("did-finish-load", onDidFinishLoad);
      webContents.removeListener("will-navigate", onWillNavigate);
    },
    getAttempts: () => attempts.slice(),
    hasGivenUp: () => gaveUp,
  };
}

module.exports = {
  RENDERER_RECOVERY_WINDOW_MS,
  MAX_RENDERER_RECOVERY_ATTEMPTS,
  UNRESPONSIVE_GRACE_MS,
  CRASH_PAGE_PARAM_KEYS,
  canRecoverRenderer,
  pruneRecoveryAttempts,
  formatCrashDiagnostics,
  buildCrashPageQuery,
  isSameOrigin,
  attachRendererRecovery,
};
