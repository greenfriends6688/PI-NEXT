// fork:proma-35-retry —— 重试可感知 + 降噪的纯函数层。
/**
 * pi 自带重试（默认 3 次 / 2000ms），但有两个体验问题：
 *
 * 1. **UI 不降噪**：前几次网络抖动每次都插一条提示，反而比静默更打断用户。
 *    参考实现 Proma 的 `PI_RETRY_VISIBILITY_THRESHOLD = 5`：前 5 次完全不上报 UI，
 *    只有 `attempt > 5` 才发事件（`apps/electron/src/main/lib/adapters/pi-retry-control.ts`）。
 * 2. **重试状态不可见**：用户看到的是「卡住了」，不知道正在第几次重试。
 *
 * 这个模块只做**纯映射**，不碰 React / SSE / 文件。事件源是 pi `AgentSession` 的
 * `auto_retry_start` / `auto_retry_end`（`dist/core/agent-session.d.ts:79-89`）。
 *
 * ## 为什么不改「可重试错误模式」
 *
 * Proma 用 Bun 的 `patchedDependencies` 改 SDK 内部的错误正则数组；本仓用 npm，
 * 没有这个机制。查过 pi 1.0 的 SDK：`RetrySettings` 只有
 * `enabled / maxRetries / baseDelayMs / maxAgentDelayMs / provider`，**没有任何
 * `retryableErrors` 之类的模式配置**（`dist/core/settings-manager.d.ts:19-30`）；
 * 可重试判定 `isRetryableAssistantError()` 读的是 `@earendil-works/pi-ai/dist/utils/retry.js`
 * 里两个**模块私有**的常量数组，`AgentSession._isRetryableError()` 直接调用它，
 * 没有任何注入点。所以 PR-35 只做 UI 降噪，错误模式那条拆出去（见 PR 报告）。
 *
 * ## 阶段语义
 *
 * | 事件 | phase |
 * | --- | --- |
 * | `auto_retry_start`（backoff 睡眠前） | `scheduled` |
 * | `auto_retry_attempt_start`（睡眠后、重发前；当前 SDK 只给 summarization 发） | `running` |
 * | `auto_retry_end { success: true }` | `succeeded` |
 * | `auto_retry_end { success: false }` | `exhausted` |
 * | `auto_retry_end { success: false, finalError: "Retry cancelled" }` | `cancelled` |
 *
 * `summarization_retry_*`（压缩 / 分支摘要的重试）刻意**不映射**：它属于压缩流程，
 * 混进「继续当前回答」的消息流只会让用户误以为模型回答在重试。
 */

/** 前 N 次自动重试完全不上报 UI（与 Proma 同值）。 */
export const PI_RETRY_VISIBILITY_THRESHOLD = 5;

/** `auto_retry_end` 在用户中止时用的 finalError 文案（SDK `agent-session.js:_finishCancelledRetry`）。 */
export const RETRY_CANCELLED_FINAL_ERROR = "Retry cancelled";

export type RetryPhase = "scheduled" | "running" | "succeeded" | "exhausted" | "cancelled";

/** 本轮 prompt 的身份：单调 run id + 开始时间，用来拒绝迟到旧事件。 */
export interface RetryRunContext {
  runId: number;
  runStartedAt: number;
}

/** pi SSE 原始重试事件的结构子集（`AgentEvent` 是 `{ type, [key]: unknown }`）。 */
export interface RawRetryEvent {
  type: string;
  attempt?: unknown;
  maxAttempts?: unknown;
  delayMs?: unknown;
  errorMessage?: unknown;
  success?: unknown;
  finalError?: unknown;
}

/** 映射后、可渲染的一条重试提示。 */
export interface RetryNotice {
  /** 绑定到 `useAgentSession` 的单调 run id；旧 run 的事件不得污染新流。 */
  runId: number;
  runStartedAt: number;
  attempt: number;
  /** 上限。终态事件不带 `maxAttempts`，由 upsert 保留 scheduled 时的值。 */
  maxRetries: number;
  phase: RetryPhase;
  errorMessage?: string;
  delayMs?: number;
  scheduledAt: number;
}

const DEFAULT_CONTEXT: RetryRunContext = { runId: 0, runStartedAt: 0 };

/** 前 5 次不上报：`attempt > 5`。 */
export function shouldSurfaceRetry(attempt: number): boolean {
  return attempt > PI_RETRY_VISIBILITY_THRESHOLD;
}

function phaseFor(raw: RawRetryEvent): RetryPhase | null {
  switch (raw.type) {
    case "auto_retry_start":
      return "scheduled";
    case "auto_retry_attempt_start":
      return "running";
    case "auto_retry_end":
      if (raw.success === true) return "succeeded";
      return raw.finalError === RETRY_CANCELLED_FINAL_ERROR ? "cancelled" : "exhausted";
    default:
      return null;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * 把一条 pi 原始重试事件映射成提示；不需要展示的一律返回 `null`：
 * 未知事件、非法 attempt、以及 `attempt <= PI_RETRY_VISIBILITY_THRESHOLD`。
 *
 * `context` 把提示钉到本轮 run 上；不传时用 `{ runId: 0, runStartedAt: 0 }`。
 * `now` 只为测试可注入。
 */
export function mapRetryEvent(
  raw: RawRetryEvent,
  context: RetryRunContext = DEFAULT_CONTEXT,
  now = Date.now(),
): RetryNotice | null {
  const phase = phaseFor(raw);
  if (!phase) return null;

  const attempt = readPositiveInt(raw.attempt);
  if (attempt === undefined || !shouldSurfaceRetry(attempt)) return null;

  return {
    runId: context.runId,
    runStartedAt: context.runStartedAt,
    attempt,
    // 终态事件没有 maxAttempts；先记 0，由 upsertRetryNotice 从同 attempt 的旧项继承。
    maxRetries: readPositiveInt(raw.maxAttempts) ?? 0,
    phase,
    errorMessage: readString(raw.errorMessage) ?? readString(raw.finalError),
    delayMs: typeof raw.delayMs === "number" && raw.delayMs >= 0 ? raw.delayMs : undefined,
    scheduledAt: now,
  };
}

/**
 * 按 **retry number（attempt）** upsert，而不是无脑 append。
 *
 * 这是 Proma 踩过的坑：`auto_retry_start` 与随后的 `auto_retry_end` 带的是**同一个**
 * attempt，直接 append 会让历史里出现两条「第 N 次」。同 attempt 的终态事件覆盖旧项，
 * 并继承 scheduled 事件记下的 `maxRetries`（终态不带这个字段）。
 *
 * 同时守住 run 边界：
 * - `next.runId < head.runId`（迟到的旧 run 事件）→ 原样返回，绝不污染新流；
 * - `next.runId > head.runId`（新一轮开始）→ 用新一轮的提示替换整份历史。
 */
export function upsertRetryNotice(notices: readonly RetryNotice[], next: RetryNotice): RetryNotice[] {
  const head = notices[0];
  if (head) {
    if (next.runId < head.runId) return [...notices];
    if (next.runId > head.runId) return [next];
  }

  const index = notices.findIndex((notice) => notice.attempt === next.attempt);
  if (index === -1) return [...notices, next];

  const merged = [...notices];
  const previous = notices[index];
  merged[index] = {
    ...next,
    maxRetries: next.maxRetries > 0 ? next.maxRetries : previous.maxRetries,
    errorMessage: next.errorMessage ?? previous.errorMessage,
    delayMs: next.delayMs ?? previous.delayMs,
  };
  return merged;
}

/** 文案 key：`chat.retryNotice.<phase>`。数字用 `{attempt}` / `{max}` 插值。 */
export function retryNoticeMessageKey(phase: RetryPhase): string {
  return `chat.retryNotice.${phase}`;
}
