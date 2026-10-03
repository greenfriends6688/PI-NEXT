/**
 * fork:proma-44-planning —— 草稿式自动保存的 React 外壳。
 *
 * 判定全在 `planning-draft-save.ts`（纯状态机，有单测），这里只做三件事：
 * 持有两个定时器、把事件派发进状态机、把 `draft` 交给受控输入框。
 *
 * **这个 hook 唯一能写输入框的地方是 `edit()`。** 自动保存的回包被**刻意忽略** ——
 * 服务端会归一化（空串清描述、时间戳取整），拿它 setState 就是 Proma 那个
 * 「边打字边被光标抢走」的坑。状态机层面 `draftSaveSettled()` 同样不写 `draft`，
 * 两层都不写，所以这条规则不靠自觉。
 *
 * 定时器全部在清理里取消。「关面板时 flush」由**父组件**在 × / Esc / 点空白三个
 * 入口共用的 `closeDetail()` 里调 `flushNow()`（与 Proma 的
 * `onClose={() => { save(); setSelectedId(null) }}` 同一处），组件整体卸载时另有
 * 一道兜底。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DRAFT_SAVE_DEBOUNCE_MS,
  DRAFT_SAVE_STATUS_MS,
  draftEdited,
  draftFlush,
  draftOpened,
  draftSaveSettled,
  draftSaveStarted,
  draftStatusExpired,
  initialDraftSaveState,
  isDraftSaveDue,
  visibleDraftStatus,
  type DraftSaveState,
  type DraftSaveStatus,
} from "./planning-draft-save";

export interface DraftAutosaveOptions {
  /** 当前编辑的实体 id；null = 面板没开。 */
  entityId: string | null;
  /** 服务端已确认的值，面板打开 / 切换实体时同步进来。 */
  persisted: string;
  /** 发送保存。resolve 的字符串是**服务端存下的值**；reject = 保存失败。 */
  save: (value: string) => Promise<string>;
  /** 保存被版本冲突（409）拒绝：自动保存停手，等用户重新加载。 */
  onConflict?: () => void;
  onError?: (error: unknown) => void;
}

export interface DraftAutosave {
  draft: string;
  status: DraftSaveStatus;
  /** 输入框 onChange。 */
  edit: (value: string) => void;
  /** 失焦即存（不等去抖）。 */
  flush: () => void;
  /** 关面板前调：把没存的标题 / 描述真的发出去。 */
  flushNow: () => void;
}

export function useDraftAutosave(options: DraftAutosaveOptions): DraftAutosave {
  const { entityId, persisted, save, onConflict, onError } = options;
  const [state, setState] = useState<DraftSaveState>(() => initialDraftSaveState());

  // 定时器句柄与最新回调都放 ref：放 state 会在 effect 里读到旧值，
  // 而把 save 塞进定时器闭包会每次渲染重建定时器 —— 那等于打字时根本没有去抖。
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const saveRef = useRef(save);
  saveRef.current = save;
  const conflictRef = useRef(onConflict);
  conflictRef.current = onConflict;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const apply = useCallback((next: DraftSaveState) => {
    setState(next);
    stateRef.current = next;
  }, []);

  const runSaveRef = useRef<() => void>(() => {});

  const runSave = useCallback(() => {
    const before = stateRef.current;
    const started = draftSaveStarted(before, Date.now());
    if (!started) return;
    apply(started);
    const value = started.sent ?? "";
    void saveRef.current(value).then(
      (stored) => {
        apply(draftSaveSettled(stateRef.current, { ok: true, persisted: stored, now: Date.now() }));
      },
      (error: unknown) => {
        // 409 单独一路：它不是「再试一次」，是「你看到的是旧版本」。
        const conflict = (error as { status?: number } | null)?.status === 409;
        apply(draftSaveSettled(stateRef.current, {
          ok: false,
          persisted: before.persisted,
          now: Date.now(),
          blocked: conflict,
        }));
        if (conflict) conflictRef.current?.();
        else errorRef.current?.(error);
      },
    );
  }, [apply]);

  // 渲染期赋值（不是 effect）：flush 在别的事件回调里被调用时拿到的必须是当前这一版。
  runSaveRef.current = runSave;

  // —— 打开 / 切换实体：丢掉上一条的定时器与状态提示 ——
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      if (entityId === null) return;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    apply(draftOpened(stateRef.current, entityId, entityId === null ? "" : persisted));
  }, [apply, entityId]); // eslint-disable-line react-hooks/exhaustive-deps -- persisted 由 entityId 变化时同步进来

  // —— 去抖到期 ——
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (state.dueAt === null) return;
    const delay = Math.max(0, state.dueAt - Date.now());
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (!isDraftSaveDue(stateRef.current, Date.now())) return;
      runSaveRef.current();
    }, delay);
  }, [state.dueAt, state.inFlight, state.draft, state.persisted, state.blocked]);

  // —— 「✓ 已保存」2 秒后自动消失 ——
  useEffect(() => {
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    if (state.status !== "saved" || state.statusSince === null) return;
    statusTimerRef.current = setTimeout(() => {
      statusTimerRef.current = null;
      apply(draftStatusExpired(stateRef.current, Date.now()));
    }, DRAFT_SAVE_STATUS_MS);
  }, [apply, state.status, state.statusSince]);

  const edit = useCallback((value: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    apply(draftEdited(stateRef.current, value, Date.now()));
  }, [apply]);

  /** 失焦：立刻存，不等去抖。 */
  const flush = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    apply(draftFlush(stateRef.current).state);
    runSaveRef.current();
  }, [apply]);

  // —— 整体卸载的兜底：工作区被关掉时别把草稿丢掉 ——
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    runSaveRef.current();
  }, []);

  return { draft: state.draft, status: visibleDraftStatus(state, entityId), edit, flush, flushNow: flush };
}

export { DRAFT_SAVE_DEBOUNCE_MS, DRAFT_SAVE_STATUS_MS };
