"use strict";

/**
 * fork:desktop-crash-budget —— 本地服务意外退出时的重启预算（纯逻辑，不依赖 Electron）。
 *
 * 为什么单独一个文件：这段判断以前整段内联在 `main.js` 的 `exit` 处理器里，而
 * `main.js` 只有跑在 Electron 里才 load 得起来 —— 于是它**从来没被测过**，也就没人
 * 发现下面这个真 bug。
 *
 * 原来的写法（`restartAttempt` 是 main.js 的模块级变量）：
 *
 *     proc.on("exit", () => { restartAttempt += 1; …; setTimeout(startServer, delay) })
 *     async function startServer() { …; restartAttempt = 0; }   // ← 每次启动都清零
 *
 * 退避延时按 `restartAttempt` 算，而它在**每次重启之后**被清零，所以永远停在
 * 「1 秒后第 1/5 次」，指数退避与「连续 5 次就停手」两条**从来没生效过** —— 实际
 * 行为是无上限的每秒重启（用户看到的是窗口一直转圈，而应用死活不报错）。
 *
 * 现在的口径：**只有「稳定运行够久」才把预算还回去**，而不是「我们调了一次
 * startServer」。稳定窗口之外连崩，退避 1/2/4/8/16 秒；超预算进入终态
 * （调用方弹错误框并退出），不再无限重启。
 */

/** 跑满这么久再崩，算新的一轮，不累计（默认 60s）。 */
const SERVER_STABLE_MS = 60_000;
/** 连续失败几次就停手（含稳定窗口内的所有崩溃）。 */
const SERVER_RESTART_MAX_ATTEMPTS = 5;
/** 退避上限，避免等待过久。 */
const SERVER_RESTART_MAX_DELAY_MS = 16_000;

/**
 * @param {object} [options]
 * @param {number} [options.stableMs] 稳定窗口
 * @param {number} [options.maxAttempts] 次数上限
 * @param {number} [options.maxDelayMs] 退避上限
 */
function createCrashBudget(options = {}) {
  const stableMs = options.stableMs ?? SERVER_STABLE_MS;
  const maxAttempts = options.maxAttempts ?? SERVER_RESTART_MAX_ATTEMPTS;
  const maxDelayMs = options.maxDelayMs ?? SERVER_RESTART_MAX_DELAY_MS;
  let attempts = 0;

  return {
    get attempts() {
      return attempts;
    },

    /**
     * 记录一次非预期退出，返回下一步该怎么做。
     *
     * @param {number} uptimeMs 退出的那个进程活了多久（拿不到就传 0 —— 按「不稳定」算）
     * @returns {{ attempts: number, exhausted: boolean, delayMs: number }}
     */
    recordExit(uptimeMs) {
      // 活够了一整个稳定窗口才清零：短命进程连着崩时预算必须继续扣。
      if (Number.isFinite(uptimeMs) && uptimeMs >= stableMs) attempts = 0;
      attempts += 1;
      return {
        attempts,
        exhausted: attempts > maxAttempts,
        delayMs: Math.min(1000 * 2 ** (attempts - 1), maxDelayMs),
      };
    },

    /** 外部原因（换网卡、用户手动重启）不算崩溃，把预算还回去。 */
    reset() {
      attempts = 0;
    },
  };
}

module.exports = {
  createCrashBudget,
  SERVER_STABLE_MS,
  SERVER_RESTART_MAX_ATTEMPTS,
  SERVER_RESTART_MAX_DELAY_MS,
};
