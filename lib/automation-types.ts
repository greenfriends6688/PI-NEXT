// fork:proma-43-automation —— 定时任务的数据模型、常量与纯校验。
/**
 * 定时任务（Automation）生命周期模型。
 *
 * 与 `lib/automation-schedule.ts`（调度算术）、`lib/automation-store.ts`（落盘）、
 * `lib/automation-scheduler.ts`（生命周期）配套：三个模块里只有 store 摸 fs，
 * 所以本文件与 schedule 都能被 `node --experimental-strip-types` 直接单测。
 *
 * 刻意**不含** `monthly`：计划里 PR-43 要求的是 `once / daily / weekly / interval`
 * 四种，interval 已经能用「每 N 分钟 + 每日时段窗 + 每周几天」表达月度需求，
 * 再加一种只会多一条分支要测。
 */

/** 调度模式。 */
export type AutomationScheduleType = "once" | "daily" | "weekly" | "interval";

/**
 * 子会话归属策略。
 *
 * 三档（画板 D-17 帧 B 的「子会话归属」一节 · 旧设计 44 的三枚互斥芯片）：
 *
 * - `fresh`（每次新建）：**每轮都开一个新子会话**，一次也不接上一轮的上下文。
 *   适合「每轮互相独立、只当一次性批处理跑」的任务：历史不会互相污染，代价是
 *   每一轮都要重新把背景读一遍。判定见 `decideSessionTarget()`
 *   （`lib/automation-scheduler.ts`）—— 它直接给出 `reuse: false`，
 *   于是 `AutomationRunRequest.reuseSessionId` 为空，`openSession()`（`automation-runner.ts`）
 *   走新建分支拿一个全新的子会话。
 * - `daily`（同一自然日 · 默认）：同一本地自然日内的多次触发写进同一个子会话，跨日自动新建。
 *   叠加安全阀：同日复用前若该会话上下文占用已 ≥ `AUTOMATION_DAILY_CONTEXT_ROLLOVER_THRESHOLD`，
 *   本次也主动新建 —— 否则这一轮刚开跑就会被 SDK 的压缩阈值（约 77.5%）截胡。
 * - `reuse`（始终复用）：始终复用同一个子会话，长期上下文由用户自己承担 token 成本。
 *
 * 三档之外没有第四档：「已被用户接管过的子会话不复用」是三档之上的**硬规则**，
 * 不做成档位 —— 它由运行时探测（`hasUserPromptSince`）+ 落盘名单（`takenOverSessionIds`）
 * 决定，不是用户在表单里能选的意图。
 */
export type AutomationSessionMode = "fresh" | "daily" | "reuse";

/** 一轮运行的结果。`skipped` 不是失败：上一轮还在跑 / 用户正占着会话，本轮不排队。 */
export type AutomationRunStatus = "success" | "error" | "skipped";

export interface AutomationRun {
  /** 触发时刻。 */
  runAt: number;
  /** 承载本轮的子会话 id（skipped 时为空串）。 */
  sessionId: string;
  status: AutomationRunStatus;
  /** 耗时（毫秒）。 */
  durationMs?: number;
  /** status === "error" 时的原因。 */
  error?: string;
  /** status === "skipped" 时的原因（取值见 SKIP_REASON_*）。 */
  skipReason?: string;
}

/** 单条定时任务的完整状态。 */
export interface Automation {
  id: string;
  name: string;
  /** 每轮发送的任务描述。 */
  prompt: string;
  /** 是否处于调度中。false 可能来自手动暂停，也可能是失败退避自动暂停。 */
  active: boolean;
  scheduleType: AutomationScheduleType;

  /** interval：间隔分钟数（≥1）。 */
  intervalMinutes: number;
  /** interval：每日有效窗口起点 "HH:MM"（含）。 */
  activeWindowStart?: string;
  /** interval：每日有效窗口终点 "HH:MM"（不含）。 */
  activeWindowEnd?: string;
  /** interval：运行日，0=周日 … 6=周六；空/缺省 = 每天。 */
  activeWeekdays?: number[];

  /** daily/weekly：触发时刻 "HH:MM"。 */
  timeOfDay?: string;
  /** weekly：0=周日 … 6=周六。 */
  dayOfWeek?: number;
  /** once：绝对触发时间戳。 */
  scheduledAt?: number;

  /** 最多实际执行次数（成功 + 失败，不含 skipped）；缺省 = 不限。 */
  maxRuns?: number;

  /** 运行目录（cwd）。缺失 = 任务不完整，调度器跳过。 */
  cwd?: string;
  /** 运行模型，形如 "provider/modelId"。 */
  model?: string;

  /** 会话归属策略，缺省按 `daily`。 */
  sessionMode?: AutomationSessionMode;
  /** 注入给 agent 的说明用哪种语言写（缺省 en）。 */
  locale?: AutomationLocale;

  createdAt: number;
  updatedAt: number;
  /** 下次应触发的绝对时间戳 —— 调度器唯一的判据。 */
  nextRunAt: number;

  /** 最近一次**实际执行**（不含 skipped）的子会话 id。 */
  lastSessionId?: string;
  /** 最近一次实际执行的时间戳；`daily` 档的「同一自然日」就拿它比。 */
  lastRunAt?: number;
  /** 最近一次尝试（含 skipped）的时间戳，纯展示用。 */
  lastAttemptAt?: number;
  /** 最近一轮结束后的上下文占用率 0..1；读不到时是 undefined。 */
  lastContextUsage?: number;
  /** 最近一次实际执行后的运行时长（毫秒），展示用。 */
  lastDurationMs?: number;
  /** 连续失败次数；达上限自动暂停。 */
  consecutiveFailures?: number;
  /** 实际执行次数（成功 + 失败，不含 skipped）。 */
  runCount?: number;
  /** 跑满 maxRuns / once 完成而停用的时刻；与「手动暂停」「失败暂停」区分。 */
  completedAt?: number;
  /** 自动暂停的原因（人工或退避）。手动暂停不记。 */
  pausedReason?: AutomationPauseReason;
  /** 被用户接管过、不再复用的子会话 id（有界，见 `AUTOMATION_MAX_TAKEN_OVER_SESSIONS`）。 */
  takenOverSessionIds?: string[];

  /** 最近若干轮记录（升序）。 */
  runHistory: AutomationRun[];
}

export type AutomationPauseReason = "consecutive-failures" | "max-runs" | "completed";

/** 注入给 agent 的说明用哪种语言。 */
export type AutomationLocale = "en" | "zh-CN" | "zh-TW";

/** 新建/编辑时前端提交的整体。 */
export interface AutomationDraft {
  name: string;
  prompt: string;
  scheduleType: AutomationScheduleType;
  intervalMinutes: number;
  activeWindowStart?: string;
  activeWindowEnd?: string;
  activeWeekdays?: number[];
  timeOfDay?: string;
  dayOfWeek?: number;
  scheduledAt?: number;
  maxRuns?: number;
  cwd?: string;
  model?: string;
  sessionMode: AutomationSessionMode;
  locale: AutomationLocale;
  active: boolean;
}

/** 编辑时的局部更新。 */
export type AutomationPatch = Partial<AutomationDraft>;

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/**
 * tick 周期 30s —— 规则一。
 *
 * 为什么不用「按任务各自的间隔建一个长 `setInterval`」：本机实测休眠 / 后台节流后
 * 长定时器会漂到随机时刻（睡 8 小时醒来，daily 任务可能落在下午 3 点）。
 * 改成固定 30s 短轮询、每次只判 `nextRunAt <= now`，漂移上界被压到 30s，
 * 且唤醒后第一个 tick 就会补上 —— 用「时刻点」而不是「倒计时」来记账。
 */
export const AUTOMATION_TICK_INTERVAL_MS = 30_000;

/** 单轮超时上限 2 小时 —— 规则四。超时按 error 记账并释放重入槽位。 */
export const AUTOMATION_RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** 连续失败达此次数自动暂停（`active=false` + `pausedReason`）—— 规则四。 */
export const AUTOMATION_MAX_CONSECUTIVE_FAILURES = 5;

/** 运行历史保留条数，防 json 无限膨胀。 */
export const AUTOMATION_MAX_HISTORY = 20;

/**
 * `daily` 档的上下文占用切换阈值 0.7 —— 规则三。
 * SDK 的自动压缩阈值约 77.5%，留 ~7.5 个点余量，保证新建的那一轮从开头就跑在安全区。
 */
export const AUTOMATION_DAILY_CONTEXT_ROLLOVER_THRESHOLD = 0.7;

/** 被用户接管过的会话 id 最多记多少个。 */
export const AUTOMATION_MAX_TAKEN_OVER_SESSIONS = 20;

/**
 * 注入给 agent 的机器可读标记。
 * 排障时在会话文件里 `grep` 一下就知道哪几轮是定时任务触发的。
 */
export const AUTOMATION_RUN_MARKER = "<!--PI_WEB_SCHEDULED_RUN-->";

/**
 * 无人值守强制权限档 —— 硬要求。
 * 定时任务跑的时候没人盯着，留在 `ask` 档会弹一张永远等不到回答的审批卡，
 * 那一个任务会一直卡到 2 小时超时。所以调度路径**只允许** bypass。
 */
export const AUTOMATION_FORCED_PERMISSION_MODE = "bypass" as const;

/** 默认会话归属策略。 */
export const AUTOMATION_DEFAULT_SESSION_MODE: AutomationSessionMode = "daily";

export const AUTOMATION_SCHEDULE_TYPES: readonly AutomationScheduleType[] = [
  "once",
  "daily",
  "weekly",
  "interval",
];

/**
 * 表单里可选的三档，顺序 = 画板上的从左到右：
 * 每次新建 → 同一自然日 → 始终复用（复用能力递增，越右越省上下文也越难排障）。
 * `normalizeAutomationDraft()` 按这份名单收口，所以往这里加一档就等于产品多一档。
 */
export const AUTOMATION_SESSION_MODES: readonly AutomationSessionMode[] = ["fresh", "daily", "reuse"];

export const AUTOMATION_LOCALES: readonly AutomationLocale[] = ["en", "zh-CN", "zh-TW"];

/** 0 = 周日 … 6 = 周六，与 `Date#getDay()` 一致。 */
export const AUTOMATION_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** skipReason：上一轮还没结束。 */
export const SKIP_REASON_PREVIOUS_RUN = "previous-run-active";
/** skipReason：目标任务缺 cwd / model，配置不完整。 */
export const SKIP_REASON_INCOMPLETE = "incomplete-config";
/** skipReason：上一轮挂到 2 小时超时后仍未释放（理论上不会，兜底）。 */
export const SKIP_REASON_SOURCE_BUSY = "source-busy";

/** 最小间隔：1 分钟。低于 1 分钟会让 30s tick 每次都命中同一任务，纯烧钱。 */
export const AUTOMATION_MIN_INTERVAL_MINUTES = 1;

// ---------------------------------------------------------------------------
// 纯校验（API 与 store 共用；不合法直接抛 AutomationInputError → HTTP 400）
// ---------------------------------------------------------------------------

export class AutomationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationInputError";
  }
}

const CLOCK_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && CLOCK_RE.test(value);
}

function asTrimmedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new AutomationInputError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new AutomationInputError(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function asOptionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return asTrimmedString(value, field, maxLength);
}

function asFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AutomationInputError(`${field} must be a finite number`);
  }
  return value;
}

function asOptionalWeekdays(value: unknown): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new AutomationInputError("activeWeekdays must be an array");
  const days = new Set<number>();
  for (const raw of value) {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 6) {
      throw new AutomationInputError("activeWeekdays entries must be integers between 0 and 6");
    }
    days.add(raw);
  }
  if (days.size === 0) return undefined;
  return [...days].sort((a, b) => a - b);
}

function asOptionalClock(value: unknown, field: string): string | undefined {
  const text = asOptionalString(value, field, 5);
  if (text === undefined) return undefined;
  if (!CLOCK_RE.test(text)) throw new AutomationInputError(`${field} must look like HH:MM`);
  return text;
}

function asOptionalIntBetween(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = asFiniteNumber(value, field);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AutomationInputError(`${field} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function asOptionalModel(value: unknown): string | undefined {
  const text = asOptionalString(value, "model", 200);
  return text === undefined ? undefined : text;
}

/**
 * 把前端提交的整体规范化成 `AutomationDraft`。
 * 顺带做两件**语义**清理（不只是类型检查）：
 *   · 与 scheduleType 无关的字段一律丢掉（daily 任务上的 weekday 之类），
 *     否则面板改了间隔后旧字段还躺在文件里，改回去时会「诈尸」；
 *   · interval 的时段窗两端要么都给且 start<end，要么都不给。
 */
export function normalizeAutomationDraft(raw: unknown): AutomationDraft {
  if (!raw || typeof raw !== "object") throw new AutomationInputError("automation must be an object");
  const input = raw as Record<string, unknown>;

  const scheduleType = input.scheduleType;
  if (typeof scheduleType !== "string" || !AUTOMATION_SCHEDULE_TYPES.includes(scheduleType as AutomationScheduleType)) {
    throw new AutomationInputError(`scheduleType must be one of ${AUTOMATION_SCHEDULE_TYPES.join(", ")}`);
  }
  const type = scheduleType as AutomationScheduleType;

  const name = asTrimmedString(input.name ?? "", "name", 120);
  if (!name) throw new AutomationInputError("name must not be empty");
  const prompt = asTrimmedString(input.prompt ?? "", "prompt", 8000);
  if (!prompt) throw new AutomationInputError("prompt must not be empty");

  const sessionMode = input.sessionMode === undefined
    ? AUTOMATION_DEFAULT_SESSION_MODE
    : input.sessionMode;
  if (typeof sessionMode !== "string" || !AUTOMATION_SESSION_MODES.includes(sessionMode as AutomationSessionMode)) {
    throw new AutomationInputError(`sessionMode must be one of ${AUTOMATION_SESSION_MODES.join(", ")}`);
  }

  const locale = input.locale === undefined ? "en" : input.locale;
  if (typeof locale !== "string" || !AUTOMATION_LOCALES.includes(locale as AutomationLocale)) {
    throw new AutomationInputError(`locale must be one of ${AUTOMATION_LOCALES.join(", ")}`);
  }

  if (input.active !== undefined && typeof input.active !== "boolean") {
    throw new AutomationInputError("active must be a boolean");
  }

  const intervalMinutes = asFiniteNumber(input.intervalMinutes ?? AUTOMATION_MIN_INTERVAL_MINUTES, "intervalMinutes");
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < AUTOMATION_MIN_INTERVAL_MINUTES) {
    throw new AutomationInputError(
      `intervalMinutes must be an integer of at least ${AUTOMATION_MIN_INTERVAL_MINUTES}`,
    );
  }

  const draft: AutomationDraft = {
    name,
    prompt,
    scheduleType: type,
    // intervalMinutes 对 daily / weekly / once 不参与调度，但表单里始终带着，
    // 统一存回用户填的值（校验对所有模式一视同仁，免得切模式时校验规则突变）。
    intervalMinutes,
    sessionMode: sessionMode as AutomationSessionMode,
    locale: locale as AutomationLocale,
    active: input.active !== false,
  };

  const windowStart = asOptionalClock(input.activeWindowStart, "activeWindowStart");
  const windowEnd = asOptionalClock(input.activeWindowEnd, "activeWindowEnd");
  const timeOfDay = asOptionalClock(input.timeOfDay, "timeOfDay");
  // 0 = 周日，所以这里不能用「至少 1」的整数校验。
  const dayOfWeek = asOptionalIntBetween(input.dayOfWeek, "dayOfWeek", 0, 6);
  const scheduledAt = input.scheduledAt === undefined || input.scheduledAt === null
    ? undefined
    : Math.round(asFiniteNumber(input.scheduledAt, "scheduledAt"));
  const maxRuns = asOptionalIntBetween(input.maxRuns, "maxRuns", 1, Number.MAX_SAFE_INTEGER);
  const cwd = asOptionalString(input.cwd, "cwd", 4096);
  const model = asOptionalModel(input.model);
  const activeWeekdays = asOptionalWeekdays(input.activeWeekdays);

  switch (type) {
    case "once": {
      if (scheduledAt === undefined || scheduledAt <= 0) {
        throw new AutomationInputError("scheduledAt is required for a once automation");
      }
      draft.scheduledAt = scheduledAt;
      break;
    }
    case "interval": {
      draft.activeWeekdays = activeWeekdays;
      if ((windowStart === undefined) !== (windowEnd === undefined)) {
        throw new AutomationInputError("activeWindowStart and activeWindowEnd must be provided together");
      }
      if (windowStart !== undefined && windowEnd !== undefined) {
        if (windowStart >= windowEnd) {
          throw new AutomationInputError("activeWindowStart must be earlier than activeWindowEnd");
        }
        draft.activeWindowStart = windowStart;
        draft.activeWindowEnd = windowEnd;
      }
      break;
    }
    case "weekly": {
      if (dayOfWeek === undefined) throw new AutomationInputError("dayOfWeek is required for a weekly automation");
      if (timeOfDay === undefined) throw new AutomationInputError("timeOfDay is required for a weekly automation");
      draft.dayOfWeek = dayOfWeek;
      draft.timeOfDay = timeOfDay;
      break;
    }
    case "daily": {
      if (timeOfDay === undefined) throw new AutomationInputError("timeOfDay is required for a daily automation");
      draft.timeOfDay = timeOfDay;
      break;
    }
  }

  if (maxRuns !== undefined) draft.maxRuns = maxRuns;
  if (cwd !== undefined) draft.cwd = cwd;
  if (model !== undefined) draft.model = model;

  return draft;
}