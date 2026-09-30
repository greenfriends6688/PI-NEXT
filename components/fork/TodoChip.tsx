"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import type { TodoSummary } from "@/lib/todo-state";

/*
 * fork:ui-todo — the session's task list, next to the composer.
 *
 * The list itself is produced by the built-in `todo` tool (lib/todo-extension.ts)
 * and read back from the transcript (lib/todo-state.ts `extractTodoState`), so this
 * component owns nothing but presentation: a chip with progress, and a read-only
 * panel. Read-only on purpose — flipping a checkbox here would have to rewrite an
 * already-recorded tool result, which is exactly the history the session format
 * forbids rewriting; the copy action exists so the user can hand the list back to
 * the model instead.
 *
 * fork:ui-todo-live — the panel is fed by the message list, which grows while the
 * turn streams, so it already tracked the run; what it did not do was *show* that
 * it was tracking anything. A flat list of identical rows that all turned grey at
 * once read as a summary written after the fact. The panel therefore names the
 * open item ("进行中"), carries a progress bar, and the chip title names that item
 * too, so a mid-run glance says what the agent is doing right now.
 */

export function TodoChip({ summary }: { summary: TodoSummary }): ReactNode {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Nothing to show before the tool has ever run: an empty chip would be noise on
  // every new session.
  if (summary.total === 0) return null;

  const percent = Math.round((summary.done / summary.total) * 100);
  const complete = summary.done === summary.total;
  // The oldest open item is the step the run is on. It is an inference, not a
  // report — the tool has no "current" field — but it is the one the agent would
  // tick next, and naming it is what separates progress from a counter.
  const activeTodo = complete ? null : summary.todos.find((todo) => !todo.done) ?? null;
  const progressText = t("chat.todosProgress", { done: summary.done, total: summary.total });

  const copy = () => {
    const text = summary.todos
      .map((todo) => `- [${todo.done ? "x" : " "}] ${todo.text}`)
      .join("\n");
    void copyText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div ref={rootRef} style={{ position: "relative", flexShrink: 0 }}>
      {/* fork:design-components —— 收起的 chip = 画板 12 B 的 `.pw-card` + `.pw-card-head`
          （list-checks 图标 + `.pw-tool` 当前项 + `.pw-path` 剩余数 + `.pw-badge.count`
          进度 + 进度条 + chevron）。条目本体（展开面板）走 A 的 `.pw-plan`。 */}
      <button
        type="button"
        className="pw-card"
        onClick={() => setOpen((value) => !value)}
        title={activeTodo ? `${t("chat.todos")} · ${activeTodo.text}` : t("chat.todos")}
        aria-label={t("chat.todos")}
        aria-expanded={open}
        style={{ display: "block", padding: 0, textAlign: "left" }}
      >
        <span className="pw-card-head">
          <span className="pw-ico" style={{ color: "var(--accent-text)" }}><i data-ico="list-checks" data-size="14" aria-hidden="true"></i></span>
          <span className="pw-tool" style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activeTodo ? activeTodo.text : progressText}
          </span>
          <span className="grow" />
          <span className="pw-badge count" style={{ fontVariantNumeric: "tabular-nums" }} aria-live="polite">{progressText}</span>
          <span
            aria-hidden="true"
            style={{
              width: 34,
              height: 4,
              flex: "none",
              borderRadius: "var(--radius-xs)",
              background: "var(--border)",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                display: "block",
                // DSN-05：宽度固定 100% + transform: scaleX，避免逐帧触发布局重排。
                width: "100%",
                height: "100%",
                transform: `scaleX(${Math.max(0, Math.min(100, percent)) / 100})`,
                transformOrigin: "left",
                background: complete ? "var(--text-muted)" : "var(--accent)",
                transition: "transform var(--fork-motion-chip, 180ms) var(--ease-out)",
              }}
            />
          </span>
          <span className="pw-ico pw-dim" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform var(--motion-fast)" }}>
            <i data-ico="chevron-down" data-size="13" aria-hidden="true"></i>
          </span>
        </span>
      </button>

      {open && (
        /* fork:design-components —— 展开面板 = 画板 12 A 的 `.pw-plan`（发丝框 /
           radius-6 / padding-s3 / grid gap）+ `.pw-plan-head`（list-checks 图标 + 标题 +
           `.pw-badge.count` 进度 + grow + `.pw-btn sm` 复制）；条目仍是 `.pw-todo`；
           底部提示行是画板的 `.pw-card-foot`。只有浮层的定位/尺寸留内联。 */
        <div
          role="group"
          aria-label={t("chat.todos")}
          className="pw-plan fork-todo-panel"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: 60,
            width: 320,
            maxWidth: "min(320px, 92vw)",
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          <div className="pw-plan-head">
            <span className="pw-ico" style={{ color: "var(--accent-text)" }}><i data-ico="list-checks" data-size="14" aria-hidden="true"></i></span>
            {t("chat.todos")}
            <span className="pw-badge count">{progressText}</span>
            <span className="grow" />
            <button type="button" className="pw-btn sm" onClick={copy} title={t("chat.copyTodos")}>
              <span className="pw-ico"><i data-ico={copied ? "check" : "copy"} data-size="13" aria-hidden="true"></i></span>
              {copied ? t("i18n.copied") : t("chat.copyTodos")}
            </button>
          </div>

          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={summary.total}
            aria-valuenow={summary.done}
            aria-label={t("chat.todos")}
            style={{ height: 4, borderRadius: "var(--radius-xs)", background: "var(--border)", overflow: "hidden" }}
          >
            <span
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                transform: `scaleX(${Math.max(0, Math.min(100, percent)) / 100})`,
                transformOrigin: "left",
                background: complete ? "var(--text-muted)" : "var(--accent)",
                transition: "transform var(--fork-motion-chip, 180ms) var(--ease-out)",
              }}
            />
          </div>

          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
            {summary.todos.map((todo) => {
              const active = activeTodo?.id === todo.id;
              return (
                /* fork:design-components —— 计划条目直接用画板 12 的 .pw-todo 组件
                   （board.css：14px 方框 / .done 灰底删除线 / .now 强调底 / 徽章用 .pw-badge）。
                   勾选标记从手绘 polyline 换成画板的 <i data-ico="check">（画板 12 A 的
                   `.pw-todo.done .box` 里就是它），进行中的那条用 `play`（同板第 104 行）。 */
                <li key={todo.id} className={`pw-todo${todo.done ? " done" : active ? " now" : ""}`}>
                  <span className="box" aria-hidden="true">
                    {todo.done ? <i data-ico="check" data-size="10"></i> : active ? <i data-ico="play" data-size="10"></i> : ""}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    {todo.text}
                  </span>
                  {active && (
                    <span className="pw-badge accent" style={{ marginLeft: "auto" }}>
                      {t("chat.todosActive")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="pw-card-foot" style={{ margin: "0 calc(-1 * var(--s3)) calc(-1 * var(--s3))" }}>
            {t("chat.todosHint")}
          </div>
        </div>
      )}
    </div>
  );
}
