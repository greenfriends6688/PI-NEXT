"use client";

/**
 * fork:upstream-0.12-session-state —— 侧栏状态的客户端 store（PR-3b）。
 *
 * 服务端那份（`lib/session-ui-state.ts` + `/api/sessions/ui-state`）是权威：
 * 置顶 / 归档 / 项目顺序 / 项目名都活在这里，换浏览器、换设备都跟着走。
 *
 * 本地状态 = 最近一次服务端状态 + 队列里每条写操作重放，所以一个 GET 或一次写响应
 * 在别的写还排着队时落地，不会把它们的乐观效果冲掉。写操作按调用顺序串行
 * （归档→撤销在服务端也保持顺序）。
 *
 * 四个同步模块（session-flags / project-flags / project-prefs / session-groups）
 * 从这里的快照**派生**，接口不变 —— 侧栏与面板不用改。
 */

import {
  applySessionUiStateRequest,
  emptySessionUiState,
  normalizeSessionUiState,
  snapshotSessionUiFlags,
  type SessionUiFlagsSnapshot,
  type SessionUiState,
  type SessionUiStateRequest,
} from "./session-ui-state-shared";

const SESSION_UI_STATE_URL = "/api/sessions/ui-state";

interface PendingWrite {
  request: SessionUiStateRequest;
  /** 用户动作发生的时刻，重放时保持同一个 pinnedAt/archivedAt。 */
  now: number;
}

const listeners = new Set<() => void>();
let serverState: SessionUiState = emptySessionUiState();
let localState: SessionUiState = serverState;
let pending: PendingWrite[] = [];
let writeChain: Promise<unknown> = Promise.resolve();
let loadId = 0;
let loaded = false;
let synced = false;
let lastError: string | null = null;
let refreshInFlight: number | null = null;
let hydrationStarted = false;
const waiters = new Set<(api: SessionUiStateApi) => void>();

export interface SessionUiStateApi {
  state: SessionUiState;
  loaded: boolean;
  synced: boolean;
  error: string | null;
}

function snapshot(): SessionUiStateApi {
  return { state: localState, loaded, synced, error: lastError };
}

function publish(): void {
  let next = serverState;
  for (const { request, now } of pending) {
    next = applySessionUiStateRequest(next, request, now).state;
  }
  localState = next;
  const api = snapshot();
  listeners.forEach((cb) => cb());
  waiters.forEach((cb) => cb(api));
}

export function subscribeSessionUiState(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getSessionUiStateSnapshot(): SessionUiStateApi {
  return snapshot();
}

export function getSessionUiStateServerSnapshot(): SessionUiStateApi {
  return snapshot();
}

export function getSessionUiState(): SessionUiState {
  return localState;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readState(response: Response): Promise<SessionUiState> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data: unknown = await response.json();
  const state = data && typeof data === "object" ? normalizeSessionUiState((data as { state?: unknown }).state) : null;
  if (!state) throw new Error("Invalid session UI state response");
  return state;
}

async function load(keepError: boolean): Promise<void> {
  const id = ++loadId;
  refreshInFlight = id;
  try {
    const response = await fetch(SESSION_UI_STATE_URL, { cache: "no-store" });
    const next = await readState(response);
    if (id !== loadId) return;
    serverState = next;
    if (!keepError) lastError = null;
    loaded = true;
    synced = true;
    publish();
  } catch (error) {
    if (id !== loadId) return;
    lastError = errorMessage(error);
    loaded = true;
    publish();
  } finally {
    if (refreshInFlight === id) refreshInFlight = null;
  }
}

export function refreshSessionUiState(): Promise<void> {
  return load(false);
}

/** 首次取状态：由第一个订阅者触发（模块加载时不打网络）。 */
export function ensureSessionUiState(): void {
  if (hydrationStarted) return;
  hydrationStarted = true;
  void refreshSessionUiState();
}

/** 等第一次 GET 落定（成功或失败），返回之后的快照。 */
export function whenSessionUiStateSettled(): Promise<SessionUiStateApi> {
  ensureSessionUiState();
  if (loaded) return Promise.resolve(snapshot());
  return new Promise((resolve) => {
    const cb = () => {
      if (!loaded) return;
      waiters.delete(cb);
      resolve(snapshot());
    };
    waiters.add(cb);
  });
}

/** 乐观应用并 POST；返回服务端是否接受。 */
export function applySessionUiState(request: SessionUiStateRequest): Promise<boolean> {
  const entry: PendingWrite = { request, now: Date.now() };
  pending = [...pending, entry];
  publish();

  const run = async (): Promise<boolean> => {
    let ok = false;
    try {
      const response = await fetch(SESSION_UI_STATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        cache: "no-store",
      });
      const next = await readState(response);
      // 这次写响应之前开始的任何 GET 都可能早于这次写。
      loadId++;
      serverState = next;
      lastError = null;
      loaded = true;
      synced = true;
      ok = true;
    } catch (error) {
      lastError = errorMessage(error);
    }
    pending = pending.filter((item) => item !== entry);
    publish();
    // 回滚到服务端实际持有的（这次请求可能落了，也可能没落）。
    if (!ok) await load(true);
    return ok;
  };

  const result = writeChain.then(run, run);
  writeChain = result;
  return result;
}

/** 撤销用的当前标记快照。 */
export function snapshotSessionFlagsOf(ids: readonly string[]): SessionUiFlagsSnapshot[] {
  return snapshotSessionUiFlags(localState, ids);
}
