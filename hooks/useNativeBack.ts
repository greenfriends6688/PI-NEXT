"use client";

import { useEffect, useRef } from "react";

import { isMobileShell, pushBackHandler } from "@/lib/mobile-shell";

/**
 * fork:mobile-shell —— 面板/弹层的 Android 系统返回键适配。
 *
 * `open` 时往返回栈注册一个「关闭自己」的处理器（`lib/mobile-shell.ts` 的注册表）；
 * 系统返回键按下时壳的 backButton 监听逐个问栈顶，本面板被问到了就关掉自己并消费
 * 这次返回。桌面/PWA 上返回栈没人问，注册是 no-op（isMobileShell 为 false 时不挂）。
 */
export function useNativeBack(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open || !isMobileShell()) return;
    return pushBackHandler(() => {
      closeRef.current();
      return true;
    });
  }, [open]);
}
