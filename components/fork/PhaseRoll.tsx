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
// 类型导入，编译后消失（PhaseRoll 不能在 node 里把整个 hook 拉进来）。
import type { AgentPhase } from "@/hooks/useAgentSession";
// fork:v5-wave-b —— PWA 形态：状态行换成画板 M-02 帧 A 的 `.m-run`（转圈 +
// 一句话），`.m-run > i:first-child` 自带 1400ms linear 的 nx-spin，桌面由
// system.css 的 `.d-run` 承担同一档动效。滚动机制（两层 translateY）一字未动。
import { usePwaSkin } from "@/components/pwa/skin";

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

/** i18n 的 t 形参（本模块只需要这一种）。 */
export type PhaseTranslate = (key: string, params?: Record<string, string | number>) => string;

/**
 * fork:zm-08 —— 状态行文案（上游依据 2e66e40 / #1008「压缩中不要报等模型」）。
 *
 * `isCompacting` 压过相位本身：自动压缩会把一轮卡住好几十秒才出下一个 token，
 * 期间相位还停在 `waiting_model`（相位是在发消息那一刻定的，没人跟着压缩改），
 * 文案就一直是「正在等待模型...」，读起来像挂死。压缩期间真正该告诉用户的是
 * 「正在压缩」，所以先判它。
 */
export function phaseLabel(phase: AgentPhase, t: PhaseTranslate, isCompacting?: boolean): string | null {
  if (isCompacting) return t("chat.compacting");
  if (phase?.kind === "running_tools") {
    const latest = phase.tools[phase.tools.length - 1];
    if (latest?.progress) {
      return `${t("chat.runningNamedTool", { name: latest.name })} ${latest.progress}`;
    }
    const names = phase.tools.map((tool) => tool.name);
    if (names.length === 0) return t("chat.runningTool");
    if (names.length === 1) return t("chat.runningNamedTool", { name: names[0] });
    if (names.length <= 3) return t("chat.runningTools", { names: names.join(", ") });
    return t("chat.runningToolsMore", { names: names.slice(0, 2).join(", "), count: names.length - 2 });
  }
  if (phase?.kind === "waiting_model") return t("chat.waitingModel");
  if (phase?.kind === "running_command") return t("chat.runningCommand");
  return null;
}

/**
 * fork:zm-07 —— 相位身份（PhaseRoll 的 key）。
 *
 * 同一个工具/命令的 progress 更新必须保持同 key（原地换文字，不重播滚动）；
 * 换工具、换相位才是一条新状态。压缩必须换一个 key，否则从「等模型」切进压缩
 * 时文字会原地替换、不滚进来，而这正是要让人看见的一次切换。
 */
export function phaseKeyOf(phase: AgentPhase, isCompacting?: boolean): string {
  if (isCompacting) return "compacting";
  if (!phase) return "idle";
  if (phase.kind === "running_tools") {
    const latest = phase.tools[phase.tools.length - 1];
    if (!latest) return "tools";
    return `tools:${latest.id || latest.name}`;
  }
  return phase.kind;
}

function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/** fork:v5-landing D-03e 帧 B —— 相位已持续多少秒（板面 `d-run` 里那格 `1.2s`）。
 *  纯 1s 心跳，同 key 不重置；没在转圈的相位不占一个定时器。 */
function usePhaseElapsed(activeKey: string | null, active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active || !activeKey) {
      setSeconds(0);
      return;
    }
    const startedAt = now();
    setSeconds(0);
    const id = setInterval(() => setSeconds((now() - startedAt) / 1000), 1000);
    return () => clearInterval(id);
  }, [active, activeKey]);
  return seconds;
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
  // fork:zm-08 —— 压缩同样是在等模型算（画板 53 帧 A 的词表只有四枚图标，
  // 不为它新画一枚），沿用同一枚转圈字形，靠文案区分。
  compacting: { ico: "loader-circle", color: "var(--accent-text)", spin: true },
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
  const isPwa = usePwaSkin();
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

  // fork:v5-landing —— 板面「等模型」那一格：文案右边挂一枚 `.d-run`（转圈 + 已等待
  // 秒数）。只有转圈的相位才有这一格 —— 它回答的是「还要多久没动静」；已经有明确
  // 进展的相位（跑工具 / 跑命令）那句话在闪，那一格没有意义。
  // 钩子必须在下面 `!displayed && !exiting` 的提前 return **之前** 调。
  const activeKey = displayed?.key ?? null;
  const elapsed = usePhaseElapsed(activeKey, Boolean(activeKey && phaseIcon(activeKey).spin));

  if (!displayed && !exiting) return null;

  const icon = phaseIcon(displayed?.key ?? exiting?.key ?? "");
  return (
    /* fork:v5-landing —— 画板 D-03e 帧 B 的 `.d-step`：图标槽 `.d-step-ico` +
       `.d-step-body` 文案。轨就是原来那两层 translateY 动画的宿主（LAYER_STYLE 仍是
       inset:0 的绝对层），滚动机制一行没动；运行相位挂 `.running` 让图标转强调色。
       根节点继续自带 8px 上下间距（挂载方的 wrapper 不带 padding，否则本组件返回
       null 时会留下一条空行）。
       fork:v5-wave-b —— 窄屏换成 M-02 帧 A 的 `.m-run`；两层 translateY 的轨
       （LAYER_STYLE）与排队/错峰逻辑一个字没动。 */
    <span
      role="status"
      aria-live="polite"
      className={className}
      data-fork-phase-roll={displayed?.key ?? ""}
      /* fork:apple-sketch —— 原来 `padding: 8px 0` 叠上内层 `.d-step` 的 `6px 0`，
         一行文字吃了 28px 纵向内边距，卡片显得空而高（用户实拍）。收到 2px。 */
      style={{ display: "block", padding: "2px 0", maxWidth: "100%", minWidth: 0, overflow: "hidden" }}
    >
      {/* fork:v5-wave-b —— 窄屏抄 M-02 帧 A 的 `.m-run`（转圈图标 + 一句话）。
          图标不再套 `.d-step-ico` 方框：画板里 `i[data-ico]` 直接是 `.m-run` 的
          第一个子元素（`.m-run > i:first-child` 才是那条 1400ms linear 旋转规则）。 */}
      <span className={isPwa ? "m-run" : `d-step${icon.spin ? " running" : ""}`}>
        {isPwa
          ? <i data-ico={icon.ico} data-size="10" aria-hidden="true"></i>
          : (
            <span className="d-step-ico">
              <i data-ico={icon.ico} data-size="10" aria-hidden="true"></i>
            </span>
          )}
        <span
          className={isPwa ? "m-t-xs" : "d-step-body"}
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
        {!isPwa && icon.spin && displayed && (
          /* fork:waiting-row（2026-10-08，用户实拍「正在等待模型...这个请你帮我也优化一下
             展示吧，我不喜欢这个啊」）—— 原来右边是 `.d-run`：一枚**第二只**转圈图标 +
             强调色秒数。一行里两个转圈、右边还是蓝的，读起来像两件事同时在跑；
             左边那只图标已经说完了「在等」。现在只留秒数本身，用画板本来就有的
             `.d-step-meta`（xs / `--nx-text-3` / nowrap / 不伸缩），数字走等宽，
             免得每秒抖一下。
             （同一次还修了「那根孤立的竖线」：导轨现在只在 `.d-steps` 时间轴里画，
             PhaseRoll 这张单行卡不再挂导轨 —— 见 system.css 的 fork:phase-rail-scope。） */
          <span className="d-step-meta" style={{ fontVariantNumeric: "tabular-nums" }}>
            {`${elapsed.toFixed(1)}s`}
          </span>
        )}
      </span>
    </span>
  );
}
