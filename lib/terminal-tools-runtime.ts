/**
 * fork:proma-41-terminal — Agent 可见终端的**机械层**（进程内状态 + 复用既有 PTY 宿主）。
 *
 * ## 绝不自己起 node-pty
 *
 * 本仓的 PTY 宿主是 `lib/terminal-manager.ts`（`/api/terminal`、`/api/terminal/[id]`、
 * `components/TerminalPanel.tsx` 用的那一个，node-pty 只活在那里）。这里只**调它的四个函数**：
 * `createTerminal` / `subscribeTerminal` / `writeTerminal` / `killTerminal`。
 * 理由与计划文档一致：给 agent 再挂一份 node-pty，跨进程崩溃会带走父会话；
 * 复用既有宿主还白拿一个好处 —— agent 开的终端**天生就能被人看见**，
 * 因为用户那边接的是同一个 `/api/terminal/[id]/events`。
 *
 * ## 这里多出来的那份账：会话归属
 *
 * manager 的 registry 是全局的（用户手开的终端也在里面）。agent 侧另外记三件事：
 *
 * · **归属**：`sessionId -> terminalId`。别的会话既列不出、也读不到、更写不进；
 *   子代理按自己的 sessionId 记账，因此子会话**看不到父会话的终端**
 *   （与 Proma `getOwnedAgentTerminal` 同一语义）。
 * · **每终端一份可分页的输出缓冲**（`terminal-tools-output.ts`），上限 256KB。
 * · **busy（= 不可复用）**：上一条命令还在等、或上次等待以超时/中止收尾（状态不明），
 *   又或者是交互式 / 长驻命令（Proma：交互式、长驻或忙碌状态不明的终端不可复用）。
 *
 * ## 上界
 *
 * 终端输出是唯一可以无限增长的 agent 输入源，所以三处都封顶：
 * 每终端缓冲 {@link TERMINAL_RETAINED_CHARS}、每会话
 * {@link TERMINAL_MAX_PER_SESSION} 个、整进程 {@link TERMINAL_MAX_TOTAL} 个。
 * 超限时先回收**已退出**的终端；全都还活着就**拒开新终端**并把原因写给模型
 * （绝不去 kill 正在跑、用户可能正看着的命令）。
 */

import { randomUUID } from "crypto";
import { createTerminal, killTerminal, subscribeTerminal, writeTerminal } from "./terminal-manager";
import {
  appendTerminalOutput,
  emptyTerminalOutputBuffer,
  readTerminalOutput,
  type TerminalOutputBuffer,
  type TerminalOutputReadOptions,
  type TerminalOutputReadResult,
} from "./terminal-tools-output";
import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
  TERMINAL_EXITED_RETENTION_MS,
  TERMINAL_INTERRUPT,
  TERMINAL_MAX_PER_SESSION,
  TERMINAL_MAX_TOTAL,
  TERMINAL_RETAINED_CHARS,
  resolveExecuteTimeoutMs,
  resolveQuietMs,
  type AgentTerminalSummary,
  type TerminalWaitStatus,
} from "./terminal-tools-core";

/** 进程内的一条记录。时间戳是 epoch 毫秒（要排序）；对外一律走 `AgentTerminalSummary` 的 ISO 串。 */
export interface AgentTerminalRecord {
  terminalId: string;
  sessionId: string;
  title: string;
  cwd: string;
  status: "running" | "exited";
  exitCode: number | null;
  createdAt: number;
  lastUsedAt: number;
  exitedAt: number | null;
  /** busy = 不可复用：上一条命令状态未知，或它是交互式/长驻命令。 */
  busy: boolean;
  buffer: TerminalOutputBuffer;
  unsubscribe: () => void;
  /** 输出到达时唤醒等待者（`terminal_execute` 的「输出静止」判定靠它）。 */
  notify: (() => void) | null;
}

export type AgentTerminalEvent =
  | { type: "opened"; terminal: AgentTerminalSummary }
  | { type: "output"; terminalId: string }
  | { type: "exit"; terminalId: string; exitCode: number }
  | { type: "closed"; terminalId: string };

export type AgentTerminalEventListener = (event: AgentTerminalEvent) => void;

declare global {
  var __piWebAgentTerminals: Map<string, AgentTerminalRecord> | undefined;
  var __piWebAgentTerminalListeners: Set<AgentTerminalEventListener> | undefined;
}

function terminals(): Map<string, AgentTerminalRecord> {
  if (!globalThis.__piWebAgentTerminals) globalThis.__piWebAgentTerminals = new Map();
  return globalThis.__piWebAgentTerminals;
}

function listeners(): Set<AgentTerminalEventListener> {
  if (!globalThis.__piWebAgentTerminalListeners) globalThis.__piWebAgentTerminalListeners = new Set();
  return globalThis.__piWebAgentTerminalListeners;
}

/**
 * 订阅 agent 终端的**元数据**事件（开 / 输出 / 退出 / 关），**不含输出正文**。
 *
 * 集成位：UI 得知道"agent 开了新终端"才能在右侧加一个标签页。`/api/terminal/**` 与
 * `components/*` 本补丁不许动，所以这里留成纯订阅接口，由集成方把它接到
 * `/api/terminal/[id]/events` 那条已有的 SSE 通道上。
 */
export function onAgentTerminalEvent(listener: AgentTerminalEventListener): () => void {
  listeners().add(listener);
  return () => {
    listeners().delete(listener);
  };
}

function emit(event: AgentTerminalEvent): void {
  for (const listener of [...listeners()]) {
    try {
      listener(event);
    } catch {
      // 监听方是 UI 侧的旁路，不能让它把 PTY 数据流带崩。
    }
  }
}

/** terminalId 走 UI 那一侧的形状（32 位小写 hex，`components/terminal-tab-state.ts`）。 */
function newTerminalId(): string {
  return randomUUID().replace(/-/g, "");
}

function summarize(record: AgentTerminalRecord): AgentTerminalSummary {
  return {
    terminalId: record.terminalId,
    title: record.title,
    cwd: record.cwd,
    status: record.status,
    exitCode: record.exitCode,
    createdAt: new Date(record.createdAt).toISOString(),
    lastUsedAt: new Date(record.lastUsedAt).toISOString(),
    availableStartOffset: record.buffer.startOffset,
    availableEndOffset: record.buffer.endOffset,
    busy: record.busy,
  };
}

/** 全部 agent 终端（含别的会话的）——给集成方的 UI 用；模型侧走 `listAgentTerminals`。 */
export function listAllAgentTerminals(): AgentTerminalSummary[] {
  return [...terminals().values()].sort((a, b) => a.createdAt - b.createdAt).map(summarize);
}

function owned(sessionId: string, terminalId: string): AgentTerminalRecord {
  const record = terminals().get(terminalId);
  if (!record || record.sessionId !== sessionId) {
    throw new Error("终端不存在或不属于当前会话（用 terminal_list 看本会话的终端）");
  }
  return record;
}

/** 最近一次用过、仍在运行的终端（`terminal_read` 省略 id 时的默认值）。 */
function mostRecentRunning(sessionId: string): AgentTerminalRecord | undefined {
  return [...terminals().values()]
    .filter((record) => record.sessionId === sessionId && record.status === "running")
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
}

/** 释放一个记录：退订（顺带把 manager 的重连清理计时器重新武装）并从账上摘掉。 */
function release(record: AgentTerminalRecord): void {
  try {
    record.unsubscribe();
  } catch {
    // 已经不在 manager 的 registry 里了，无需处理。
  }
  terminals().delete(record.terminalId);
  emit({ type: "closed", terminalId: record.terminalId });
}

/**
 * 回收**已退出**且过了保留期的终端。
 *
 * 绝不回收仍在运行的终端：用户可能正盯着 `npm run dev` 的标签页；而进程退出时
 * `lib/terminal-manager.ts` 的 `process.once("exit")` 本来就会统一杀掉所有 PTY。
 * 运行中终端的内存上界由 {@link TERMINAL_MAX_TOTAL} × {@link TERMINAL_RETAINED_CHARS} 兜住
 * （8 × 256KB = 2MB，硬上限，不随运行时长增长）。
 */
export function reapExitedAgentTerminals(now = Date.now()): number {
  let released = 0;
  for (const record of [...terminals().values()]) {
    if (record.exitedAt !== null && now - record.exitedAt > TERMINAL_EXITED_RETENTION_MS) {
      release(record);
      released += 1;
    }
  }
  return released;
}

/** 开新终端前的容量检查：先回收过期的，再牺牲已退出的，最后才拒开。 */
function ensureCapacity(sessionId: string): void {
  for (let attempt = 0; attempt <= TERMINAL_MAX_TOTAL + 1; attempt += 1) {
    reapExitedAgentTerminals();
    const all = [...terminals().values()];
    const mine = all.filter((record) => record.sessionId === sessionId);
    if (mine.length < TERMINAL_MAX_PER_SESSION && all.length < TERMINAL_MAX_TOTAL) return;

    const scope = mine.length >= TERMINAL_MAX_PER_SESSION ? mine : all;
    const victim = scope
      .filter((record) => record.status === "exited")
      .sort((a, b) => (a.exitedAt ?? 0) - (b.exitedAt ?? 0))[0];
    if (!victim) {
      throw new Error(
        mine.length >= TERMINAL_MAX_PER_SESSION
          ? `本会话已开 ${TERMINAL_MAX_PER_SESSION} 个终端且都还在运行：请先 terminal_read 确认某个终端空闲、然后把它的 terminalId 传给 terminal_execute 复用，不要继续新开。`
          : `本进程已开 ${TERMINAL_MAX_TOTAL} 个 agent 终端且都还在运行：请 terminal_list 后复用其中一个，不要继续新开。`,
      );
    }
    release(victim);
  }
  throw new Error("终端容量检查未能收敛，请 terminal_list 看看当前状态");
}

/**
 * 记一次会话身份。会话 id 变了（fork 换文件、runtime 迟一步赋 id）就把账整体搬过去，
 * 否则会出现"自己刚开的终端突然不属于自己了"。
 */
export function claimAgentTerminalSession(previous: string | undefined, next: string): string {
  if (previous && previous !== next) {
    for (const record of terminals().values()) {
      if (record.sessionId === previous) record.sessionId = next;
    }
  }
  return next;
}

/** 为 agent 开一个新的可见终端（PTY 走既有 `lib/terminal-manager.ts`）。 */
export function openAgentTerminal(input: {
  sessionId: string;
  cwd: string;
  title: string;
}): AgentTerminalSummary {
  ensureCapacity(input.sessionId);

  const terminalId = newTerminalId();
  createTerminal(input.cwd, TERMINAL_DEFAULT_COLS, TERMINAL_DEFAULT_ROWS, terminalId);

  const now = Date.now();
  const record: AgentTerminalRecord = {
    terminalId,
    sessionId: input.sessionId,
    title: input.title,
    cwd: input.cwd,
    status: "running",
    exitCode: null,
    createdAt: now,
    lastUsedAt: now,
    exitedAt: null,
    buffer: emptyTerminalOutputBuffer(),
    busy: false,
    unsubscribe: () => {},
    notify: null,
  };

  // 先建账再订阅：`subscribeTerminal` 会撤掉 manager 的重连清理计时器（订阅即租约），
  // 账还没建好的窗口里一旦抛错就会漏掉一个 PTY。
  terminals().set(terminalId, record);
  try {
    const subscription = subscribeTerminal(terminalId, (event) => onManagerEvent(record, event));
    if (!subscription) throw new Error("终端刚创建就不可用（可能已被关闭）");
    record.unsubscribe = subscription.unsubscribe;
    if (subscription.exited) {
      record.status = "exited";
      record.exitCode = subscription.exitCode;
      record.exitedAt = Date.now();
    }
    // manager 的 backlog 是**给人看**的那份（128KB，只为 xterm 重连）；agent 这份从订阅
    // 瞬间重新计数，offset 对齐订阅后的流，不与浏览器那边的 `after` 游标纠缠。
    record.buffer = appendTerminalOutput(record.buffer, subscription.output.data, TERMINAL_RETAINED_CHARS);
  } catch (error) {
    terminals().delete(terminalId);
    killTerminal(terminalId);
    throw error;
  }

  const summary = summarize(record);
  emit({ type: "opened", terminal: summary });
  return summary;
}

function onManagerEvent(record: AgentTerminalRecord, event: { type: string; data?: string; exitCode?: number }): void {
  if (event.type === "output" && typeof event.data === "string") {
    record.buffer = appendTerminalOutput(record.buffer, event.data, TERMINAL_RETAINED_CHARS);
    emit({ type: "output", terminalId: record.terminalId });
    record.notify?.();
    return;
  }
  if (event.type === "exit") {
    record.status = "exited";
    record.exitCode = event.exitCode ?? null;
    record.exitedAt = Date.now();
    record.lastUsedAt = record.exitedAt;
    record.busy = false;
    emit({ type: "exit", terminalId: record.terminalId, exitCode: event.exitCode ?? 0 });
    record.notify?.();
    return;
  }
  if (event.type === "closed") {
    record.status = "exited";
    record.exitedAt = record.exitedAt ?? Date.now();
  }
}

export interface RunAgentTerminalCommandInput {
  sessionId: string;
  command: string;
  /** 省略时开一个新终端；给出时必须属于本会话且可复用。 */
  terminalId?: string | undefined;
  /** 仅在开新终端时使用。 */
  cwd?: string | undefined;
  title: string;
  /** 交互式 / 长驻命令跑完后把这个终端标成不可复用。 */
  keepBusy?: boolean;
  /** 用户点停止等中止信号：只中止等待，不动终端。 */
  signal?: AbortSignal | undefined;
  /** 模型给的等待上限（毫秒），非法值由 `resolveExecuteTimeoutMs` 夹回默认档。 */
  timeoutMs?: unknown;
}

export interface RunAgentTerminalCommandResult {
  terminal: AgentTerminalSummary;
  reused: boolean;
  waitStatus: TerminalWaitStatus;
  waitMs: number;
  timeoutMs: number;
  startOffset: number;
  read: TerminalOutputReadResult;
}

/**
 * 在终端里执行一条命令，等到「输出静止 / 终端退出 / 到达上限 / 被中止」之一就返回。
 *
 * **判定的是输出静止，不是命令结束。** 交互式 shell 没有可靠的提示符可依赖，而
 * 「命令结束」和「shell 正在重绘」在 PTY 字节流里长得一样。所以先等到**上过一次输出**，
 * 再按静默窗口收敛：一个字都没吐的命令（`sleep 30`）不会被误判成已完成，而是一直等到
 * 上限或终端退出。结果文本里也如实说明这一点（`formatTerminalExecute`）。
 */
export async function runAgentTerminalCommand(
  input: RunAgentTerminalCommandInput,
): Promise<RunAgentTerminalCommandResult> {
  const interrupt = input.command === TERMINAL_INTERRUPT;
  let record: AgentTerminalRecord;
  let reused = false;

  if (input.terminalId) {
    record = owned(input.sessionId, input.terminalId);
    if (record.status !== "running") throw new Error("终端已退出，不能复用；请开一个新的终端");
    // Ctrl+C 恰恰是给忙着的终端用的，所以只有非中断命令才受 busy 限制。
    if (record.busy && !interrupt) {
      throw new Error(
        "这个终端还不可复用（上一条命令的状态未知，或它是交互式/长驻命令）：先用 terminal_read 看它是否已经结束，或另开一个终端。",
      );
    }
    reused = true;
  } else {
    if (!input.cwd) throw new Error("没有可用的终端工作目录");
    const opened = openAgentTerminal({ sessionId: input.sessionId, cwd: input.cwd, title: input.title });
    record = owned(input.sessionId, opened.terminalId);
  }

  const startOffset = record.buffer.endOffset;
  record.lastUsedAt = Date.now();

  if (interrupt) {
    writeTerminal(record.terminalId, TERMINAL_INTERRUPT);
    record.busy = false;
    return {
      terminal: summarize(record),
      reused,
      waitStatus: "settled",
      waitMs: 0,
      timeoutMs: 0,
      startOffset,
      read: readAgentTerminalOutput(input.sessionId, record.terminalId, { offset: startOffset }).read,
    };
  }

  record.busy = true;
  const timeoutMs = resolveExecuteTimeoutMs(input.timeoutMs);
  const settled = await waitForSettle(record, {
    fromOffset: startOffset,
    timeoutMs,
    quietMs: resolveQuietMs(timeoutMs),
    signal: input.signal,
  });
  record.lastUsedAt = Date.now();
  // 「输出静止」不等于「命令结束」：交互式与长驻命令把终端标成不可复用，
  // 下一条命令必须另开终端（Proma：交互式、长驻或忙碌状态不明的终端不可复用）。
  record.busy = input.keepBusy === true && record.status !== "exited";

  return {
    terminal: summarize(record),
    reused,
    waitStatus: settled.status,
    waitMs: settled.waitMs,
    timeoutMs,
    startOffset,
    read: readAgentTerminalOutput(input.sessionId, record.terminalId, { offset: startOffset }).read,
  };
}

interface WaitOptions {
  fromOffset: number;
  timeoutMs: number;
  quietMs: number;
  signal?: AbortSignal | undefined;
}

/** 输出静止判定：输出到达 / 终端退出 / 到达上限 / 被中止，谁先到算谁。 */
function waitForSettle(
  record: AgentTerminalRecord,
  options: WaitOptions,
): Promise<{ status: TerminalWaitStatus; waitMs: number }> {
  const startedAt = Date.now();

  return new Promise((resolvePromise) => {
    let settled = false;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (status: TerminalWaitStatus): void => {
      if (settled) return;
      settled = true;
      record.notify = null;
      if (quietTimer) clearTimeout(quietTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      options.signal?.removeEventListener("abort", onAbort);
      resolvePromise({ status, waitMs: Date.now() - startedAt });
    };

    /** 每来一批输出就重新计时；静默满一个窗口才算这一轮收敛。 */
    const armQuietTimer = (): void => {
      if (settled) return;
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        finish(record.status === "exited" ? "exited" : "settled");
      }, options.quietMs);
    };

    function onAbort(): void {
      finish("aborted");
    }

    record.notify = armQuietTimer;
    deadlineTimer = setTimeout(() => finish("timeout"), options.timeoutMs);
    deadlineTimer.unref?.();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      finish("aborted");
      return;
    }
    // 订阅瞬间就拿到了 shell 提示符/上一条命令的尾巴时，静默计时立刻开始。
    if (record.buffer.endOffset > options.fromOffset) armQuietTimer();
  });
}

/** 读一段输出。省略 `terminalId` 时取本会话最近用过、仍在运行的终端。 */
export function readAgentTerminalOutput(
  sessionId: string,
  terminalId: string | undefined,
  options: TerminalOutputReadOptions = {},
): { terminal: AgentTerminalSummary; read: TerminalOutputReadResult } {
  const id = terminalId?.trim() || mostRecentRunning(sessionId)?.terminalId;
  if (!id) throw new Error("请先 terminal_list 看本会话的终端，或先开一个终端");
  const record = owned(sessionId, id);
  record.lastUsedAt = Date.now();
  return { terminal: summarize(record), read: readTerminalOutput(record.buffer, options) };
}

/** 列出本会话的 agent 终端。默认含已退出的（模型需要知道哪个已经死了、不能再复用）。 */
export function listAgentTerminals(
  sessionId: string,
  options: { includeExited?: boolean } = {},
): AgentTerminalSummary[] {
  const includeExited = options.includeExited !== false;
  return [...terminals().values()]
    .filter((record) => record.sessionId === sessionId && (includeExited || record.status === "running"))
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .map(summarize);
}

/**
 * 关掉一个会话的全部 agent 终端（连 PTY 一起杀）。
 *
 * 集成位：会话被删除时调用。会话只是被空闲回收的话**不要**调用 —— 用户可能正看着那个
 * `npm run dev` 标签页，让它继续跑更符合直觉。
 */
export function disposeAgentTerminalsForSession(sessionId: string): number {
  let count = 0;
  for (const record of [...terminals().values()]) {
    if (record.sessionId !== sessionId) continue;
    killTerminal(record.terminalId);
    terminals().delete(record.terminalId);
    emit({ type: "closed", terminalId: record.terminalId });
    count += 1;
  }
  return count;
}
