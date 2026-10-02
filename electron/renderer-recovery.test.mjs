import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  RENDERER_RECOVERY_WINDOW_MS,
  MAX_RENDERER_RECOVERY_ATTEMPTS,
  CRASH_PAGE_PARAM_KEYS,
  canRecoverRenderer,
  pruneRecoveryAttempts,
  formatCrashDiagnostics,
  buildCrashPageQuery,
  isSameOrigin,
  attachRendererRecovery,
} = require("./renderer-recovery.js");

const here = dirname(fileURLToPath(import.meta.url));
const RETRY_URL = "http://127.0.0.1:30142";
const CRASH_PAGE = "/tmp/renderer-crash.html";

/** 假窗口 + 假 webContents，用来同步驱动恢复逻辑。 */
function harness(options = {}) {
  const webContents = new EventEmitter();
  const state = { reloads: 0, loadedFiles: [], loadUrls: [] };
  let clock = 1_000_000;
  webContents.reload = () => {
    state.reloads += 1;
    if (options.reloadThrows) throw new Error("Render frame was disposed");
  };
  const win = {
    webContents,
    isDestroyed: () => false,
    loadURL: (url) => {
      state.loadUrls.push(url);
      return Promise.resolve();
    },
    loadFile: (file, opts) => {
      state.loadedFiles.push({ file, query: opts && opts.query });
      return Promise.resolve();
    },
  };
  const recovery = attachRendererRecovery(win, {
    appName: "PI NEXT",
    retryUrl: RETRY_URL,
    crashPagePath: CRASH_PAGE,
    log: { log() {}, warn() {}, error() {} },
    now: () => clock,
    ...options,
  });
  return {
    webContents,
    state,
    recovery,
    advance: (ms) => {
      clock += ms;
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("recovery budget allows two attempts inside the window", () => {
  const now = 30_000;
  assert.equal(RENDERER_RECOVERY_WINDOW_MS, 30_000);
  assert.equal(MAX_RENDERER_RECOVERY_ATTEMPTS, 2);
  assert.equal(canRecoverRenderer([], now), true);
  assert.equal(canRecoverRenderer([now - 1], now), true);
  assert.equal(canRecoverRenderer([now - 1, now - 2], now), false);
  // 刚好落在窗口边界上（now - at === 窗口）不算窗口内。
  assert.equal(canRecoverRenderer([now - RENDERER_RECOVERY_WINDOW_MS], now), true);
});

test("pruneRecoveryAttempts drops entries older than the window", () => {
  assert.deepEqual(pruneRecoveryAttempts([0, 100], RENDERER_RECOVERY_WINDOW_MS), [100]);
  assert.deepEqual(pruneRecoveryAttempts([], 123), []);
});

test("formatCrashDiagnostics reports reason, exit code, time and attempts", () => {
  const text = formatCrashDiagnostics(
    { reason: "crashed", exitCode: 133 },
    { attempts: 2, occurredAt: Date.parse("2026-10-02T03:04:05.000Z") },
  );
  assert.match(text, /原因：crashed/);
  assert.match(text, /退出码：133/);
  assert.match(text, /时间：2026-10-02T03:04:05\.000Z/);
  assert.match(text, /重试次数：2/);
});

test("formatCrashDiagnostics tolerates missing fields", () => {
  const text = formatCrashDiagnostics({}, { attempts: 0, occurredAt: 0 });
  assert.match(text, /原因：unknown/);
  assert.match(text, /退出码：unknown/);
  assert.match(text, /时间：1970-01-01T00:00:00\.000Z/);
});

test("formatCrashDiagnostics includes a load error description when present", () => {
  const text = formatCrashDiagnostics({ reason: "did-fail-load", exitCode: -102, errorDescription: "ERR_CONNECTION_REFUSED" });
  assert.match(text, /原因：did-fail-load（ERR_CONNECTION_REFUSED）/);
  assert.match(text, /退出码：-102/);
});

test("buildCrashPageQuery maps every diagnostic field to a string", () => {
  const query = buildCrashPageQuery({
    appName: "PI NEXT",
    details: { reason: "oom", exitCode: 137 },
    attempts: 2,
    occurredAt: 0,
    retryUrl: RETRY_URL,
  });
  assert.deepEqual(query, {
    appName: "PI NEXT",
    reason: "oom",
    exitCode: "137",
    occurredAt: "1970-01-01T00:00:00.000Z",
    attempts: "2",
    retryUrl: RETRY_URL,
  });
  assert.deepEqual(Object.keys(query), CRASH_PAGE_PARAM_KEYS);
});

test("crash page is self-contained and reads every diagnostic param", () => {
  const html = readFileSync(join(here, "renderer-crash.html"), "utf8");
  for (const key of CRASH_PAGE_PARAM_KEYS) {
    assert.ok(html.includes(`params.get("${key}")`), `crash page does not read param ${key}`);
  }
  assert.match(html, /id="reload"/);
  assert.ok(!/\bsrc\s*=\s*["']https?:/i.test(html), "crash page must not load remote resources");
  assert.ok(!/\bhref\s*=\s*["']https?:/i.test(html), "crash page must not link remote resources");
});

test("first renderer crash reloads the renderer", () => {
  const h = harness();
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 133 });
  assert.equal(h.state.reloads, 1);
  assert.equal(h.state.loadedFiles.length, 0);
  assert.deepEqual(h.recovery.getAttempts().length, 1);
  h.recovery.dispose();
});

test("clean-exit never triggers recovery", () => {
  const h = harness();
  h.webContents.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 });
  assert.equal(h.state.reloads, 0);
  assert.equal(h.state.loadedFiles.length, 0);
  h.recovery.dispose();
});

test("quitting suppresses recovery", () => {
  const h = harness({ isQuitting: () => true });
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  assert.equal(h.state.reloads, 0);
  assert.equal(h.state.loadedFiles.length, 0);
  h.recovery.dispose();
});

test("a crash loop falls back to the crash page after two attempts", () => {
  const h = harness();
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  assert.equal(h.state.reloads, 2);
  assert.equal(h.recovery.hasGivenUp(), false);

  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  assert.equal(h.state.reloads, 2, "must not reload past the budget");
  assert.equal(h.state.loadedFiles.length, 1);
  assert.equal(h.state.loadedFiles[0].file, CRASH_PAGE);
  assert.equal(h.state.loadedFiles[0].query.attempts, "2");
  assert.equal(h.state.loadedFiles[0].query.reason, "crashed");
  assert.equal(h.state.loadedFiles[0].query.retryUrl, RETRY_URL);
  assert.equal(h.recovery.hasGivenUp(), true);

  // 兜底页已经显示，再崩也不重启。
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  assert.equal(h.state.reloads, 2);
  assert.equal(h.state.loadedFiles.length, 1);
  h.recovery.dispose();
});

test("crashes older than the recovery window free up budget", () => {
  const h = harness();
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  assert.equal(h.state.reloads, 2);

  h.advance(RENDERER_RECOVERY_WINDOW_MS + 1);
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  assert.equal(h.state.reloads, 3, "stale attempts should not exhaust the budget");
  assert.equal(h.state.loadedFiles.length, 0);
  h.recovery.dispose();
});

test("did-finish-load does not clear the budget immediately", () => {
  const h = harness({ stabilityWindowMs: 10_000 });
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  h.webContents.emit("did-finish-load");
  assert.equal(h.recovery.getAttempts().length, 1);
  h.recovery.dispose();
});

test("budget resets after the renderer stays up for the stability window", async () => {
  const h = harness({ stabilityWindowMs: 5 });
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  h.webContents.emit("did-finish-load");
  assert.equal(h.recovery.getAttempts().length, 1);
  await sleep(30);
  assert.deepEqual(h.recovery.getAttempts(), []);
  h.recovery.dispose();
});

test("unresponsive triggers recovery only after the grace period", async () => {
  const h = harness({ unresponsiveGraceMs: 5 });
  h.webContents.emit("unresponsive");
  assert.equal(h.state.reloads, 0, "must wait for the grace period first");
  await sleep(30);
  assert.equal(h.state.reloads, 1);
  h.recovery.dispose();
});

test("a responsive renderer cancels the pending unresponsive recovery", async () => {
  const h = harness({ unresponsiveGraceMs: 20 });
  h.webContents.emit("unresponsive");
  h.webContents.emit("responsive");
  await sleep(40);
  assert.equal(h.state.reloads, 0);
  h.recovery.dispose();
});

test("main frame load failures fall back to the crash page without reloading", () => {
  const h = harness();
  h.webContents.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", RETRY_URL, true);
  assert.equal(h.state.reloads, 0);
  assert.equal(h.state.loadedFiles.length, 1);
  assert.equal(h.state.loadedFiles[0].query.reason, "did-fail-load");
  assert.equal(h.state.loadedFiles[0].query.exitCode, "-102");
  h.recovery.dispose();
});

test("aborted loads and subframe failures are ignored", () => {
  const h = harness();
  h.webContents.emit("did-fail-load", {}, -3, "ERR_ABORTED", RETRY_URL, true);
  h.webContents.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", "http://x", false);
  assert.equal(h.state.loadedFiles.length, 0);
  h.recovery.dispose();
});

test("isSameOrigin tolerates Chromium URL normalisation", () => {
  assert.equal(isSameOrigin(RETRY_URL, RETRY_URL), true);
  assert.equal(isSameOrigin(`${RETRY_URL}/`, RETRY_URL), true);
  assert.equal(isSameOrigin(`${RETRY_URL}/some/route`, RETRY_URL), true);
  assert.equal(isSameOrigin("http://127.0.0.1:9999/", RETRY_URL), false);
  assert.equal(isSameOrigin("not a url", RETRY_URL), false);
});

test("navigating back to the app from the crash page resets the budget", () => {
  const h = harness();
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  assert.equal(h.recovery.hasGivenUp(), true);

  // Chromium 会规范化 URL（加尾斜杠），重置判定必须按 origin。
  h.webContents.emit("will-navigate", {}, `${RETRY_URL}/`);
  assert.equal(h.recovery.hasGivenUp(), false);
  assert.deepEqual(h.recovery.getAttempts(), []);

  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  assert.equal(h.state.reloads, 3);
  h.recovery.dispose();
});

test("falls back to loadURL when reload() throws after a crash", () => {
  const h = harness({ reloadThrows: true });
  h.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  assert.equal(h.state.reloads, 1);
  assert.deepEqual(h.state.loadUrls, [RETRY_URL]);
  h.recovery.dispose();
});

test("dispose removes every listener", () => {
  const h = harness();
  h.recovery.dispose();
  for (const event of ["render-process-gone", "unresponsive", "responsive", "did-fail-load", "did-finish-load", "will-navigate"]) {
    assert.equal(h.webContents.listenerCount(event), 0, `listener for ${event} was not removed`);
  }
});
