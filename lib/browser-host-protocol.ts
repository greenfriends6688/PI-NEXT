/**
 * fork:proma-42-browser · 桌面宿主协议（纯逻辑：名字 + 请求/响应形状）。
 *
 * Next 服务与 Electron 主进程之间只有这一组 op。多加一个 op 就多一处
 * 「谁能对用户的浏览器做什么」的决定，所以清单写在**两边**并在
 * `electron/browser-host-server.test.mjs` 里断言一致。
 *
 * 协议本身刻意极简：一行 JSON 请求、一行 JSON 响应，令牌只在握手里出现一次。
 */

export const BROWSER_HOST_PROTOCOL_VERSION = 1;

/**
 * agent 能触达的 10 个原子工具各自对应一个 op；另加三个只读/管理 op。
 * **没有** `executeScript`：任意 JS 不在协议面内（见 `lib/browser-page-scripts.ts`）。
 */
export const BROWSER_HOST_OPS = [
  "state",
  "navigate",
  "observe",
  "click",
  "type",
  "scroll",
  "extract",
  "screenshot",
  "newTab",
  "switchTab",
  "closeTab",
  "closeSession",
] as const;

export type BrowserHostOp = (typeof BROWSER_HOST_OPS)[number];

export interface BrowserHostRequest {
  v: number;
  /** 握手令牌。 */
  token: string;
  op: BrowserHostOp;
  /** 浏览器会话（= 聊天会话）id。 */
  sessionId: string;
  tabId?: string;
  payload?: Record<string, unknown>;
  /** 宿主把它映射成 AbortSignal 交给 CDP；停止 agent 时用它掐断等待。 */
  deadlineMs?: number;
}

export interface BrowserHostResponse {
  ok: boolean;
  /** 失败时是可直接展示给用户的中文原因；成功时是 op 的结果。 */
  error?: string;
  /** 失败原因分类，宿主侧稳定不变，工具据此挑话术。 */
  code?: BrowserHostErrorCode;
  result?: unknown;
}

export const BROWSER_HOST_ERROR_CODES = [
  "unknown-op",
  "unauthorized",
  "no-session",
  "no-tab",
  "stale-ref",
  "not-editable",
  "not-visible",
  "navigate-failed",
  "cdp-timeout",
  "tab-missing",
] as const;

export type BrowserHostErrorCode = (typeof BROWSER_HOST_ERROR_CODES)[number];

export function isBrowserHostOp(value: unknown): value is BrowserHostOp {
  return typeof value === "string" && (BROWSER_HOST_OPS as readonly string[]).includes(value);
}

/**
 * 握手 / 响应都是严格 JSON：任何含控制字符或超长的行直接拒。
 * 上行（宿主 → 服务）只有一行响应，绝不流式 —— 截图这类大块走单个 JSON 字段。
 */
export const MAX_BROWSER_HOST_MESSAGE_CHARS = 8 * 1024 * 1024;

export function parseBrowserHostLine(line: string): BrowserHostResponse | null {
  if (!line || line.length > MAX_BROWSER_HOST_MESSAGE_CHARS) return null;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(line)) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.ok !== "boolean") return null;
    return {
      ok: record.ok,
      ...(typeof record.error === "string" ? { error: record.error } : {}),
      ...(typeof record.code === "string" ? { code: record.code as BrowserHostErrorCode } : {}),
      ...(record.result === undefined ? {} : { result: record.result }),
    };
  } catch {
    return null;
  }
}

/** 宿主上报的会话摘要，服务端据此做 LRU 回收决策。 */
export interface BrowserHostSessionSummary {
  sessionId: string;
  /** 会话内最近一次活动（epoch ms）。 */
  lastActivityAt: number;
  /** 有没有前台 Pane 在展示它。 */
  hasPresentation: boolean;
  /** 进行中的 Agent 操作数。 */
  activeOperationCount: number;
  /** UI 要求隐藏时保留。 */
  preserveOnHide: boolean;
  /** 会话里是否还有任意可见标签；有就绝不当作后台会话回收。 */
  hasVisibleTab: boolean;
  tabCount: number;
  /** 用户在前台看的 tabId。 */
  activeTabId: string | null;
  /** agent 当前工作 tabId。 */
  agentTabId: string | null;
  tabs: Array<{ tabId: string; openedByAgent: boolean; lastActivityAt: number }>;
}

export interface BrowserHostState {
  sessions: BrowserHostSessionSummary[];
  /** 宿主看到的所有 agent 会话数（含前台的）。 */
  totalSessions: number;
}