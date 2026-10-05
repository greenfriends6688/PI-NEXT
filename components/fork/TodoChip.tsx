"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import type { TodoSummary } from "@/lib/todo-state";
// fork:v5-wave-b —— PWA 形态：芯片换成画板 M-02 的 `.m-tool` + `.m-tool-head`
// + `.m-badge`，只读清单行换成 M-02 帧 C 的 `.m-step-row` 家族。
import { usePwaSkin } from "@/components/pwa/skin";

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
 *
 * fork:v5-landing —— DOM 抄自画板 D-03e 帧 C：收起的 chip = `.d-card` +
 * `.d-tool-head` + `.d-bar`；展开面板 = `.d-pop` + `.d-pop-title` + 只读行
 * （`.d-checkbox` / `.d-badge info`）+ `.d-pop-foot`。
 * fork:v5-wave-b —— 窄屏：芯片 = M-02 的 `.m-tool` + `.m-tool-head`（同义），
 * 徽标换 `.m-badge`。**面板本身仍是 `.d-pop`**：PWA 库里没有「贴着芯片浮起来的
 * 小面板」这一件（`.m-pop-float` / `.m-sheet` 都是相对手机取景框定位的，
 * 放进输入卡上方的 chip 会跑位），缺件已登记 —— 面板外壳留给设计侧补。
 */

type CopyState = "idle" | "copied" | "failed";

export function TodoChip({ summary }: { summary: TodoSummary }): ReactNode {
  const { t } = useI18n();
  const isPwa = usePwaSkin();
  const [open, setOpen] = useState(false);
  // fork:fix-clipboard —— 三态而不是 `copied: boolean`：复制**可能失败**，
  // 而失败必须看得见。之前是无条件 setCopied(true)：两条路都被拒时按钮纹丝不动，
  // 用户拿着一个空剪贴板把清单粘回会话。
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const copied = copyState === "copied";
  const copyFailed = copyState === "failed";
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
  const fillStyle = { width: `${Math.max(0, Math.min(100, percent))}%` };

  const copy = () => {
    const text = summary.todos
      .map((todo) => `- [${todo.done ? "x" : " "}] ${todo.text}`)
      .join("\n");
    // `copyText` 现在永远 resolve 成一个明确结果（成功 / 失败），不抛 rejection。
    void copyText(text).then((result) => {
      const next: CopyState = result.ok ? "copied" : "failed";
      setCopyState(next);
      // 只复位自己刚写下的那一档：连点两次时旧定时器不能把新状态抹掉。
      window.setTimeout(() => setCopyState((current) => (current === next ? "idle" : current)), result.ok ? 1400 : 2600);
    });
  };

  return (
    /* fork:v5-landing —— 芯片在 .d-ctxbar（与输入卡同宽的行）里，长标题要能截断：
       `max-width:280px` 与上下文条里的 .d-chipbtn 同一档（见 system.css 的
       `.d-ctxbar .d-chipbtn`），内部 .d-t-sm 已能 ellipsis。 */
    <div ref={rootRef} style={{ position: "relative", flexShrink: 0, minWidth: 0, maxWidth: 280 }}>
      {/* 收起的 chip = 画板 D-03e 帧 C 的 `.d-card` + `.d-tool-head` + `.d-bar`。 */}
      <button
        type="button"
        className={isPwa ? "m-tool" : "d-card"}
        onClick={() => setOpen((value) => !value)}
        title={activeTodo ? `${t("chat.todos")} · ${activeTodo.text}` : t("chat.todos")}
        aria-label={t("chat.todos")}
        aria-expanded={open}
        style={{ display: "block", padding: 0, textAlign: "left", cursor: "pointer" }}
      >
        <span className={isPwa ? "m-tool-head" : "d-tool-head"} style={{ width: "100%", border: 0, background: "none", font: "inherit", textAlign: "left" }}>
          <i data-ico="list-checks" data-size="14" aria-hidden="true"></i>
          <span className={`${isPwa ? "m" : "d"}-t-sm ${isPwa ? "m" : "d"}-grow fork-todo-title`}>
            {activeTodo ? activeTodo.text : progressText}
          </span>
          <span className={isPwa ? "m-badge" : "d-badge"} style={{ fontVariantNumeric: "tabular-nums" }} aria-live="polite">{progressText}</span>
          <i
            data-ico="chevron-down"
            data-size="13"
            aria-hidden="true"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform var(--nx-dur-1) var(--nx-ease)" }}
          ></i>
        </span>
        <div className="d-bar" style={{ borderRadius: 0 /* 非主题值：画板 D-03e 芯片进度条无圆角 */ }}>
          <i style={fillStyle} />
        </div>
      </button>

      {open && (
        /* 展开面板 = 画板 D-03e 帧 C 的 `.d-pop`（标题 / 只读行 / 分隔线 / 脚注）。 */
        <div
          role="group"
          aria-label={t("chat.todos")}
          className="d-pop is-open fork-todo-panel"
        >
          <div className="d-pop-title">{t("chat.todos")}</div>

          <div className="d-row" style={{ padding: "0 var(--nx-sp-3) var(--nx-sp-2)" }}>
            <span className="d-badge mute">{progressText}</span>
            <span className="d-grow" />
            <button
              type="button"
              className={copyFailed ? "d-btn sm danger" : "d-btn sm"}
              onClick={copy}
              title={copyFailed ? t("chat.todosCopyFailed") : t("chat.copyTodos")}
            >
              <i data-ico={copied ? "check" : "copy"} data-size="13" aria-hidden="true"></i>
              {copied ? t("i18n.copied") : t("chat.copyTodos")}
            </button>
          </div>

          {/* fork:fix-clipboard —— 失败徽标**另起一行**，不挂进头部那一行：
              头里已经站着进度徽标 + 复制钮，英文 "Could not copy" 塞进去会把整行挤爆。 */}
          {copyFailed && (
            <div className="d-row" style={{ padding: "0 var(--nx-sp-3) var(--nx-sp-2)" }}>
              <span role="status" className="d-badge bad">{t("chat.todosCopyFailed")}</span>
            </div>
          )}

          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={summary.total}
            aria-valuenow={summary.done}
            aria-label={t("chat.todos")}
            className="d-bar"
            style={{ margin: "0 var(--nx-sp-3) var(--nx-sp-2)" }}
          >
            <i style={fillStyle} />
          </div>

          {summary.todos.map((todo) => {
            const active = activeTodo?.id === todo.id;
            return (
              /* 只读行 = 画板 D-03e 帧 C：`.d-checkbox`（勾）或 `.d-badge info`（进行中）+
                 `.d-grow` 文案。勾这一格等于改写已落盘的会话历史，所以不可点。 */
              <div key={todo.id} className="d-row d-t-xs" style={{ padding: "3px var(--nx-sp-3)" }}>
                {todo.done ? (
                  /* fork:v5-boards D-27 帧 F / D-28 帧 C —— 勾选态用 `.d-check-draw`
                     描边动画（200ms cubic-bezier(.65,0,.35,1)）。是本组件唯一手写的
                     SVG：图标库不给 `pathLength`，直接用 `data-ico` 的 path 会按像素算
                     dash、描边会一跳一跳（板面注记），所以路径写在这里、`pathLength="1"`
                     与分辨率无关。勾的是**真的完成项**（todo 工具写入的 done），不是装饰。 */
                  <span className="d-checkbox on" aria-hidden="true">
                    <span className="d-check-draw">
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path pathLength="1" d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                  </span>
                ) : active ? (
                  <span className="d-badge info">{t("chat.todosActive")}</span>
                ) : (
                  <span className="d-checkbox" aria-hidden="true" />
                )}
                <span
                  className={todo.done ? "d-grow d-t-faint" : "d-grow"}
                  style={todo.done ? { textDecoration: "line-through" } : undefined}
                >
                  {todo.text}
                </span>
              </div>
            );
          })}

          <div className="d-sep"></div>
          <div className="d-pop-foot">{t("chat.todosHint")}</div>
        </div>
      )}
    </div>
  );
}
