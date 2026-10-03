import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  BrowserScreenshotTooLargeError,
  MAX_BACKGROUND_BROWSER_SESSIONS,
  MAX_BROWSER_SCRIPT_RESULT_CHARS,
  MAX_BROWSER_TABS,
  MAX_SCREENSHOT_BYTES,
  assertScreenshotWithinLimit,
  base64ByteLength,
  clampBrowserScriptResult,
  clampObserveElements,
  isReclaimableBackgroundSession,
  planBackgroundSessionEviction,
  planTabReclaim,
  resolveObserveAxDepth,
} = await jiti.import("./browser-capacity.ts");

const tab = (tabId, overrides = {}) => ({
  tabId,
  openedByAgent: true,
  isActiveTab: false,
  isAgentTab: false,
  lastActivityAt: 0,
  ...overrides,
});

const session = (sessionId, overrides = {}) => ({
  sessionId,
  lastActivityAt: 0,
  hasPresentation: false,
  activeOperationCount: 0,
  preserveOnHide: false,
  hasVisibleTab: false,
  ...overrides,
});

test("上限就是计划里那两个数字", () => {
  assert.equal(MAX_BROWSER_TABS, 20);
  assert.equal(MAX_BACKGROUND_BROWSER_SESSIONS, 8);
  assert.equal(MAX_SCREENSHOT_BYTES, 3 * 1024 * 1024);
  assert.equal(MAX_BROWSER_SCRIPT_RESULT_CHARS, 64_000);
});

test("标签不超限时不动任何标签", () => {
  const tabs = Array.from({ length: MAX_BROWSER_TABS }, (_unused, index) => tab(`t${index}`));
  assert.deepEqual(planTabReclaim(tabs), []);
});

test("超限时回收最久未使用的 Agent 标签", () => {
  const tabs = Array.from({ length: 22 }, (_unused, index) => tab(`t${index}`, { lastActivityAt: index }));
  assert.deepEqual(planTabReclaim(tabs), ["t0", "t1"]);
});

test("用户开的、前台正在看的、Agent 正在操作的一律不回收", () => {
  const tabs = [
    tab("user-tab", { openedByAgent: false, lastActivityAt: 0 }),
    tab("active", { isActiveTab: true, lastActivityAt: 0 }),
    tab("working", { isAgentTab: true, lastActivityAt: 0 }),
    ...Array.from({ length: 20 }, (_unused, index) => tab(`agent-${index}`, { lastActivityAt: 100 + index })),
  ];
  // 23 个标签、超 3 个：只有那三个 Agent 标签可回收，而且只回收最久未用的 3 个。
  assert.deepEqual(planTabReclaim(tabs), ["agent-0", "agent-1", "agent-2"]);
});

test("没有安全候选时宁可超额，也不关用户内容", () => {
  const tabs = [
    tab("user-1", { openedByAgent: false }),
    tab("user-2", { openedByAgent: false }),
    tab("active", { openedByAgent: false, isActiveTab: true }),
    tab("working", { openedByAgent: false, isAgentTab: true }),
  ];
  assert.deepEqual(planTabReclaim(tabs, 2), []);
});

test("后台会话 LRU：前台 / 在途 / 保留 / 有可见标签的都不回收", () => {
  const foreground = session("foreground", { hasPresentation: true, lastActivityAt: 0 });
  const busy = session("busy", { activeOperationCount: 1, lastActivityAt: 0 });
  const preserved = session("preserved", { preserveOnHide: true, lastActivityAt: 0 });
  const visible = session("visible", { hasVisibleTab: true, lastActivityAt: 0 });
  for (const candidate of [foreground, busy, preserved, visible]) {
    assert.equal(isReclaimableBackgroundSession(candidate), false, candidate.sessionId);
  }
  assert.equal(isReclaimableBackgroundSession(session("idle")), true);
});

test("后台会话超过 8 个时按最久未使用回收", () => {
  const sessions = [
    ...["keep-foreground", "keep-busy", "keep-visible"].map((id) => session(id, {
      hasPresentation: id === "keep-foreground",
      activeOperationCount: id === "keep-busy" ? 2 : 0,
      hasVisibleTab: id === "keep-visible",
      lastActivityAt: 0,
    })),
    ...Array.from({ length: 9 }, (_unused, index) => session(`bg-${index}`, { lastActivityAt: 100 + index })),
  ];
  // 12 个会话、可回收 9 个、超 1 个 → 只关最久未用的那个。
  assert.deepEqual(planBackgroundSessionEviction(sessions), ["bg-0"]);
});

test("后台会话不超过 8 个时不动", () => {
  const sessions = Array.from({ length: MAX_BACKGROUND_BROWSER_SESSIONS }, (_unused, index) => session(`s${index}`, { lastActivityAt: index }));
  assert.deepEqual(planBackgroundSessionEviction(sessions), []);
});

test("没有可回收的后台会话时同样宁可不关", () => {
  const sessions = Array.from({ length: 12 }, (_unused, index) => session(`s${index}`, {
    hasPresentation: index < 4,
    lastActivityAt: index,
  }));
  assert.deepEqual(planBackgroundSessionEviction(sessions), []);
});

test("脚本结果超限只回预览，并带上原始长度", () => {
  const small = { a: 1 };
  const clampedSmall = clampBrowserScriptResult(small);
  assert.equal(clampedSmall.truncated, false);
  assert.deepEqual(clampedSmall.value, small);

  const big = { text: "x".repeat(MAX_BROWSER_SCRIPT_RESULT_CHARS + 10_000) };
  const clamped = clampBrowserScriptResult(big);
  assert.equal(clamped.truncated, true);
  assert.equal(clamped.value.truncated, true);
  assert.equal(clamped.value.preview.length, MAX_BROWSER_SCRIPT_RESULT_CHARS);
  assert.equal(clamped.value.totalChars > MAX_BROWSER_SCRIPT_RESULT_CHARS, true);
});

test("不可序列化的返回值退化成截断字符串而不是抛", () => {
  const circular = {};
  circular.self = circular;
  const clamped = clampBrowserScriptResult(circular);
  assert.equal(clamped.truncated, false);
  assert.equal(typeof clamped.value, "string");
  assert.deepEqual(clampBrowserScriptResult(undefined), { value: null, truncated: false, totalChars: 0 });
});

test("截图按**字节**算体积，不是按 base64 字符数", () => {
  // 4 个 base64 字符 = 3 字节。
  assert.equal(base64ByteLength("AAAA"), 3);
  assert.equal(base64ByteLength("AAA="), 2);
  assert.equal(base64ByteLength("AA=="), 1);
  const oversized = "A".repeat(Math.ceil((MAX_SCREENSHOT_BYTES + 1) / 3) * 4);
  assert.throws(() => assertScreenshotWithinLimit(oversized), BrowserScreenshotTooLargeError);
  const payload = assertScreenshotWithinLimit("AAAA");
  assert.equal(payload.bytes, 3);
  assert.equal(payload.mimeType, "image/png");
});

test("observe 预算被夹在 20–400，越界值不静默接受", () => {
  assert.equal(clampObserveElements(undefined), 240);
  assert.equal(clampObserveElements(1), 20);
  assert.equal(clampObserveElements(9999), 400);
  assert.equal(clampObserveElements(120.7), 120);
  assert.throws(() => clampObserveElements(Number.NaN));
  // 只有明确要更多元素时才读更深的 AX 树。
  assert.equal(resolveObserveAxDepth(240), 8);
  assert.equal(resolveObserveAxDepth(400), 16);
});