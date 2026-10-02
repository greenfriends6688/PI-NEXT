"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
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

export function TaskProgressOverlay({ summary, streaming }: { summary: TodoSummary; streaming: boolean }): ReactNode {
  const { t } = useI18n();
  const collapseRef = useRef<HTMLDivElement>(null);

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
  }, [hasDisplayTasks, displaySignature, streaming]);

  const progress = useMemo(() => aggregateTaskItems(displayItems), [displayItems]);
  const mounted = useCollapsePresence(visible, FADE_OUT_DURATION_MS, collapseRef);

  // 没有任何任务过：空会话挂一个空壳只是噪声（与 TodoChip 同一条判据）。
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

  return (
    // fork:design-components —— 壳是画板 12 帧 5 / 画板 50 的通知条 `.pw-toast`
    // （surface-popover + shadow-popover + radius-6），两处语气档复用它自带的
    // `.pw-toast.warn` / `.pw-toast.bad`（只改图标色，不改几何）；计数是画板 12
    // 计划卡头那枚 `.pw-badge.count`；进度轨是新登记的 `.pw-progress`（见 DIVERGENCE）。
    <div
      ref={collapseRef}
      className="fork-collapse"
      data-fork-collapse={visible ? "open" : "closed"}
      style={{ flexShrink: 1, minWidth: 0 }}
    >
      <div className="fork-collapse-body">
        <div
          role="status"
          aria-live="polite"
          aria-label={t("chat.taskProgress")}
          className={`pw-toast${tone === "active" ? "" : ` ${tone}`}`}
          style={{
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
          <span className="pw-badge count">{t("chat.todosProgress", { done, total })}</span>
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
        </div>
      </div>
    </div>
  );
}