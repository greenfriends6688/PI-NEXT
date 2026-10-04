// fork:proma-43-automation —— 定时任务的生命周期调度器。
/**
 * 调度器本体。**决策全是纯函数，运行时的时钟 / 定时器 / 存储 / agent 运行口全是注入的**，
 * 所以 `lib/automation-scheduler.test.mjs` 能在毫秒内跑完「跨日」「连续失败到顶」「忙时跳过」
 * 这些真实场景，既不真等 30s，也不需要真的模型。
 *
 * 四条踩过坑的规则各自的落点：
 *
 * | 规则 | 落点 |
 * | --- | --- |
 * | 1 · 30s 短 tick，不长 setInterval | `createAutomationScheduler().start()` 里的 `setInterval(tick, AUTOMATION_TICK_INTERVAL_MS)`；每次 tick 只判 `nextRunAt <= now` |
 * | 2 · 启动恢复防雪崩 | `rescheduleOverdueOnStart()`（automation-schedule.ts），在 `start()` 里先跑一遍再起定时器 |
 * | 3 · 子会话复用策略 | `decideSessionTarget()`（`daily` 同自然日 / 跨日 / 上下文 ≥70%；`reuse` 恒复用；被接管不复用） |
 * | 4 · 失败退避 + 自动暂停 | `applyRunOutcome()` + `withRunTimeout()`（单轮 2 小时） |
 *
 * 另外三条硬要求：
 *   · 忙时跳过 —— `tick()` 里上一轮未结束（或用户正占着那个会话）就记一条 `skipped`
 *     并把 `nextRunAt` 推到下一档，**不排队堆积**。
 *   · 无人值守强制 bypass —— `AUTOMATION_FORCED_PERMISSION_MODE` 是 `buildRunRequest()`
 *     里写死的，不从任务配置读。
 *   · 注入标记 —— `buildRunPrompt()` 追加 `AUTOMATION_RUN_MARKER`；
 *     `buildAutomationContext()` 明确告诉 agent「这本身就是定时任务，别建议我再建一个」。
 */
import {
  AUTOMATION_DAILY_CONTEXT_ROLLOVER_THRESHOLD,
  AUTOMATION_DEFAULT_SESSION_MODE,
  AUTOMATION_FORCED_PERMISSION_MODE,
  AUTOMATION_MAX_CONSECUTIVE_FAILURES,
  AUTOMATION_MAX_HISTORY,
  AUTOMATION_RUN_MARKER,
  AUTOMATION_RUN_TIMEOUT_MS,
  AUTOMATION_TICK_INTERVAL_MS,
  SKIP_REASON_PREVIOUS_RUN,
  SKIP_REASON_SOURCE_BUSY,
  type Automation,
  type AutomationRun,
} from "./automation-types";
import {
  computeNextRunAt,
  isRunQuotaComplete,
  isSameLocalDay,
  rescheduleOverdueOnStart,
} from "./automation-schedule";
// fork:automation-lease —— 跨进程认领（可选，缺省退回进程内 runningIds）。
import { claimAutomationLease, type AutomationLeaseIo } from "./automation-lease";

/** 翻译函数。默认实现由运行时注入（`lib/automation-runtime.ts`），避免纯模块依赖 i18n 注册表。 */
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/** 按任务自己的 locale 翻译（同一个任务内部语言一致，agent 读到的说明与面板一致）。 */
export type AutomationTranslate = (
  automation: Automation,
  key: string,
  params?: Record<string, string | number>,
) => string;

// ---------------------------------------------------------------------------
// 与外部世界的接口（全部注入）
// ---------------------------------------------------------------------------

/** 一次执行要交给 agent 运行口的全部信息。 */
export interface AutomationRunRequest {
  automation: Automation;
  /** 要复用的子会话；`undefined` = 新建。 */
  reuseSessionId?: string;
  /** 本轮发送的文本（已含调度标记）。 */
  prompt: string;
  /** 注入给 agent 的说明（已含「别建议我再建一个」）。 */
  context: string;
  /** 无人值守强制 bypass —— 不读任务配置。 */
  permissionMode: typeof AUTOMATION_FORCED_PERMISSION_MODE;
  /** 运行目录。 */
  cwd: string;
  /** 运行模型 "provider/modelId"，缺省用会话默认。 */
  model?: string;
  /** 超时/中止信号；2 小时到点会 abort，运行口应当停掉这一轮。 */
  signal: AbortSignal;
}

export interface AutomationRunResult {
  sessionId: string;
  /** 本轮结束后的上下文占用率 0..1；读不到就 undefined。 */
  contextUsage?: number;
  durationMs?: number;
}

export interface AutomationRunPort {
  run(request: AutomationRunRequest): Promise<AutomationRunResult>;
  /** 会话此刻是否正被占用（用户在 UI 里跑）——可选，缺省当作不忙。 */
  isSessionBusy?(sessionId: string): boolean;
  /**
   * 运行时从会话文件探测「上次定时运行之后用户自己发过消息」——可选。
   * 返回 true 时等同于被接管：这一轮另开会话，不往用户的会话里塞定时提示词。
   */
  hasUserPromptSince?(sessionId: string, since: number): boolean | Promise<boolean>;
}

export interface AutomationStorePort {
  list(): Automation[];
  get(id: string): Automation | undefined;
  /** 写回一条完整记录并返回落盘后的副本。 */
  save(automation: Automation): Automation;
}

export interface AutomationTimerPort {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface AutomationSchedulerDeps {
  now: () => number;
  store: AutomationStorePort;
  runner: AutomationRunPort;
  translate: AutomationTranslate;
  timer?: AutomationTimerPort;
  /**
   * fork:automation-lease · **跨进程**认领。缺省不装（退回进程内 `runningIds`，
   * 也就是今天的行为）。装上之后两个进程不会对同一个任务各跑一轮。
   *
   * 为什么需要它：`runningIds` 只是进程内的 Set，而桌面壳已经是两个进程
   * （Electron main + next start）。今天调度器只由 `instrumentation-node.ts`
   * 起、所以碰巧不重复 —— 但那是靠「恰好只有一个进程 import 它」，不是靠机制。
   * 这个口就是那道机制。
   */
  leaseIo?: AutomationLeaseIo;
  /** 任何一次落盘后回调（前端轮询 / 广播用）。 */
  onChanged?: (automations: Automation[]) => void;
  log?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// 规则三 · 子会话复用决策（纯）
// ---------------------------------------------------------------------------

/** 不复用、另开会话的原因。UI 用它解释「为什么这次是新会话」。 */
export type SessionCreateReason =
  | "no-session"
  | "never-run"
  | "cross-day"
  | "context-pressure"
  | "taken-over"
  | "missing-session";

export type SessionDecision =
  | { reuse: true; sessionId: string }
  | { reuse: false; reason: SessionCreateReason };

export interface SessionDecisionInput {
  automation: Automation;
  now: number;
  /** 上次结束时的上下文占用率 0..1；读不到是 undefined。 */
  lastContextUsage?: number;
  /** 用户是否已经接管过这个会话（显式标记或运行时探测）。 */
  takenOver?: boolean;
}

/**
 * 这一轮该复用上次那个子会话，还是另开一个？
 *
 * 判定链（顺序即优先级，先命中先返回）：
 *   1. 没有 `lastSessionId` / 还没跑过 → 新建；
 *   2. 会话已被用户接管 → 新建（**不要**把定时提示词塞进用户正在用的私人会话）；
 *   3. `reuse` 档 → 始终复用；
 *   4. `daily` 档：
 *      · 上次运行不在同一个**本地自然日** → 新建（`getFullYear/Month/Date`，不引时区库）；
 *      · 同日但上下文占用 ≥ 70% → 新建，避开 SDK 约 77.5% 的压缩阈值；
 *      · 占用率读不到（undefined）时**保守复用** —— 宁可多花一次新建的钱，
 *        也不要因为一次探测失败就把用户的连续上下文切断。
 */
export function decideSessionTarget(input: SessionDecisionInput): SessionDecision {
  const { automation, now, lastContextUsage, takenOver } = input;
  const sessionId = automation.lastSessionId;
  if (!sessionId) return { reuse: false, reason: "no-session" };
  if (automation.lastRunAt === undefined) return { reuse: false, reason: "never-run" };
  if (takenOver) return { reuse: false, reason: "taken-over" };

  const mode = automation.sessionMode ?? AUTOMATION_DEFAULT_SESSION_MODE;
  if (mode === "reuse") return { reuse: true, sessionId };

  if (!isSameLocalDay(automation.lastRunAt, now)) return { reuse: false, reason: "cross-day" };

  if (
    lastContextUsage !== undefined
    && lastContextUsage >= AUTOMATION_DAILY_CONTEXT_ROLLOVER_THRESHOLD
  ) {
    return { reuse: false, reason: "context-pressure" };
  }

  return { reuse: true, sessionId };
}

// ---------------------------------------------------------------------------
// 规则四 · 失败退避 + 自动暂停（纯）
// ---------------------------------------------------------------------------

export interface OutcomeInput {
  automation: Automation;
  run: AutomationRun;
  now: number;
  /** 本轮结束后的上下文占用率，写回给下一次的复用判断。 */
  contextUsage?: number;
}

export interface OutcomeResult {
  automation: Automation;
  /** 因连续失败被自动暂停。 */
  pausedByBackoff: boolean;
  /** 跑满配额（once / maxRuns）而停用。 */
  completed: boolean;
}

/**
 * 把一轮结果折算成下一份记录。
 *
 * `skipped` 不进失败账也不占配额 —— 它代表「这一轮根本没跑」，记进失败会让一个
 * 偶尔撞上「上一轮还在跑」的任务平白被暂停。只有真正执行的轮次才推进 `runCount`
 * 与 `consecutiveFailures`。
 */
export function applyRunOutcome(input: OutcomeInput): OutcomeResult {
  const { automation, run, now, contextUsage } = input;
  const next: Automation = {
    ...automation,
    updatedAt: now,
    lastAttemptAt: run.runAt,
    runHistory: [...automation.runHistory, run].slice(-AUTOMATION_MAX_HISTORY),
  };

  if (contextUsage !== undefined) next.lastContextUsage = contextUsage;

  if (run.status === "skipped") {
    return { automation: next, pausedByBackoff: false, completed: false };
  }

  const runCount = (automation.runCount ?? 0) + 1;
  next.runCount = runCount;
  next.lastRunAt = run.runAt;
  if (run.sessionId) next.lastSessionId = run.sessionId;
  if (run.durationMs !== undefined) next.lastDurationMs = run.durationMs;

  if (run.status === "error") {
    next.consecutiveFailures = (automation.consecutiveFailures ?? 0) + 1;
    if (next.consecutiveFailures >= AUTOMATION_MAX_CONSECUTIVE_FAILURES && next.active) {
      next.active = false;
      next.pausedReason = "consecutive-failures";
      next.completedAt = undefined;
      return { automation: next, pausedByBackoff: true, completed: false };
    }
  } else {
    next.consecutiveFailures = 0;
  }

  if (next.active && isRunQuotaComplete(next, runCount)) {
    next.active = false;
    next.pausedReason = next.scheduleType === "once" ? "completed" : "max-runs";
    next.completedAt = now;
    return { automation: next, pausedByBackoff: false, completed: true };
  }

  next.nextRunAt = computeNextRunAt(next, now);
  return { automation: next, pausedByBackoff: false, completed: false };
}

/** 手动重新启用时清掉暂停痕迹（已完成的任务另算，需要重置配额）。 */
export function resumeAutomation(automation: Automation, now: number, resetQuota = false): Automation {
  const next: Automation = {
    ...automation,
    active: true,
    updatedAt: now,
    nextRunAt: computeNextRunAt(automation, now),
  };
  if (resetQuota) {
    next.runCount = 0;
    next.completedAt = undefined;
    next.consecutiveFailures = 0;
  } else if (automation.completedAt !== undefined) {
    next.completedAt = undefined;
  }
  delete next.pausedReason;
  return next;
}

// ---------------------------------------------------------------------------
// 注入给 agent 的两段文本
// ---------------------------------------------------------------------------

/**
 * 本轮发送的用户消息。末尾追加机器可读标记：
 * 会话文件里 `grep PI_WEB_SCHEDULED_RUN` 就能把所有自动轮次捞出来排障。
 */
export function buildRunPrompt(automation: Automation): string {
  return `${automation.prompt}\n\n${AUTOMATION_RUN_MARKER}`;
}

/**
 * 注入给 agent 的说明。
 *
 * 最后一句是硬要求：**明确告诉模型这本身就是定时任务，不要再建议用户建一个**。
 * 不写这句，模型的默认反应是「要不要我给你建个每日任务？」—— 对着一条已经存在的
 * 定时任务重复建档，是这类功能最常见的翻车方式。
 */
export function buildAutomationContext(automation: Automation, translate: AutomationTranslate): string {
  const t: TranslateFn = (key, params) => translate(automation, key, params);
  return t("automation.runContext", {
    name: automation.name,
    schedule: t("automation.runSchedule", { id: automation.id }),
  });
}

// ---------------------------------------------------------------------------
// 超时保护
// ---------------------------------------------------------------------------

export class AutomationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`automation run timed out after ${timeoutMs} ms`);
    this.name = "AutomationTimeoutError";
  }
}

/**
 * 给运行口套一个 2 小时上限，并 abort 掉底层信号。
 *
 * 为什么需要：运行口是一个 agent 会话，它可能因为网络挂住、因为权限弹窗等着、
 * 因为 provider 不返回而永远不结束。没有这个上限，那一个任务会永远占着 `runningIds`
 * 里的槽位，之后每一轮都被判成「上一轮未结束」而 skip —— 任务看起来还活着，其实死了。
 */
export async function withRunTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = AUTOMATION_RUN_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_resolve, reject) => {
        /* 这个定时器**不能** `unref()`。
         *
         * 原本这里有一行 `.unref()`，理由写的是「Node 里 setTimeout 会吊住进程；
         * 调度器必须能被正常关闭」。那个理由对**轮询**定时器成立（`automation-runtime`
         * 里 tick 的 setInterval 确实 unref 了，那才是「不能被它吊住」的那个），
         * 但对这个超时定时器是**反的**：unref 之后，只要被计时的那个 run 卡住、
         * 而事件循环里恰好没有别的句柄，定时器就永远不会触发 —— 进程直接退出，
         * **超时保护静默失效**。
         *
         * 症状先出现在 CI：Node 22 上（本地 Node 24 碰巧有别的句柄吊着，所以看不出来）
         * `withRunTimeout 超时会 abort 底层信号并抛 AutomationTimeoutError` 报
         * 「Promise resolution is still pending but the event loop has already resolved」。
         * 而那个测试说的正是真实情形：一个既不 settle 也不理 abort 的 run。
         *
         * 不 unref 的代价是：有 run 在跑时进程会活到超时到点。但那时**本来就该活着**
         * （有一轮正在执行），而且 `finally` 里的 clearTimeout 会让正常完成的 run
         * 立即释掉它。 */
        timer = setTimeout(() => {
          controller.abort();
          reject(new AutomationTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 调度器
// ---------------------------------------------------------------------------

export interface AutomationScheduler {
  start(): void;
  stop(): void;
  isStarted(): boolean;
  /** 一个 tick。测试直接调它代替等 30s。 */
  tick(): Promise<void>;
  /** 手动「立即运行一次」。 */
  runNow(id: string): Promise<void>;
  /** 正在执行的 automation id（面板用来禁用按钮）。 */
  activeRunIds(): string[];
}

const realTimer: AutomationTimerPort = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export function createAutomationScheduler(deps: AutomationSchedulerDeps): AutomationScheduler {
  const timer = deps.timer ?? realTimer;
  const runningIds = new Set<string>();
  /**
   * fork:automation-lease —— 认领：先问跨进程那道（装了才有），再问进程内那道。
   * 两道都要过：`runningIds` 挡的是**本进程**内的重入（tick 重叠 / run-now 与
   * tick 同时命中），租约挡的是**跨进程**。返回 null = 已被别人占着。
   */
  const claim = (automationId: string): (() => void) | null => {
    if (runningIds.has(automationId)) return null;
    const releaseLease = deps.leaseIo
      ? claimAutomationLease(deps.leaseIo, automationId, deps.now())
      : () => {};
    if (!releaseLease) return null;
    runningIds.add(automationId);
    let released = false;
    return () => {
      runningIds.delete(automationId);
      if (released) return;
      released = true;
      releaseLease();
    };
  };
  let tickTimer: unknown;
  /** 同一时刻只允许一个 tick 在跑，防止慢 tick 与定时 tick 叠加。 */
  let ticking = false;

  const log = (message: string): void => deps.log?.(message);
  const now = (): number => deps.now();

  const notifyChanged = (): void => deps.onChanged?.(deps.store.list());

  const commit = (automation: Automation): void => {
    deps.store.save(automation);
    notifyChanged();
  };

  const recordSkip = (automation: Automation, reason: string, at: number): void => {
    const run: AutomationRun = {
      runAt: at,
      sessionId: "",
      status: "skipped",
      skipReason: reason,
    };
    const { automation: next } = applyRunOutcome({ automation, run, now: at });
    // 不排队：直接推到下一档，否则这个「跳过」会每 30s 记一次、把历史刷爆。
    // once 没有下一档，跳过它就等于把任务悄悄改没了，所以 once 只跳过不记账。
    if (next.scheduleType !== "once") next.nextRunAt = computeNextRunAt(next, at);
    commit(next);
  };

  const finish = (automation: Automation, run: AutomationRun, contextUsage: number | undefined): void => {
    const at = now();
    const outcome = applyRunOutcome({ automation, run, now: at, contextUsage });
    commit(outcome.automation);
    if (outcome.pausedByBackoff) {
      log(
        `[automation] ${automation.name} 连续失败 ${AUTOMATION_MAX_CONSECUTIVE_FAILURES} 次，已自动暂停：${run.error ?? ""}`,
      );
    } else if (outcome.completed) {
      log(`[automation] ${automation.name} 已跑满配额，自动停用`);
    }
  };

  const execute = async (automation: Automation): Promise<void> => {
    const runAt = now();
    let sessionId = "";
    try {
      const lastSessionId = automation.lastSessionId;
      const takenOver = Boolean(
        (lastSessionId && automation.takenOverSessionIds?.includes(lastSessionId))
        || (lastSessionId
          ? await deps.runner.hasUserPromptSince?.(lastSessionId, automation.lastRunAt ?? 0) === true
          : false),
      );
      const decision = decideSessionTarget({
        automation,
        now: runAt,
        lastContextUsage: automation.lastContextUsage,
        takenOver,
      });

      const buildRequest = (signal: AbortSignal): AutomationRunRequest => ({
        automation,
        reuseSessionId: decision.reuse ? decision.sessionId : undefined,
        prompt: buildRunPrompt(automation),
        context: buildAutomationContext(automation, deps.translate),
        // 无人值守：不论任务配置写没写，这里都是 bypass。留在 ask 档会弹一张
        // 永远等不到回答的审批卡，任务会一路卡到 2 小时超时。
        permissionMode: AUTOMATION_FORCED_PERMISSION_MODE,
        cwd: automation.cwd!,
        model: automation.model,
        signal,
      });

      let result: AutomationRunResult;
      try {
        result = await withRunTimeout((signal) => deps.runner.run(buildRequest(signal)));
      } catch (error) {
        sessionId = decision.reuse ? decision.sessionId : "";
        finish(automation, {
          runAt,
          sessionId,
          status: "error",
          durationMs: now() - runAt,
          error: error instanceof Error ? error.message : String(error),
        }, undefined);
        return;
      }

      sessionId = result.sessionId;
      finish(automation, {
        runAt,
        sessionId,
        status: "success",
        durationMs: result.durationMs ?? now() - runAt,
      }, result.contextUsage);
    } catch (error) {
      // 走到这里说明决策/构造请求阶段就炸了（比如 cwd 没了）。同样要记账，
      // 否则它会每 30s 失败一次而永远不被暂停。
      finish(automation, {
        runAt,
        sessionId,
        status: "error",
        durationMs: now() - runAt,
        error: error instanceof Error ? error.message : String(error),
      }, undefined);
    }
  };

  const runTracked = async (automation: Automation): Promise<void> => {
    const release = claim(automation.id);
    if (!release) {
      recordSkip(automation, SKIP_REASON_PREVIOUS_RUN, now());
      return;
    }
    try {
      await execute(automation);
    } finally {
      release();
    }
  };

  const scheduler: AutomationScheduler = {
    start() {
      if (tickTimer !== undefined) return;

      // 规则二：先把所有过期的 nextRunAt 顺延到「现在 + 一个完整间隔」，
      // 再开始轮询。顺序不能反 —— 反了就等于先雪崩一次再修。
      const bootAt = now();
      for (const automation of deps.store.list()) {
        const rescheduled = rescheduleOverdueOnStart(automation, bootAt);
        if (rescheduled) {
          log(`[automation] 启动顺延 ${automation.name}：${automation.nextRunAt} → ${rescheduled.nextRunAt}`);
          deps.store.save(rescheduled);
        }
      }
      notifyChanged();

      tickTimer = timer.setInterval(() => {
        void scheduler.tick();
      }, AUTOMATION_TICK_INTERVAL_MS);
      log(`[automation] 调度器已启动，tick 周期 ${AUTOMATION_TICK_INTERVAL_MS / 1000}s`);
    },

    stop() {
      if (tickTimer === undefined) return;
      timer.clearInterval(tickTimer);
      tickTimer = undefined;
      log("[automation] 调度器已停止");
    },

    isStarted() {
      return tickTimer !== undefined;
    },

    async tick() {
      if (ticking) return;
      ticking = true;
      try {
        const at = now();
        for (const automation of deps.store.list()) {
          if (!automation.active) continue;
          if (automation.completedAt !== undefined) continue;
          // 配置不完整（缺 cwd）的任务连运行口都构造不出来，直接静默跳过：
          // 记账反而会让它每 30s 失败一次直到被暂停，掩盖「你还没填工作目录」这件事。
          if (!automation.cwd) continue;
          if (automation.nextRunAt > at) continue;
          // 忙时跳过：上一轮没结束，或者用户正占着那个会话。
          if (runningIds.has(automation.id)) {
            recordSkip(automation, SKIP_REASON_PREVIOUS_RUN, at);
            continue;
          }
          const lastSessionId = automation.lastSessionId;
          const userBusy = Boolean(
            lastSessionId && deps.runner.isSessionBusy?.(lastSessionId) === true,
          );
          if (userBusy) {
            recordSkip(automation, SKIP_REASON_SOURCE_BUSY, at);
            continue;
          }
          // 不 await：多个任务可以并行触发，各自的 runningIds 负责防重入。
          void runTracked(automation);
        }
      } finally {
        ticking = false;
      }
    },

    async runNow(id: string) {
      const automation = deps.store.get(id);
      if (!automation) throw new Error(`automation not found: ${id}`);
      if (!automation.cwd) throw new Error("automation has no cwd configured");
      const release = claim(id);
      if (!release) {
        recordSkip(automation, SKIP_REASON_PREVIOUS_RUN, now());
        return;
      }
      try {
        await execute(automation);
      } finally {
        release();
      }
    },

    activeRunIds() {
      return [...runningIds];
    },
  };

  return scheduler;
}

/**
 * 进程内单例。由 `lib/automation-runtime.ts` 在启动钩子里装配。
 *
 * **必须挂在 globalThis 上（不是模块级变量）**：生产构建里 `instrumentation.ts`
 * 与 `app/api/automation/route.ts` 是两份独立的模块实例，模块级 `let singleton`
 * 在两边各有一份。实测后果：调度器在 instrumentation 那份里真的在 tick，而
 * 路由读到的 `getAutomationScheduler()` 恒为 null —— 面板永远显示「调度器没有在
 * 跑」，且 `runAutomationNow()` 会在路由那份模块图里**再起一个**调度器，两个
 * tick 抢同一个 `automations.json`。与 `lib/rpc-manager.ts` 的 `__piSessions`
 * 同一个坑（那里是防 hot-reload，这里是防多入口）。
 */
const SINGLETON_KEY = Symbol.for("pi-web.automationScheduler");

interface SchedulerGlobal {
  [SINGLETON_KEY]?: AutomationScheduler | null;
}

export function registerAutomationScheduler(scheduler: AutomationScheduler | null): void {
  (globalThis as SchedulerGlobal)[SINGLETON_KEY] = scheduler;
}

export function getAutomationScheduler(): AutomationScheduler | null {
  return (globalThis as SchedulerGlobal)[SINGLETON_KEY] ?? null;
}