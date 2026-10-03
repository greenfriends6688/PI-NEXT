"use client";

import { useEffect } from "react";

/**
 * 触发后复读几何的间隔（毫秒）。中文/日文 IME 的键盘高度是分段落的，取上游那串。
 */
const SETTLE_DELAYS_MS = [48, 120, 240, 420, 720];

interface ViewportHeightState {
  hasFocusedEditable: boolean;
  innerHeight: number;
  viewportHeight: number;
  viewportScale: number;
}

/**
 * fork:viewport-keyboard-settle（用户 2026-10-02，对齐上游 0.10）—— 两条修正：
 *
 *  1. **60px 阈值**：Safari 工具栏与安全区变化也差几十像素，原来的 `> 1` 会把页面滚动
 *     误判成「键盘开了」，于是随手一滚就改高度（用户看到输入框跳动）。
 *  2. **按缩放后的高度比**：页面缩放本身会把 visual viewport 变成
 *     `innerHeight / scale`；拿未缩放的 `innerHeight` 去比，任何缩放过的页面都会被判成
 *     「键盘开着」，而 iOS 的自动缩放（输入框聚焦时）恰恰会让那次 resize 被跳过 ——
 *     结果就是输入框留在真实键盘后面（上游同款注释）。
 */
export const KEYBOARD_MIN_HEIGHT_PX = 60;

export function shouldUseVisualViewportHeight({
  hasFocusedEditable,
  innerHeight,
  viewportHeight,
  viewportScale,
}: ViewportHeightState): boolean {
  if (!hasFocusedEditable) return false;
  const scale = viewportScale > 0 ? viewportScale : 1;
  return innerHeight / scale - viewportHeight > KEYBOARD_MIN_HEIGHT_PX;
}

function hasFocusedEditableElement(): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;

  return activeElement.isContentEditable
    || activeElement.tagName === "INPUT"
    || activeElement.tagName === "SELECT"
    || activeElement.tagName === "TEXTAREA";
}

/**
 * Keep the app height aligned with the visual viewport while a mobile keyboard
 * is open. iOS standalone PWAs can leave 100dvh at the layout viewport height,
 * which puts the composer behind the keyboard and may scroll the page itself.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;
    let frameId: number | null = null;
    // fork:viewport-keyboard-settle —— WebKit 收起键盘时可能**一个 visualViewport 事件都不发**，
    // 或者只在动画中途发一次。所以每个触发点之后密集复读几遍几何，让布局落到 WebKit
    // 最终稳定下来的那个值，而不是动画中间值（上游 SETTLE_DELAYS_MS）。
    const settleTimers = new Set<number>();
    let settleChainRunning = false;
    const runSettleChain = () => {
      if (settleChainRunning) return;
      settleChainRunning = true;
      let index = 0;
      const step = () => {
        if (index >= SETTLE_DELAYS_MS.length) {
          settleChainRunning = false;
          return;
        }
        const delay = SETTLE_DELAYS_MS[index++];
        const timer = window.setTimeout(() => {
          settleTimers.delete(timer);
          update();
          step();
        }, delay);
        settleTimers.add(timer);
      };
      step();
    };

    const update = () => {
      frameId = null;
      const keyboardOpen = shouldUseVisualViewportHeight({
        hasFocusedEditable: hasFocusedEditableElement(),
        innerHeight: window.innerHeight,
        viewportHeight: viewport.height,
        viewportScale: viewport.scale,
      });
      if (keyboardOpen) {
        root.style.setProperty("--app-viewport-height", `${viewport.height}px`);
      } else {
        root.style.removeProperty("--app-viewport-height");
      }
      // fork:ui-13 — lets app/fork-ui.css drop chrome that would otherwise sit
      // under the keyboard (upstream 0.14.6 does the same with `html.keyboard-open`).
      root.classList.toggle("keyboard-open", keyboardOpen);

      const pageWasShifted = window.scrollX !== 0 || window.scrollY !== 0;
      const isUnscaled = Math.abs(viewport.scale - 1) < 0.01;
      if (pageWasShifted && isUnscaled) {
        window.scrollTo(0, 0);
      }
    };

    // WebKit can dispatch the resize event before visualViewport.height has
    // settled, especially when an installed PWA dismisses the keyboard. Reading
    // it on the next animation frame prevents the keyboard-height CSS value
    // from remaining after the keyboard has closed.
    const scheduleUpdate = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(update);
      runSettleChain();
    };

    // IME 候选条会改键盘高度，却不一定发 visualViewport 事件。
    const onEditableActivity = () => {
      if (!hasFocusedEditableElement()) return;
      scheduleUpdate();
    };

    scheduleUpdate();
    viewport.addEventListener("resize", scheduleUpdate);
    viewport.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("focusin", scheduleUpdate);
    window.addEventListener("focusout", scheduleUpdate);
    window.addEventListener("pageshow", scheduleUpdate);
    document.addEventListener("compositionstart", onEditableActivity);
    document.addEventListener("compositionupdate", onEditableActivity);
    document.addEventListener("compositionend", onEditableActivity);
    document.addEventListener("input", onEditableActivity);

    return () => {
      viewport.removeEventListener("resize", scheduleUpdate);
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("focusin", scheduleUpdate);
      window.removeEventListener("focusout", scheduleUpdate);
      window.removeEventListener("pageshow", scheduleUpdate);
      document.removeEventListener("compositionstart", onEditableActivity);
      document.removeEventListener("compositionupdate", onEditableActivity);
      document.removeEventListener("compositionend", onEditableActivity);
      document.removeEventListener("input", onEditableActivity);
      for (const timer of settleTimers) window.clearTimeout(timer);
      settleTimers.clear();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      root.style.removeProperty("--app-viewport-height");
      root.classList.remove("keyboard-open");
    };
  }, []);
}
