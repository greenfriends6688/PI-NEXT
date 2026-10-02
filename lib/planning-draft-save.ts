/**
 * fork:proma-44-planning —— 描述草稿式自动保存的**状态机**（纯函数，Proma v0.16.8 那个坑）。
 *
 * Proma 在 v0.16.8 专门修过一次「Todo 描述草稿式自动保存」：描述停手 800ms 存、
 * 失焦即存、关详情面板（× / Esc / 点空白）时 flush 未保存的标题与描述，
 * 「保存中… / ✓ 已保存」2 秒后自动消失，**且自动保存不回写输入框、不打断输入**。
 * 最后半句是重点：Proma 的做法是保存成功后如果服务端回了个 trim 过的值就
 * `setDetailNotes(notes)`，于是一边打字一边光标被往回拽 —— 「保存」把正在写的话
 * 改掉了。这里把那次回写**从状态机里删掉**：`draftSaveSettled()` 永远不碰 `draft`，
 * 不是「记得别调」，是结构上做不到（见下方不变量 1）。
 *
 * 状态形状：
 *
 *   draft     输入框此刻的值，**只**由用户输入改变
 *   persisted 服务端已确认落盘的值
 *   dueAt     去抖定时器的到期时刻（epoch ms），null = 没有待触发的一次
 *   inFlight  一次保存请求在途
 *   sent      在途请求携带的那份值（判定「请求期间用户又打了字」用）
 *   blocked   版本冲突后停手，等用户重新加载
 *   status    面板上的状态提示
 *
 * 全部函数都接收注入的 `now`，所以单测不需要真的等 800ms —— 改 `now` 就行。
 */

export type DraftSaveStatus = "idle" | "saving" | "saved";

/** 停手多久算「停顿」。Proma v0.16.8 的口径，不改。 */
export const DRAFT_SAVE_DEBOUNCE_MS = 800;
/** 「✓ 已保存」停留多久。 */
export const DRAFT_SAVE_STATUS_MS = 2000;

export interface DraftSaveState {
  /** 当前详情面板里的实体 id；null = 没打开任何实体。 */
  entityId: string | null;
  draft: string;
  persisted: string;
  dueAt: number | null;
  inFlight: boolean;
  sent: string | null;
  blocked: boolean;
  status: DraftSaveStatus;
  statusSince: number | null;
}

export function initialDraftSaveState(): DraftSaveState {
  return {
    entityId: null,
    draft: "",
    persisted: "",
    dueAt: null,
    inFlight: false,
    sent: null,
    blocked: false,
    status: "idle",
    statusSince: null,
  };
}

/**
 * 切到另一个实体（或关闭面板 → entityId 传 null）：丢掉上一条的定时器与状态提示。
 *
 * 例外是「又点开同一条」且**正在途**：这时保留原状态，用户回到面板看到的是刚才
 * 那一格正在保存的草稿，而不是被服务端回包把未保存的内容盖掉。
 */
export function draftOpened(state: DraftSaveState, entityId: string | null, persisted: string): DraftSaveState {
  if (state.entityId === entityId && state.inFlight) return state;
  return {
    entityId,
    draft: persisted,
    persisted,
    dueAt: null,
    inFlight: false,
    sent: null,
    blocked: false,
    status: "idle",
    statusSince: null,
  };
}

/** 用户敲了一个字。**唯一**能改 `draft` 的入口。 */
export function draftEdited(state: DraftSaveState, next: string, now: number): DraftSaveState {
  if (next === state.draft) return state;
  const changed = { draft: next, dueAt: null as number | null };
  // 在途请求期间的输入不排新定时器：那时候排了也会被 `draftSaveStarted` 拒掉，
  // 而「请求回来后发现还有更新的草稿」由 `draftSaveSettled` 续一次（用 0 延迟）。
  if (state.inFlight || state.blocked) return { ...state, ...changed };
  if (next === state.persisted) return { ...state, ...changed, dueAt: null };
  return { ...state, ...changed, dueAt: now + DRAFT_SAVE_DEBOUNCE_MS };
}

/** 有没有非空改动。空改动不触发请求（否则每次失焦都打一发 no-op）。 */
export function isDraftDirty(state: DraftSaveState): boolean {
  return state.entityId !== null && !state.inFlight && !state.blocked && state.draft !== state.persisted;
}

/** 去抖到期了吗。到期由调用方的定时器唤醒，这里只判定。 */
export function isDraftSaveDue(state: DraftSaveState, now: number): boolean {
  return state.dueAt !== null && now >= state.dueAt && isDraftDirty(state);
}

/**
 * 立刻要保存（失焦 / 关闭面板的 flush）时先把状态推到 `saving`。
 * 返回 null 表示**不该发**：没脏、正在途、或已冲突。
 */
export function draftSaveStarted(state: DraftSaveState, now: number): DraftSaveState | null {
  if (!isDraftDirty(state)) return null;
  return {
    ...state,
    inFlight: true,
    sent: state.draft,
    dueAt: null,
    status: "saving",
    statusSince: now,
  };
}

/** 取消去抖（关面板时用），返回「关之前还有没有没存的东西」。 */
export function draftFlush(state: DraftSaveState): { state: DraftSaveState; dirty: boolean } {
  const dirty = isDraftDirty(state);
  return { state: { ...state, dueAt: null }, dirty };
}

/**
 * 保存请求回来。
 *
 * 不变量 1：**本函数永远不写 `draft`**。返回的对象里 `draft` 与入参逐字相同 ——
 * 这就是「自动保存不回写输入框」的实现方式（而不是靠调用方自觉）。
 *
 * 不变量 2：**不会自旋**。续存只在「用户在请求期间又打了字」（`draft !== sent`）时
 * 发生，且立刻续（`dueAt = now`）。如果按 `draft !== persisted` 判断，服务端任何
 * 一次归一化（trim、换行折叠）都会让两者永远不等，于是每 0ms 重发一次 —— 无限循环。
 *
 * 不变量 3：失败不自动重试。`dueAt` 清空、状态回 `idle`，留给下一次输入或关面板
 * 的 flush 再试；后台默默重试只会把同一个错误重复三遍。
 */
export function draftSaveSettled(
  state: DraftSaveState,
  outcome: { ok: boolean; persisted: string; now: number; blocked?: boolean },
): DraftSaveState {
  const base: DraftSaveState = {
    ...state,
    inFlight: false,
    sent: null,
    blocked: outcome.blocked === true,
  };
  if (!outcome.ok) {
    return { ...base, dueAt: null, status: "idle", statusSince: null };
  }
  const typedDuringRequest = state.sent !== null && state.draft !== state.sent;
  if (typedDuringRequest) {
    // 有更新的草稿在途：立刻续一次（0 延迟），但**不动 draft**。
    return { ...base, persisted: outcome.persisted, dueAt: outcome.now, status: "saving", statusSince: outcome.now };
  }
  return { ...base, persisted: outcome.persisted, dueAt: null, status: "saved", statusSince: outcome.now };
}

/** 2 秒后把「✓ 已保存」收掉。 */
export function draftStatusExpired(state: DraftSaveState, now: number): DraftSaveState {
  if (state.status !== "saved" || state.statusSince === null) return state;
  if (now - state.statusSince < DRAFT_SAVE_STATUS_MS) return state;
  return { ...state, status: "idle", statusSince: null };
}

/**
 * 面板上真正显示的状态。切走实体后上一条的「已保存」必须立刻消失，
 * 否则会在另一条 Todo 的描述旁边挂着上一条的提示（Proma 的
 * `getVisibleTodoNotesSaveState` 修的就是这个）。
 */
export function visibleDraftStatus(state: DraftSaveState, selectedId: string | null): DraftSaveStatus {
  if (!selectedId || state.entityId !== selectedId) return "idle";
  return state.status;
}

/** 状态提示的文案键。返回 null 表示不显示。 */
export function draftStatusMessageKey(status: DraftSaveStatus): "saving" | "saved" | null {
  if (status === "saving") return "saving";
  if (status === "saved") return "saved";
  return null;
}
