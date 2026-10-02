"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { useCollapsePresence } from "@/hooks/useCollapsePresence";
import {
  aggregateTaskItems,
  deriveTaskItems,
  shouldRetainTaskProgress,
  taskProgressRatio,
  taskProgressTone,
  taskSignature,
  type TaskItem,
} from "@/lib/task-progress";
import type { TodoSummary } from "@/lib/todo-state";

/**
 * fork:proma-31-task-progress — 吸底任务进度浮层（PR-31）。
 *
 * 形态抄的是 Proma 的 TaskProgressOverlay（`components/agent/TaskProgressOverlay.tsx`），
 * 但**不抄它的两个前提**：那边浮层挂在 `use-stick-to-bottom` 的上下文里、还要顶掉
 * 「回到最下方」按钮；这边的宿主是 ChatWindow 已经钉好的那条定位带（composer 正上方
 * `position:absolute; bottom:100%` 的一行），所以本组件只出内容，定位交给宿主。
 *
 * ## 这是**唯一**的待办界面（2026-10-02 用户裁定）
 *
 * 合并 PR-31 时这里和 composer 里的 `TodoChip` 同时渲染了同一份 `extractTodoState`，
 * 于是待办清单在屏幕上是**两遍**（用户截图指出）。用户裁定删掉芯片、只留浮层，并把
 * 芯片原来的「点击展开完整清单 + 复制」搬进来。`TodoChip.tsx` 已删除，不要再加第二个
 * 待办入口 —— 数据只有一份，界面也只该有一个。
 *
 * 三条行为契约，每一条对应 lib/task-progress.ts 里的一个纯函数：
 *
 * 1. **流式中不卸载。** run 还在跑时浮层钉住，不淡出、不倒计时。判据是
 *    `shouldRetainTaskProgress(streaming, hasTasks)` —— 只有整个 run 结束
 *    （`streaming === false`）才开始那 4 秒倒计时。反过来写成「不流式就淡出」会在
 *    agent 两次工具调用之间把它收掉，而那正是最需要看到进度的时候。
 * 2. **结束后留 4 秒再淡出。** `FINISH_RETENTION_MS = 4_000`，末尾
 *    `FADE_OUT_DURATION_MS = 200` 是淡出（画板的 `--motion-transition`）。
 *    用户点完发送立刻回看消息，读到的仍然是「这一轮做完 3/8」而不是空白。
 * 3. **清单被清空后仍留最后一份快照。** `todo clear` / 切会话会让
 *    `extractTodoState` 归零；此时直接消失等于把刚结束那一轮的结论一起吞掉，
 *    所以保留最后一份非空快照，走同一条 4 秒窗口。
 *
 * **面板开着时不淡出**（第 4 条契约）：用户主动展开清单就是要读它，此时让 4 秒
 * 计时器把它收掉，等于「我点开的东西自己消失了」。
 *
 * 退出过渡复用全站那一个折叠原语：`hooks/useCollapsePresence.ts` + `.fork-collapse`
 * （`grid-template-rows` 0fr↔1fr），与 `ProcessGroup` / `MessageView` 的折叠同一套；
 * 透明度淡出叠在同一段时间里，两条都在 4 秒那一刻收口。
 *
 * 依赖一律走**签名**（`taskSignature`）而不是数组身份：转录每个流式分片都重建一次
 * summary，按对象依赖会让下面两个 effect 每个分片各跑一次，倒计时被反复重启。
 */

export const FINISH_RETENTION_MS = 4_000;
export const FADE_OUT_DURATION_MS = 200;

interface RetainedSnapshot {
  items: TaskItem[];
  signature: string;
}

type CopyState = "idle" | "copied" | "failed";

/** 面板里的一行：从 TaskItem 的六态压到画板 `.pw-todo` 支持的三档外观。 */
interface TodoRow {
  id: string;
  text: string;
  done: boolean;
  active: boolean;
  /** 框里画什么图标（画板 `.pw-todo` 只有 `.done` / `.now` 两档修饰符，
   *  error / blocked 不改外观、只换图标，与浮层标题的语气档保持一致）。 */
  boxIcon: string | null;
}

function toTodoRows(items: readonly TaskItem[]): TodoRow[] {
  return items.map((item) => ({
    id: item.id,
    // 面板列的是**计划本身**，所以用 subject 而不是 activeForm（后者是进行中那
    // 一条的现在进行时写法，浮层标题才用它）。
    text: item.subject,
    done: item.status === "completed",
    active: item.status === "in_progress",
    boxIcon:
      item.status === "completed"
        ? "check"
        : item.status === "in_progress"
          ? "play"
          : item.status === "error"
            ? "circle-alert"
            : item.status === "blocked"
              ? "triangle-alert"
              : null,
  }));
}

export function TaskProgressOverlay({ summary, streaming }: { summary: TodoSummary; streaming: boolean }): ReactNode {
  const { t } = useI18n();
  const collapseRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // 三态而不是 `copied: boolean`：复制**可能失败**，而失败必须看得见。
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const copied = copyState === "copied";
  const copyFailed = copyState === "failed";

  // 推导结果挂在**清单签名**上，而不是 `summary` 对象上：转录每来一个流式分片就
  // 重建一次 summary，按对象依赖等于每帧重算。下面两个 effect 也是同一个道理
  // ——它们要的是「内容变了没有」，不是「数组换了没有」。
  const summarySignature = summary.todos.map((todo) => `${todo.id}:${todo.text}:${todo.done ? 1 : 0}`).join("|");
  const liveItems = useMemo(
    () => deriveTaskItems(summary, { streaming }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- summary 每帧换身份，签名才是收敛点
    [summarySignature, streaming],
  );
  const liveSignature = useMemo(() => taskSignature(liveItems), [liveItems]);

  const [retained, setRetained] = useState<RetainedSnapshot>({ items: [], signature: "" });
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const mounted = useCollapsePresence(visible, FADE_OUT_DURATION_MS, collapseRef);

  // 新的非空清单 → 存快照并立刻现身（新的内容不能继承上一份的淡出状态）。
  useEffect(() => {
    if (liveItems.length === 0 || liveSignature === retained.signature) return;
    setRetained({ items: liveItems, signature: liveSignature });
    setFading(false);
    setVisible(true);
  }, [liveItems, liveSignature, retained.signature]);

  const displayItems = liveItems.length > 0 ? liveItems : retained.items;
  const displaySignature = liveItems.length > 0 ? liveSignature : retained.signature;
  const hasDisplayTasks = displayItems.length > 0;

  useEffect(() => {
    // 还在跑 → 不倒计时，浮层钉住。
    if (!shouldRetainTaskProgress(streaming, hasDisplayTasks)) {
      if (hasDisplayTasks) {
        setFading(false);
        setVisible(true);
      }
      return;
    }
    // 用户把面板点开了 → 他要读它，别让计时器把它收走。
    if (open) return;
    // run 结束：留 4 秒，最后 200ms 淡出。
    const fadeTimer = window.setTimeout(() => setFading(true), FINISH_RETENTION_MS - FADE_OUT_DURATION_MS);
    const hideTimer = window.setTimeout(() => {
      setVisible(false);
      setRetained({ items: [], signature: "" });
    }, FINISH_RETENTION_MS);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
    };
  }, [hasDisplayTasks, displaySignature, streaming, open]);

  // 面板的外点关闭 / Esc。折叠起来时浮层会自己淡出，所以不需要额外收口。
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

  // 浮层收起时把面板一起收掉，否则它会在下一次现身时带着上一轮的展开态回来。
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  const progress = useMemo(() => aggregateTaskItems(displayItems), [displayItems]);

  // 没有任何任务过：空会话挂一个空壳只是噪声。
  if (!hasDisplayTasks || !mounted) return null;

  const { done, total, current, hasBlocked, hasError } = progress;
  const tone = taskProgressTone(progress);
  const complete = total > 0 && done === total;
  const label = current ? current.activeForm ?? current.subject : t("chat.taskProgressDone");
  const railTone = tone === "active" ? (complete ? " done" : "") : ` ${tone}`;
  const spinning = tone === "active" && current?.status === "in_progress";
  const icon = hasError
    ? "circle-alert"
    : hasBlocked
      ? "triangle-alert"
      : spinning
        ? "loader-circle"
        : complete
          ? "circle-check"
          : "list-checks";
  const progressText = t("chat.todosProgress", { done, total });
  const rows = toTodoRows(displayItems);

  const copy = () => {
    const text = rows.map((row) => `- [${row.done ? "x" : " "}] ${row.text}`).join("\n");
    // `copyText` 永远 resolve 成一个明确结果（成功 / 失败），不抛 rejection。
    void copyText(text).then((result) => {
      const next: CopyState = result.ok ? "copied" : "failed";
      setCopyState(next);
      // 只复位自己刚写下的那一档：连点两次时旧定时器不能把新状态抹掉。
      window.setTimeout(() => setCopyState((currentState) => (currentState === next ? "idle" : currentState)), result.ok ? 1400 : 2600);
    });
  };

  return (
    // fork:design-components —— 壳是画板 12 帧 5 / 画板 50 的通知条 `.pw-toast`
    // （surface-popover + shadow-popover + radius-6），两处语气档复用它自带的
    // `.pw-toast.warn` / `.pw-toast.bad`（只改图标色，不改几何）；计数是画板 12
    // 计划卡头那枚 `.pw-badge.count`；进度轨是新登记的 `.pw-progress`（见 DIVERGENCE）。
    <div
      ref={rootRef}
      className="fork-collapse"
      data-fork-collapse={visible ? "open" : "closed"}
      style={{ flexShrink: 1, minWidth: 0, position: "relative" }}
    >
      <div className="fork-collapse-body">
        {/* 宿主那条定位带是 `pointer-events: none`（它只负责把浮层和「回到最下方」
            居中排一行），所以可交互的这两块各自把指针收回来。 */}
        <button
          type="button"
          className={`pw-toast fork-task-progress${tone === "active" ? "" : ` ${tone}`}`}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={t("chat.taskProgress")}
          title={label}
          style={{
            pointerEvents: "auto",
            maxWidth: "100%",
            opacity: fading ? 0 : 1,
            transition: "opacity var(--motion-transition) var(--ease)",
          }}
        >
          <span className="pw-ico">
            {/* `.pw-anim-spin` 是画板 N 那一档持续类（reduced-motion 下由 board.css 统一关掉）：
                「正在做」与「只是列了一条计划」在视觉上必须差得开，否则浮层退回成一个计数器。*/}
            <i data-ico={icon} data-size="14" className={spinning ? "pw-anim-spin" : undefined} aria-hidden="true"></i>
          </span>
          <span className="pw-badge count" style={{ fontVariantNumeric: "tabular-nums" }} aria-live="polite">{progressText}</span>
          <span
            className="pw-grow"
            style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {label}
          </span>
          <span
            className={`pw-progress${railTone}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-label={t("chat.taskProgress")}
          >
            {/* DSN-05：轨宽固定 100% + scaleX，逐帧只合成不重排。 */}
            <i style={{ transform: `scaleX(${taskProgressRatio(progress)})` }} />
          </span>
          <span className="pw-ico pw-dim fork-task-progress-chevron" data-open={open ? "true" : "false"}>
            <i data-ico="chevron-down" data-size="13" aria-hidden="true"></i>
          </span>
        </button>

        {open && (
          /* 展开面板 = 画板 12 A 的 `.pw-plan`（发丝框 / radius-6 / padding-s3 /
             grid gap）+ `.pw-plan-head`（list-checks 图标 + 标题 + `.pw-badge.count`
             进度 + grow + `.pw-btn sm` 复制）；条目仍是 `.pw-todo`；底部提示行是
             画板的 `.pw-card-foot`。定位与尺寸收进 `.fork-todo-panel`（fork-ui.css）。 */
          <div role="group" aria-label={t("chat.todos")} className="pw-plan fork-todo-panel">
            <div className="pw-plan-head">
              <span className="pw-ico" style={{ color: "var(--accent-text)" }}><i data-ico="list-checks" data-size="14" aria-hidden="true"></i></span>
              {t("chat.todos")}
              <span className="pw-badge count">{progressText}</span>
              <span className="grow" />
              <button
                type="button"
                className={copyFailed ? "pw-btn sm danger" : "pw-btn sm"}
                onClick={copy}
                title={copyFailed ? t("chat.todosCopyFailed") : t("chat.copyTodos")}
              >
                <span className="pw-ico"><i data-ico={copied ? "check" : "copy"} data-size="13" aria-hidden="true"></i></span>
                {copied ? t("i18n.copied") : t("chat.copyTodos")}
              </button>
            </div>

            {/* 失败徽标**另起一行**，不挂进 `.pw-plan-head`：头里已经站着图标 + 标题 +
                进度徽标 + 复制钮，英文 "Could not copy" 塞进去会把标题挤到换行
                （浮层只有 320px / 92vw），头就长高一截。`.pw-plan` 自己是 grid + gap，
                插一行白拿间距，面板本来就能滚。 */}
            {copyFailed && (
              <div>
                <span role="status" className="pw-badge bad">{t("chat.todosCopyFailed")}</span>
              </div>
            )}

            <ul className="fork-todo-list">
              {rows.map((row) => (
                <li key={row.id} className={`pw-todo${row.done ? " done" : row.active ? " now" : ""}`}>
                  <span className="box" aria-hidden="true">
                    {row.boxIcon && <i data-ico={row.boxIcon} data-size="10"></i>}
                  </span>
                  <span style={{ minWidth: 0 }}>{row.text}</span>
                  {row.active && (
                    <span className="pw-badge accent" style={{ marginLeft: "auto" }}>
                      {t("chat.todosActive")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="pw-card-foot">{t("chat.todosHint")}</div>
          </div>
        )}
      </div>
    </div>
  );
}
