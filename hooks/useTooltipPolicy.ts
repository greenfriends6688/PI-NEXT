"use client";

import { useEffect } from "react";

/**
 * fork:tooltip-policy —— 原生 `title` 提示的统一闸门（用户 2026-10-06 裁定）。
 *
 * 三条规则：
 *  1. **PWA（≤640px）一个都不留** —— 那一形态上没有 hover，窄窗口里弹出来的
 *     系统气泡只会盖住内容；
 *  2. **只留纯图标**（内部有 `[data-ico]` / `svg` / `img`）；
 *  3. 元素自己**不能有可见文字**（中文 / 英文 / 数字）—— 已经写着「保存」的按钮
 *     再弹一句「保存」是噪音；同理「6/6」这类计数芯片不需要解释。
 *
 * 为什么不在每个调用点删 `title`：全仓有几百处，逐个改既漏又散；规则本身是
 * 「**这个元素**该不该有提示」，所以在唯一的落点（指针悬停）判一次即可。
 *
 * 实现是 `pointerover` **捕获**阶段：不合格就把 `title` 摘下来存进 `data-*`，
 * `pointerout`（指针真的离开这个元素，不是进了它的子节点）再还回去。
 * 原生提示有几百毫秒延迟，所以摘得及；不扫 DOM、不挂 MutationObserver，
 * 代价只有悬停那一刻一次判断。还回去而不是永久删：窗口从窄屏拉回宽屏时
 * 提示要能回来。
 */

/** 窄屏形态的断点，与 `app/globals.css` / `hooks/useIsMobile.ts` 同一个值。 */
export const PWA_QUERY = "(max-width: 640px)";
/** 存原值的属性名；`pointerout` 靠它找到「被我们摘过的」元素。 */
export const TITLE_STASH_ATTR = "data-fork-title-stash";
/** 可见文字：任何语言的字母或数字（标点、空格、图标字形不算）。 */
const VISIBLE_TEXT = /[\p{L}\p{N}]/u;
/** 「这是个图标」的判据：未水合的 `<i data-ico>`、水合后的 `<svg>`、或 `<img>`。 */
const ICON_SELECTOR = "[data-ico], svg, img";

/**
 * 这个元素该不该保留原生提示。纯函数，便于单测（DOM 接线在下面的 hook 里）。
 */
export function shouldKeepNativeTitle(input: {
  /** 元素自己的可见文字（`el.textContent`）。 */
  text: string;
  /** 元素里有没有图标。 */
  hasIcon: boolean;
  /** 当前是不是 PWA 形态。 */
  isPwa: boolean;
}): boolean {
  if (input.isPwa) return false;
  if (!input.hasIcon) return false;
  return !VISIBLE_TEXT.test(input.text);
}

function matchesPwa(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(PWA_QUERY).matches
    : false;
}

/** 挂在 AppShell 上一次即可。 */
export function useTooltipPolicy(): void {
  useEffect(() => {
    const decide = (el: Element) => shouldKeepNativeTitle({
      text: el.textContent ?? "",
      hasIcon: Boolean(el.querySelector(ICON_SELECTOR)),
      isPwa: matchesPwa(),
    });

    const onPointerOver = (event: Event) => {
      const target = event.target as Element | null;
      const el = target?.closest?.("[title]") as HTMLElement | null;
      // 已经摘过的不重复摘（否则会把空串当成原值存下去）。
      if (!el || el.hasAttribute(TITLE_STASH_ATTR) || decide(el)) return;
      el.setAttribute(TITLE_STASH_ATTR, el.getAttribute("title") ?? "");
      el.removeAttribute("title");
    };

    const onPointerOut = (event: Event) => {
      const target = event.target as Element | null;
      const el = target?.closest?.(`[${TITLE_STASH_ATTR}]`) as HTMLElement | null;
      if (!el) return;
      const next = (event as PointerEvent).relatedTarget as Node | null;
      // 只是进了自己的子节点：还不算离开，别把提示装回去。
      if (next && el.contains(next)) return;
      const stashed = el.getAttribute(TITLE_STASH_ATTR);
      el.removeAttribute(TITLE_STASH_ATTR);
      if (stashed !== null) el.setAttribute("title", stashed);
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
    };
  }, []);
}
