"use client";

/*
 * fork:v5-landing E4 —— M-11 帧 A 的两条手机手势，DOM 原文取自
 * `design/v5/pwa/boards/M-11-gestures-states.html` 帧 A：
 *
 *   · `.m-pull`（A-1 下拉刷新）：位置即状态，不是一个按钮；
 *   · `.m-swipe` › `.m-swipe-edge` + `.m-swipe-hint`（A-2 左缘侧滑返回）：
 *     命中带只占左缘 28px，竖条与提示胶囊**按压才出现**。
 *
 * 为什么这两件必须写成「真的会动」而不是摆一个装饰：画板自己的规则写着
 * 「位置本身就在讲『你在拉动这一屏』」（.m-pull）与「手势不可发现，所以要给一个
 * 常驻的等价入口」（.m-swipe）。只放节点不接手势 = 一个按不动的假件，
 * 下一个看代码的人会以为功能已经做完了。
 *
 * 两条手势各自的真实动作由**宿主**给（本项目里是会话页的转录重载与 M-12 全屏层
 * 的关闭），本文件不碰业务：只负责「拉/滑 → 阈值 → 回调」这一段。
 *
 * 画板原文（M-11 帧 A-1 / A-2）：
 *   <div class="m-pull"><span class="m-badge mute"><i data-ico="refresh-cw" data-size="12"></i>松手刷新</span></div>
 *   <div class="m-swipe"><div class="m-swipe-edge"></div></div>
 *   <div class="m-swipe-hint is-open"><i data-ico="arrow-left" data-size="13"></i><span class="m-grow">松手返回「设置」</span></div>
 *
 * 三档阈值是画板帧 A-1 面板里写死的三句话（0–24 提示 / 24–64 到位 / 过 64 执行），
 * 这里照抄成常量，不再各自解释一遍。
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Locale } from "@/lib/i18n/types";

/** 三档阈值（M-11 帧 A-1「0 – 24px 提示 / 24 – 64px 到位 / 过 64px 松手执行」）。 */
const PULL_ARM_PX = 24;
export const PULL_TRIGGER_PX = 64;
/** 松手后「刷新中」至少显示这么久：本项目的刷新是几百毫秒量级，低于这个数会闪一下。 */
const PULL_MIN_BUSY_MS = 600;
/** 侧滑返回的松手阈值（画板只写「松手后压入上一页」，阈值取命中带的两倍宽）。 */
const SWIPE_TRIGGER_PX = 56;

type Copy = Record<Locale, string>;

function copyOf(table: Copy, locale: string): string {
  return table[locale as Locale] ?? table.en;
}

/* 本文件的三句话在语言包里没有键，而这一轮不允许改 `lib/i18n/messages/**`
   （与 `components/pwa/settingsHub.ts` 同一口径：窄屏专属文案走本地表）。 */
const PULL_HINT: Copy = {
  en: "Pull to refresh",
  "zh-CN": "下拉刷新",
  "zh-TW": "下拉重新整理",
};
const PULL_ARM: Copy = {
  en: "Release to refresh",
  "zh-CN": "松手刷新",
  "zh-TW": "放手重新整理",
};
const PULL_BUSY: Copy = {
  en: "Refreshing",
  "zh-CN": "刷新中",
  "zh-TW": "重新整理中",
};
const SWIPE_RELEASE: Copy = {
  en: "Release to go back",
  "zh-CN": "松手返回",
  "zh-TW": "放手返回",
};

export interface PwaPullToRefreshProps {
  /**
   * 手势宿主：在这棵子树里找手机形态的滚动容器 `.m-scroll`（画板 M-01/M-02 的
   * 唯一纵向滚动区）。找不到就不挂监听 —— 宁可没有手势，也不在错误的节点上抢滚动。
   */
  surfaceRef: RefObject<HTMLElement | null>;
  /** 真正的刷新动作（宿主自己的重载入口）。可以返回 Promise，返回后指示器才收。 */
  onRefresh: () => void | Promise<void>;
  /** 关掉手势（例如正在跑的那一屏不想被刷新打断）。 */
  disabled?: boolean;
}

/**
 * 下拉刷新指示器 `.m-pull`（+ 手势）。
 *
 * 纪律（画板 M-11 帧 A-1 的三条「不许」都写在这里）：
 *   · **已经在顶才拉**：`scrollTop > 0` 时整条手势不武装 —— 列表在中间时下拉是滚动手势；
 *   · **不动焦点、不清草稿**：只 bump 宿主的刷新计数，输入卡不在本组件的触碰范围里；
 *   · **松手后不跳回顶部**：不写 `scrollTop`，也不抛 `scrollIntoView`。
 */
export function PwaPullToRefresh({ surfaceRef, onRefresh, disabled = false }: PwaPullToRefreshProps) {
  const { locale } = useI18n();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    if (disabled) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const scroller = surface.querySelector<HTMLElement>(".m-scroll");
    if (!scroller) return;

    let armed = false;
    let startY = 0;
    let distance = 0;

    const reset = () => {
      armed = false;
      distance = 0;
      setPull(0);
    };

    const onStart = (event: TouchEvent) => {
      if (busyRef.current || event.touches.length !== 1) return;
      armed = scroller.scrollTop <= 0;
      startY = event.touches[0].clientY;
      distance = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (!armed || busyRef.current || event.touches.length !== 1) return;
      const dy = event.touches[0].clientY - startY;
      if (dy <= 0) {
        distance = 0;
        setPull(0);
        return;
      }
      // 阻尼：手指走 1.5 倍，指示器走 1 倍，过了阈值就不再长（画板：位置即状态）。
      distance = Math.min(dy / 1.5, PULL_TRIGGER_PX * 1.25);
      setPull(distance);
      if (dy > 8) event.preventDefault();
    };
    const onEnd = () => {
      if (!armed || busyRef.current) return;
      const shouldRefresh = distance >= PULL_TRIGGER_PX;
      armed = false;
      if (!shouldRefresh) {
        reset();
        return;
      }
      distance = PULL_TRIGGER_PX;
      setPull(PULL_TRIGGER_PX);
      busyRef.current = true;
      setBusy(true);
      const startedAt = Date.now();
      void Promise.resolve(refreshRef.current()).finally(() => {
        const wait = Math.max(0, PULL_MIN_BUSY_MS - (Date.now() - startedAt));
        setTimeout(() => {
          busyRef.current = false;
          setBusy(false);
          reset();
        }, wait);
      });
    };

    scroller.addEventListener("touchstart", onStart, { passive: true });
    scroller.addEventListener("touchmove", onMove, { passive: false });
    scroller.addEventListener("touchend", onEnd);
    scroller.addEventListener("touchcancel", reset);
    return () => {
      scroller.removeEventListener("touchstart", onStart);
      scroller.removeEventListener("touchmove", onMove);
      scroller.removeEventListener("touchend", onEnd);
      scroller.removeEventListener("touchcancel", reset);
    };
  }, [disabled, surfaceRef]);

  if (pull <= 0) return null;
  const label = busy
    ? copyOf(PULL_BUSY, locale)
    : pull >= PULL_TRIGGER_PX
      ? copyOf(PULL_ARM, locale)
      : copyOf(PULL_HINT, locale);
  const icon = busy ? "loader-circle" : pull >= PULL_ARM_PX ? "refresh-cw" : "arrow-down";

  return (
    <div
      className="m-pull"
      data-pull-state={busy ? "busy" : pull >= PULL_TRIGGER_PX ? "armed" : "hint"}
      /* 跟着手指走：位移是运行时几何，类里不写死（M-11 帧 A-1「位置即状态」）。 */
      style={{ transform: `translateY(${pull}px)` }}
    >
      <span className="m-badge mute">
        <i data-ico={icon} data-size="12" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

export interface PwaEdgeSwipeBackProps {
  /** 松手后的动作（返回上一页 / 关掉这一层）。 */
  onBack: () => void;
  /** 是否启用（没有可返回的东西时不该留下一条能滑但滑不动的带子）。 */
  enabled?: boolean;
  /** 提示胶囊里那句「松手返回 X」的 X（缺省就是「上一页」）。 */
  target?: string;
}

/**
 * 左缘侧滑返回：`.m-swipe`（28px 命中带）› `.m-swipe-edge`（竖条）+ `.m-swipe-hint`（提示胶囊）。
 *
 * 画板 M-11 帧 A-2 的两条纪律：
 *   · 只有左缘 28px 能触发（横滑 = 这一页的历史，纵滑 = 滚内容）；
 *   · 竖条与胶囊**按压才出现** —— 所以胶囊挂 `.is-open`（它的入场动效在库里），
 *     竖条的显形由库里的 `.m-swipe:active .m-swipe-edge` 承担，本组件不另写一条。
 */
export function PwaEdgeSwipeBack({ onBack, enabled = true, target }: PwaEdgeSwipeBackProps) {
  const { locale } = useI18n();
  const [hintOpen, setHintOpen] = useState(false);
  const startXRef = useRef(0);
  const draggingRef = useRef(false);

  const end = useCallback((fire: boolean) => {
    draggingRef.current = false;
    setHintOpen(false);
    if (fire) onBack();
  }, [onBack]);

  if (!enabled) return null;

  const label = `${copyOf(SWIPE_RELEASE, locale)}${target ? `「${target}」` : ""}`;

  return (
    <>
      <div
        className="m-swipe"
        role="presentation"
        /* 横滑由本组件处理、纵滑仍归页面滚动 —— 归属写在这里，不写在类里
           （`.m-swipe` 是库类，库只负责「28px 命中带」这条几何）。 */
        style={{ touchAction: "pan-y" }}
        onPointerDown={(event) => {
          draggingRef.current = true;
          startXRef.current = event.clientX;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return;
          if (event.clientX - startXRef.current > 8) setHintOpen(true);
        }}
        onPointerUp={(event) => end(event.clientX - startXRef.current >= SWIPE_TRIGGER_PX)}
        onPointerCancel={() => end(false)}
      >
        <div className="m-swipe-edge" />
      </div>
      <div className={`m-swipe-hint${hintOpen ? " is-open" : ""}`} aria-hidden={!hintOpen}>
        <i data-ico="arrow-left" data-size="13" aria-hidden="true" />
        <span className="m-grow">{label}</span>
      </div>
    </>
  );
}
