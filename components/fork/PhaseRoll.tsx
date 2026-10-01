"use client";

/**
 * fork:zm-07 — 等待首 token 时的「串行滚动」状态行。
 *
 * 背景：等首 token 原来是一行裸文字（ChatWindow 的 `phaseLabel()`），相位切换时
 * 整句瞬间替换。BeautifulUI 的像素格方案已 revert（不要捧回来），这里走 ZCode
 * `QueuedSummaryContent.tsx` 的另一条路：一行固定高度，状态**串行**滚进来。
 *
 * 抄来的四条硬规则（都有单测）：
 *   1. 每条 300ms 过渡 + 500ms 停留，才允许推下一条；
 *   2. 队列最多 2 条（当前显示 + 待播），新条目替换第三格而不是无限排队；
 *   3. 同 key 快照**原地替换**（工具的 progress 数字在变，但不该重播整条滚动）；
 *   4. 定时器迟到 >250ms 就丢掉积压（主线程卡顿后不补播陈数据）。
 *
 * 动效纪律：只有 transform/opacity，只有显式 `no-preference` 才播；reduced-motion
 * 与 SSR/jsdom（偏好未知）直接显示终态，DOM 里不会出现动画中间态。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMotionPreference } from "./RollingNumber";

export const PHASE_ROLL_TRANSITION_MS = 300;
export const PHASE_ROLL_HOLD_MS = 500;
export const PHASE_ROLL_TOTAL_MS = PHASE_ROLL_TRANSITION_MS + PHASE_ROLL_HOLD_MS;
export const PHASE_ROLL_TIMER_DRIFT_SKIP_MS = 250;
export const PHASE_ROLL_MAX_PENDING = 2;
export const PHASE_ROLL_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

export interface PhaseSnapshot {
  /** 相位身份（kind + 具体工具）。同 key 只更新文字，不重播滚动。 */
  key: string;
  text: string;
}

function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/**
 * 入队（纯函数，单测覆盖）。
 *
 * - 同 key：原地替换（保留它在队列中的位置）；
 * - 空队列：直接成为待播项；
 * - 否则只保留 [队首, 新条目]，长度封顶 `maxPending`（新条目挤掉第三格）。
 */
export function enqueuePhaseSnapshot(
  queue: readonly PhaseSnapshot[],
  snapshot: PhaseSnapshot,
  maxPending: number = PHASE_ROLL_MAX_PENDING,
): PhaseSnapshot[] {
  const existingIndex = queue.findIndex((item) => item.key === snapshot.key);
  if (existingIndex >= 0) {
    const next = [...queue];
    next[existingIndex] = snapshot;
    return next;
  }
  if (queue.length === 0) return [snapshot];
  const cap = Math.max(1, maxPending);
  return [queue[0]!, snapshot].slice(0, cap);
}

/** 迟到的定时器不再补播陈数据：积压多于一条时只保留最后一条。 */
export function dropLatePhaseBacklog(
  queue: readonly PhaseSnapshot[],
  timerDriftMs: number,
): PhaseSnapshot[] {
  if (timerDriftMs > PHASE_ROLL_TIMER_DRIFT_SKIP_MS && queue.length > 1) {
    return queue.slice(-1);
  }
  return [...queue];
}

/**
 * fork:design-components —— 画板 53 帧 A 的四枚相位图标（词表来自画板，不是产品自选）：
 * 等待模型 = loader-circle（accent，滚起来）/ 排队 = clock / 准备工具 = wrench /
 * 执行命令 = terminal。相位身份来自 ChatWindow 的 `phaseKeyOf`，组件不新增 props。
 */
const PHASE_ICON: Record<string, { ico: string; color?: string; spin?: boolean }> = {
  waiting_model: { ico: "loader-circle", color: "var(--accent-text)", spin: true },
  running_command: { ico: "terminal" },
  running_tools: { ico: "wrench" },
  tools: { ico: "wrench" },
};

function phaseIcon(key: string): { ico: string; color?: string; spin?: boolean } {
  const named = PHASE_ICON[key];
  if (named) return named;
  // `tools:<id>` 这类带后缀的相位（换工具才换相位）走工具图标，其余回落 clock。
  if (key.startsWith("tools")) return PHASE_ICON.tools;
  return { ico: "clock" };
}

const LAYER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  willChange: "transform, opacity",
};

export function PhaseRoll({
  text,
  phaseKey,
  reducedMotion,
  className,
  lineHeightEm = 1.5,
}: {
  text: string | null;
  /** 相位身份；text 变化但 key 不变时只更新文字。 */
  phaseKey: string;
  /** 测试 / SSR 覆盖：强制静态（reduced-motion 分支）。 */
  reducedMotion?: boolean;
  className?: string;
  lineHeightEm?: number;
}): ReactNode {
  const preference = useMotionPreference();
  const animate = reducedMotion === true ? false : preference === "no-preference";
  const [displayed, setDisplayed] = useState<PhaseSnapshot | null>(() => (text ? { key: phaseKey, text } : null));
  const [exiting, setExiting] = useState<PhaseSnapshot | null>(null);
  const displayedRef = useRef<PhaseSnapshot | null>(displayed);
  displayedRef.current = displayed;
  const queueRef = useRef<PhaseSnapshot[]>([]);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animatingRef = useRef(false);
  const expectedTimerAtRef = useRef(0);
  const displayedNodeRef = useRef<HTMLSpanElement | null>(null);
  const exitingNodeRef = useRef<HTMLSpanElement | null>(null);
  const firstFrameRef = useRef(true);
  const promoteRef = useRef<(snapshot: PhaseSnapshot) => void>(() => {});

  const clearTimers = useCallback(() => {
    if (animationTimerRef.current !== null) {
      clearTimeout(animationTimerRef.current);
      animationTimerRef.current = null;
    }
    if (exitTimerRef.current !== null) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  promoteRef.current = (snapshot: PhaseSnapshot) => {
    const previous = displayedRef.current;
    if (previous && previous.key !== snapshot.key) {
      setExiting(previous);
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
      exitTimerRef.current = setTimeout(() => {
        exitTimerRef.current = null;
        setExiting(null);
      }, PHASE_ROLL_TRANSITION_MS);
    } else {
      setExiting(null);
    }
    displayedRef.current = snapshot;
    setDisplayed(snapshot);
    animatingRef.current = true;
    if (animationTimerRef.current !== null) clearTimeout(animationTimerRef.current);
    expectedTimerAtRef.current = now() + PHASE_ROLL_TOTAL_MS;
    animationTimerRef.current = setTimeout(() => {
      animationTimerRef.current = null;
      animatingRef.current = false;
      const drift = now() - expectedTimerAtRef.current;
      const queue = dropLatePhaseBacklog(queueRef.current, drift);
      const [next, ...rest] = queue;
      queueRef.current = rest;
      if (next) promoteRef.current(next);
    }, PHASE_ROLL_TOTAL_MS);
  };

  useEffect(() => {
    const next = text ? { key: phaseKey, text } : null;

    if (!animate || !next) {
      clearTimers();
      queueRef.current = [];
      animatingRef.current = false;
      displayedRef.current = next;
      setExiting(null);
      setDisplayed(next);
      return;
    }

    const current = displayedRef.current;
    if (current && current.key === next.key) {
      // 同 key 快照原地替换：进度数字在变，但相位没有换，不能重播整条滚动。
      if (current.text !== next.text) {
        displayedRef.current = next;
        setDisplayed(next);
      }
      return;
    }

    if (animatingRef.current || queueRef.current.length > 0) {
      queueRef.current = enqueuePhaseSnapshot(queueRef.current, next);
      return;
    }

    promoteRef.current(next);
  }, [animate, clearTimers, phaseKey, text]);

  useEffect(() => () => {
    if (animationTimerRef.current !== null) clearTimeout(animationTimerRef.current);
    if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!animate) return;
    if (firstFrameRef.current) {
      // 首帧不播：等待态出现时不该先滚一下。
      firstFrameRef.current = false;
      return;
    }
    const incoming = displayedNodeRef.current;
    const outgoing = exitingNodeRef.current;
    if (outgoing && typeof outgoing.animate === "function") {
      outgoing.animate(
        [
          { transform: "translateY(0)", opacity: 1 },
          { transform: "translateY(-0.8em)", opacity: 0 },
        ],
        { duration: PHASE_ROLL_TRANSITION_MS, easing: PHASE_ROLL_EASING },
      );
    }
    if (incoming && typeof incoming.animate === "function") {
      incoming.animate(
        [
          { transform: "translateY(0.8em)", opacity: 0 },
          { transform: "translateY(0)", opacity: 1 },
        ],
        { duration: PHASE_ROLL_TRANSITION_MS, easing: PHASE_ROLL_EASING },
      );
    }
  }, [animate, displayed, exiting]);

  if (!displayed && !exiting) return null;

  const icon = phaseIcon(displayed?.key ?? exiting?.key ?? "");
  return (
    /* fork:design-components —— 画板 53 帧 A 的 `.pw-step`：图标槽 `.pw-step-ico`
       （绝对定位在左侧轨上，board.css 画竖线）+ `.pw-verb` 文案 + `.grow` 轨。
       轨就是原来那两层 translateY 动画的宿主（LAYER_STYLE 仍是 inset:0 的绝对层），
       滚动机制一行没动；根节点继续自带 8px 上下间距（挂载方的 wrapper 不带 padding，
       否则本组件返回 null 时会留下一条空行）。 */
    <span
      role="status"
      aria-live="polite"
      className={className}
      data-fork-phase-roll={displayed?.key ?? ""}
      style={{ display: "block", padding: "8px 0", maxWidth: "100%", minWidth: 0, overflow: "hidden" }}
    >
      <span className="pw-step">
        {/* 缩进（22）与图标横位（3）由 board.css 的 `.pw-step`（padding 2 6 2 22）
            与 `.pw-step-ico`（left 3）承担，与画板同值（audit-2026-10-01）。 */}
        <span className="pw-step-ico">
          <span
            className={`pw-ico${icon.color ? "" : " pw-dim"}`}
            style={icon.color ? { color: icon.color } : undefined}
          >
            <i data-ico={icon.ico} data-size="12" className={icon.spin ? "pw-anim-spin" : undefined} aria-hidden="true"></i>
          </span>
        </span>
        <span
          className="pw-verb grow"
          style={{ position: "relative", height: `${lineHeightEm}em`, overflow: "hidden" }}
        >
          {exiting && displayed && (
            <span key={exiting.key} ref={exitingNodeRef} aria-hidden="true" style={LAYER_STYLE}>
              {exiting.text}
            </span>
          )}
          {displayed && (
            <span key={displayed.key} ref={displayedNodeRef} style={LAYER_STYLE}>
              {displayed.text}
            </span>
          )}
        </span>
      </span>
    </span>
  );
}
