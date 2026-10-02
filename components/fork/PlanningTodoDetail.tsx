"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useDraftAutosave } from "@/lib/planning-draft-autosave";
import { draftStatusMessageKey } from "@/lib/planning-draft-save";
import { endOfLocalDay } from "@/lib/planning-calendar";
import type { PlanningGroup, PlanningTag, PlanningTodo } from "@/lib/planning-types";
import type { PlanningTodoView } from "@/lib/planning-view";
import type { PlanningApiError, PlanningEntity, PlanningOp } from "@/lib/planning-client";

/*
 * fork:proma-44-planning —— Todo 详情面板。
 *
 * Proma v0.16.8 那个坑的落点：标题与描述都走**草稿式自动保存**（停手 800ms 存 /
 * 失焦即存 / 关面板 flush），「保存中… / ✓ 已保存」2 秒后消失，且**自动保存不回写
 * 输入框**（判定在 `lib/planning-draft-save.ts`，那里 `draftSaveSettled()` 根本不
 * 碰 `draft`；这里也从不拿保存回包去 setState）。
 *
 * 两条字段是**两个独立的 autosave 实例**：去抖 / 在途 / 冲突各算各的，共享一个
 * 状态机会让「描述在途」把标题的保存一起卡住。
 *
 * 面板的关闭只有**一个**出口：父组件的 `onClose`。× / Esc / 点空白三种手势都在
 * 父组件里汇成「先 `onFlush()`，再把 selectedId 置 null」。本组件不自己监听 Esc
 * 或 click-outside —— 那样会有两份关闭逻辑，漏掉一份就意味着「× 能存、Esc 不能」。
 * `onFlush` 由父组件通过 ref 拿到（`registerFlush`），组件卸载时也会兜底冲一次。
 */

export interface PlanningWorkspaceOption {
  cwd: string;
  name: string;
}

interface Props {
  todo: PlanningTodoView;
  groups: PlanningGroup[];
  tags: PlanningTag[];
  workspaces: PlanningWorkspaceOption[];
  activeCwd: string | null;
  onClose: () => void;
  onOp: (op: PlanningOp) => Promise<PlanningEntity | undefined>;
  onStartAgent: (todo: PlanningTodoView) => void;
  startingAgent: boolean;
  /** 父组件保存关闭前的 flush 入口。 */
  registerFlush: (flush: () => void) => void;
}

function toDateTimeLocal(value: number | undefined): string {
  if (value === undefined) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocal(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isConflict(error: unknown): boolean {
  return (error as PlanningApiError | null)?.conflict === true;
}

/** 取回包里服务端存下的那一份文本。它**只**交给状态机，不会被 setState 回输入框。 */
function entityText(entity: PlanningEntity | undefined, field: "title" | "notes"): string {
  if (!entity || !("title" in entity)) return "";
  const value = (entity as { title?: string; notes?: string })[field];
  return typeof value === "string" ? value : "";
}

export function PlanningTodoDetail({
  todo,
  groups,
  tags,
  workspaces,
  activeCwd,
  onClose,
  onOp,
  onStartAgent,
  startingAgent,
  registerFlush,
}: Props) {
  const { t } = useI18n();
  const [notice, setNotice] = useState<"error" | "conflict" | null>(null);

  const onSaveError = useCallback((error: unknown) => {
    setNotice(isConflict(error) ? "conflict" : "error");
  }, []);
  const onConflict = useCallback(() => setNotice("conflict"), []);
  // 两个 hook 的回调用 ref 转一手：把它们直接写进 `save` 会让 autosave 每次渲染
  // 换一次回调，进而重建去抖定时器 —— 那等于打字时根本没有去抖。
  const errorRef = useRef({ onSaveError, onConflict });
  errorRef.current = { onSaveError, onConflict };

  // 两条字段的保存**串成一条链**，且**都不带 `expectedUpdatedAt`**。两个原因：
  //
  // 1. 自冲突。标题与描述是两个独立的 autosave 实例，它们在同一次渲染里拿到的
  //    `todo.updatedAt` 是同一个值 —— 谁先落盘谁就把版本推前，后到的那一发必然 409，
  //    于是「在标题里打字的同时在描述里打字」会把自动保存打成「版本冲突、停手」。
  // 2. 语义。`expectedUpdatedAt` 守的是「另一个视图正在改这条 Todo」，而草稿保存
  //    只写**一个字段**，同字段后写覆盖是文本编辑器的正常语义。结构性改动
  //    （优先级 / 时间 / 分组 / 标签 / 完成 / 删除）仍然带版本号。
  //
  // 串行化顺带保证「回包顺序 = 落盘顺序」，不会先到的旧快照把后写的字段短暂回退掉。
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const onOpRef = useRef(onOp);
  onOpRef.current = onOp;
  const todoIdRef = useRef(todo.id);
  todoIdRef.current = todo.id;

  const saveTitle = useCallback((value: string) => {
    const run = async () => entityText(
      await onOpRef.current({ op: "todo.update", id: todoIdRef.current, title: value }),
      "title",
    );
    const next = chainRef.current.then(run, run);
    chainRef.current = next.catch(() => undefined);
    return next;
  }, []);

  const saveNotes = useCallback((value: string) => {
    const run = async () => entityText(
      await onOpRef.current({ op: "todo.update", id: todoIdRef.current, notes: value }),
      "notes",
    );
    const next = chainRef.current.then(run, run);
    chainRef.current = next.catch(() => undefined);
    return next;
  }, []);

  const title = useDraftAutosave({
    entityId: todo.id,
    persisted: todo.title,
    save: saveTitle,
    onError: (error) => errorRef.current.onSaveError(error),
    onConflict: () => errorRef.current.onConflict(),
  });
  const notes = useDraftAutosave({
    entityId: todo.id,
    persisted: todo.notes ?? "",
    save: saveNotes,
    onError: (error) => errorRef.current.onSaveError(error),
    onConflict: () => errorRef.current.onConflict(),
  });

  // 父组件的关闭路径与本组件的卸载路径共用这一个 flush。
  // flush 句柄走 ref：`title` / `notes` 是每次渲染都换的新对象，把它们放进依赖
  // 数组会让「注册给父组件」与「卸载兜底」两个 effect 每次渲染都重跑一遍。
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => { title.flush(); notes.flush(); };
  const flush = useCallback(() => { flushRef.current(); }, []);
  useEffect(() => { registerFlush(flush); }, [registerFlush, flush]);
  useEffect(() => () => { flushRef.current(); }, []);

  useEffect(() => { setNotice(null); }, [todo.id]);

  // 标题与描述任一处在途就显示状态；两条都静下来后由状态机收掉（2 秒）。
  const status = useMemo(
    () => draftStatusMessageKey(notes.status) ?? draftStatusMessageKey(title.status) ?? "idle",
    [notes.status, title.status],
  );

  // 结构性 op 失败时 `onOp` 已经把错误写进顶栏；这里再吞一次只是为了不让
  // 事件处理器里的 `void onOp(...)` 变成 unhandled rejection。
  const fire = (op: PlanningOp) => { void onOp(op).catch(() => { /* 已在顶栏呈现 */ }); };

  const scopedGroups = groups.filter((group) => group.scope === "todo");
  const workspace = todo.workspaceCwd ?? activeCwd ?? workspaces[0]?.cwd ?? "";

  return (
    <aside className="pw-panel fork-plan-detail" aria-label={t("planning.detail.title")}>
      <header className="fork-plan-detail-head">
        <h2 className="fork-plan-detail-name">{t("planning.detail.title")}</h2>
        <span className="grow" />
        <button
          type="button"
          className="pw-iconbtn"
          onClick={onClose}
          title={t("planning.close")}
          aria-label={t("planning.close")}
        >
          <span className="pw-ico"><i data-ico="x" data-size="14"></i></span>
        </button>
      </header>

      <div className="fork-plan-detail-body">
        <div className="fork-plan-field">
          <label className="fork-plan-label" htmlFor="planning-todo-title">{t("planning.detail.titleField")}</label>
          <input
            id="planning-todo-title"
            className="pw-input"
            value={title.draft}
            placeholder={t("planning.detail.titlePlaceholder")}
            onChange={(event) => title.edit(event.target.value)}
            onBlur={title.flush}
          />
        </div>

        <div className="fork-plan-field">
          <div className="fork-plan-label-row">
            <label className="fork-plan-label" htmlFor="planning-todo-notes">{t("planning.detail.notes")}</label>
            <span
              className={`fork-plan-save-status${status === "idle" ? "" : " is-visible"}`}
              data-status={status}
              aria-live="polite"
            >
              {status === "saving" ? t("planning.saving") : status === "saved" ? t("planning.saved") : ""}
            </span>
          </div>
          <textarea
            id="planning-todo-notes"
            className="pw-textarea fork-plan-notes"
            value={notes.draft}
            placeholder={t("planning.detail.notesPlaceholder")}
            rows={8}
            onChange={(event) => notes.edit(event.target.value)}
            onBlur={notes.flush}
          />
          {notice === "conflict" && <p className="fork-plan-notice is-conflict">{t("planning.conflict")}</p>}
          {notice === "error" && <p className="fork-plan-notice is-error">{t("planning.saveFailed")}</p>}
        </div>

        <div className="fork-plan-field">
          <span className="fork-plan-label">{t("planning.detail.organization")}</span>
          <div className="fork-plan-rows">
            <label className="fork-plan-row">
              <span className="fork-plan-label">{t("planning.detail.priority")}</span>
              <select
                className="fork-plan-select"
                value={todo.priority}
                onChange={(event) => fire({
                  op: "todo.update",
                  id: todo.id,
                  priority: event.target.value as PlanningTodo["priority"],
                  expectedUpdatedAt: todo.updatedAt,
                })}
              >
                <option value="high">{t("planning.priority.high")}</option>
                <option value="medium">{t("planning.priority.medium")}</option>
                <option value="low">{t("planning.priority.low")}</option>
              </select>
            </label>

            <label className="fork-plan-row">
              <span className="fork-plan-label">{t("planning.detail.dueAt")}</span>
              <input
                type="datetime-local"
                className="pw-input"
                value={toDateTimeLocal(todo.dueAt)}
                onChange={(event) => fire({
                  op: "todo.update",
                  id: todo.id,
                  dueAt: fromDateTimeLocal(event.target.value),
                  expectedUpdatedAt: todo.updatedAt,
                })}
              />
            </label>

            <div className="fork-plan-row">
              <span className="fork-plan-label">{t("planning.detail.quickDue")}</span>
              <button
                type="button"
                className="pw-btn sm outline"
                onClick={() => fire({
                  op: "todo.update", id: todo.id, dueAt: endOfLocalDay(Date.now()), expectedUpdatedAt: todo.updatedAt,
                })}
              >
                {t("planning.detail.endOfToday")}
              </button>
              {todo.dueAt !== undefined && (
                <button
                  type="button"
                  className="pw-btn sm outline"
                  onClick={() => fire({
                    op: "todo.update", id: todo.id, dueAt: null, expectedUpdatedAt: todo.updatedAt,
                  })}
                >
                  {t("planning.detail.clearDue")}
                </button>
              )}
            </div>

            <label className="fork-plan-row">
              <span className="fork-plan-label">{t("planning.detail.group")}</span>
              <select
                className="fork-plan-select"
                value={todo.groupId ?? ""}
                onChange={(event) => fire({
                  op: "todo.update", id: todo.id, groupId: event.target.value || null, expectedUpdatedAt: todo.updatedAt,
                })}
              >
                <option value="">{t("planning.detail.noGroup")}</option>
                {scopedGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>

            <div className="fork-plan-row">
              <span className="fork-plan-label">{t("planning.detail.tags")}</span>
              <div className="fork-plan-chips">
                {tags.length === 0 && <span className="pw-muted">{t("planning.detail.noTags")}</span>}
                {tags.map((tag) => {
                  const on = todo.tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className={`pw-chip${on ? " is-on" : ""}`}
                      aria-pressed={on}
                      onClick={() => fire({
                        op: "todo.update",
                        id: todo.id,
                        tagIds: on ? todo.tagIds.filter((id) => id !== tag.id) : [...todo.tagIds, tag.id],
                        expectedUpdatedAt: todo.updatedAt,
                      })}
                    >
                      #{tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="fork-plan-field">
          <span className="fork-plan-label">{t("planning.detail.agent")}</span>
          <div className="fork-plan-rows">
            <label className="fork-plan-row">
              <span className="fork-plan-label">{t("planning.detail.workspace")}</span>
              <select
                className="fork-plan-select"
                value={workspace}
                onChange={(event) => fire({
                  op: "todo.update", id: todo.id, workspaceCwd: event.target.value, expectedUpdatedAt: todo.updatedAt,
                })}
              >
                {workspaces.map((item) => <option key={item.cwd} value={item.cwd}>{item.name}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="pw-btn primary"
              disabled={startingAgent || !workspace}
              onClick={() => onStartAgent(todo)}
            >
              <span className="pw-ico"><i data-ico="bot" data-size="14"></i></span>
              {startingAgent ? t("planning.agent.starting") : t("planning.agent.start")}
            </button>
            {todo.sessionLinks.length > 0 && (
              <ul className="fork-plan-links">
                {todo.sessionLinks.map((link) => <li key={link.sessionId}>{link.sessionId}</li>)}
              </ul>
            )}
          </div>
        </div>
      </div>

      <footer className="fork-plan-detail-foot">
        <button
          type="button"
          className="pw-btn"
          onClick={() => fire({
            op: "todo.update",
            id: todo.id,
            status: todo.status === "completed" ? "open" : "completed",
            expectedUpdatedAt: todo.updatedAt,
          })}
        >
          <span className="pw-ico">
            <i data-ico={todo.status === "completed" ? "rotate-ccw" : "check"} data-size="14"></i>
          </span>
          {todo.status === "completed" ? t("planning.reopen") : t("planning.markDone")}
        </button>
        <span className="grow" />
        <button type="button" className="pw-btn danger" onClick={() => fire({ op: "todo.delete", id: todo.id })}>
          <span className="pw-ico"><i data-ico="trash-2" data-size="14"></i></span>
          {t("planning.delete")}
        </button>
      </footer>
    </aside>
  );
}
