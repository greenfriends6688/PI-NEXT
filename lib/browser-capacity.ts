/**
 * fork:proma-42-browser · 受管浏览器的容量上限与**回收规划**（纯逻辑）。
 *
 * 宿主（`electron/browser-host.js`）只负责执行；「回收谁」这个决定放在这里，
 * 因为它是一条会误伤用户内容的策略，必须能单测。
 *
 * 两条硬上限（与参考实现一致）：
 *   · `MAX_BROWSER_TABS = 20` —— 每个浏览器会话的标签数；
 *   · `MAX_BACKGROUND_BROWSER_SESSIONS = 8` —— 后台会话数（前台 / 正在操作的永不回收）。
 *
 * 两条 fail-closed 规则：
 *   · 标签超限时**只回收 Agent 自己开的、且不是前台显示标签、也不是 Agent 当前工作标签**的那些；
 *   · 没有安全候选时宁可暂时超过上限，也不擅自关掉用户自己打开的页面。
 */

/** 每个浏览器会话的标签上限。 */
export const MAX_BROWSER_TABS = 20;
/** 后台（未在前台展示、无进行中 Agent 操作）会话的上限。 */
export const MAX_BACKGROUND_BROWSER_SESSIONS = 8;
/** 截图字节上限（base64 解码后）。 */
export const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
/** 页面脚本 / 工具结果的字符上限。 */
export const MAX_BROWSER_SCRIPT_RESULT_CHARS = 64_000;
/** `browser_extract` 单次返回的字符上限（比脚本结果上限小一个档，因为它会进上下文）。 */
export const MAX_BROWSER_EXTRACT_CHARS = 50_000;
/** 单次 `browser_type` 的文本长度上限。 */
export const MAX_BROWSER_TEXT_INPUT_CHARS = 10_000;
/** CSS selector 长度上限。 */
export const MAX_BROWSER_SELECTOR_CHARS = 1_000;
/** 单次滚动的像素绝对值上限。 */
export const MAX_BROWSER_SCROLL_DELTA = 50_000;
/** `browser_observe` 一次返回的元素条数区间。 */
export const MIN_BROWSER_OBSERVE_ELEMENTS = 20;
export const MAX_BROWSER_OBSERVE_ELEMENTS = 400;
export const DEFAULT_BROWSER_OBSERVE_ELEMENTS = 240;
/** CDP 单条命令超时（毫秒）。 */
export const BROWSER_CDP_COMMAND_TIMEOUT_MS = 8_000;
/** `browser_observe` 的 AX 树读取超时（毫秒）。 */
export const BROWSER_OBSERVE_TIMEOUT_MS = 5_000;

export interface TabReclaimCandidate {
  tabId: string;
  /** 这个标签是不是 Agent 开的（用户手开的永不被自动回收）。 */
  openedByAgent: boolean;
  /** 当前用户在前台看的标签。 */
  isActiveTab: boolean;
  /** Agent 正在操作的工作标签。 */
  isAgentTab: boolean;
  lastActivityAt: number;
}

/**
 * 返回应当关闭的 tabId（最久未使用的在前）。宁可少关：候选不足时返回的数组比
 * 「需要关的数量」短，调用方必须照实执行、不许自己补位。
 */
export function planTabReclaim(
  tabs: readonly TabReclaimCandidate[],
  maxTabs: number = MAX_BROWSER_TABS,
): string[] {
  const excess = tabs.length - maxTabs;
  if (excess <= 0) return [];
  const candidates = tabs
    .filter((tab) => tab.openedByAgent && !tab.isActiveTab && !tab.isAgentTab)
    .sort((left, right) => left.lastActivityAt - right.lastActivityAt || left.tabId.localeCompare(right.tabId));
  return candidates.slice(0, Math.max(0, excess)).map((tab) => tab.tabId);
}

export interface BackgroundSessionCandidate {
  sessionId: string;
  lastActivityAt: number;
  /** 当前是否有前台 Pane 正在展示它。 */
  hasPresentation: boolean;
  /** 进行中的 Agent 浏览器操作数；非零时永不回收。 */
  activeOperationCount: number;
  /** UI 明确要求隐藏时保留（应用浮层遮挡等）。 */
  preserveOnHide: boolean;
  /** 是否还有任意可见标签。 */
  hasVisibleTab: boolean;
}

/** 后台会话的 LRU 键：取会话内最近一次活动（会话自己记不住时由调用方填 0）。 */
export function isReclaimableBackgroundSession(session: BackgroundSessionCandidate): boolean {
  if (session.hasPresentation) return false;
  if (session.preserveOnHide) return false;
  if (session.activeOperationCount > 0) return false;
  if (session.hasVisibleTab) return false;
  return true;
}

/** 返回应当关闭的 sessionId（最久未使用的在前）。 */
export function planBackgroundSessionEviction(
  sessions: readonly BackgroundSessionCandidate[],
  maxSessions: number = MAX_BACKGROUND_BROWSER_SESSIONS,
): string[] {
  const candidates = sessions
    .filter(isReclaimableBackgroundSession)
    .sort((left, right) => left.lastActivityAt - right.lastActivityAt || left.sessionId.localeCompare(right.sessionId));
  const excess = candidates.length - maxSessions;
  if (excess <= 0) return [];
  return candidates.slice(0, Math.max(0, excess)).map((session) => session.sessionId);
}

export interface ClampedScriptResult {
  value: unknown;
  truncated: boolean;
  totalChars: number;
}

/**
 * 页面脚本结果裁剪：超限时**只回预览**，不回一个「看起来完整」的长字符串。
 * 序列化一次就够，裁剪后的串不再进 JSON。
 */
export function clampBrowserScriptResult(
  value: unknown,
  maxChars: number = MAX_BROWSER_SCRIPT_RESULT_CHARS,
): ClampedScriptResult {
  if (value === undefined) return { value: null, truncated: false, totalChars: 0 };
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = undefined;
  }
  if (serialized === undefined) {
    const text = String(value);
    return text.length > maxChars
      ? { value: text.slice(0, maxChars), truncated: true, totalChars: text.length }
      : { value: text, truncated: false, totalChars: text.length };
  }
  if (serialized.length <= maxChars) {
    return { value, truncated: false, totalChars: serialized.length };
  }
  return {
    value: { truncated: true, preview: serialized.slice(0, maxChars), totalChars: serialized.length },
    truncated: true,
    totalChars: serialized.length,
  };
}

export interface ScreenshotPayload {
  mimeType: string;
  /** 不含 data: 前缀的 base64。 */
  data: string;
  bytes: number;
}

/** base64 字符串长度 → 解码后的字节数（截图体积按字节算，不是按字符算）。 */
export function base64ByteLength(base64: string): number {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  if (!clean) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export class BrowserScreenshotTooLargeError extends Error {
  constructor(bytes: number, maxBytes: number) {
    super(`截图过大（${bytes} 字节，上限 ${maxBytes}）。请改用 browser_observe 读取页面结构。`);
    this.name = "BrowserScreenshotTooLargeError";
  }
}

export function assertScreenshotWithinLimit(
  base64: string,
  maxBytes: number = MAX_SCREENSHOT_BYTES,
): ScreenshotPayload {
  const bytes = base64ByteLength(base64);
  if (bytes > maxBytes) throw new BrowserScreenshotTooLargeError(bytes, maxBytes);
  return { mimeType: "image/png", data: base64, bytes };
}

export function clampObserveElements(requested?: number): number {
  if (requested === undefined) return DEFAULT_BROWSER_OBSERVE_ELEMENTS;
  if (!Number.isFinite(requested)) throw new Error("maxElements 必须是有限数字。");
  return Math.max(
    MIN_BROWSER_OBSERVE_ELEMENTS,
    Math.min(MAX_BROWSER_OBSERVE_ELEMENTS, Math.floor(requested)),
  );
}

/** 浅层 AX 树足以覆盖常规页面；只有明确要更多元素时才读更深的树。 */
export function resolveObserveAxDepth(maxElements: number): number {
  return maxElements > 240 ? 16 : 8;
}