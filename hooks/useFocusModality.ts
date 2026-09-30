"use client";

import { useEffect } from "react";

/**
 * fix:field-focus-modality（用户裁定 2026-09-30）—— 输入模态标记。
 *
 * 设计规范 §1.4 写的是「焦点环 1.5px 强调色描边、偏移 1px，**只在键盘焦点时出现**」。
 * 但浏览器对文本框 / select 的 `:focus-visible` 在**鼠标点击**时同样命中（规范要求
 * 这类元素「总是需要可见的焦点指示」），所以「点一下输入框就套一个蓝框」这件事
 * 用纯 CSS 表达不出来。
 *
 * 这里把「上一次交互是鼠标还是键盘」写到 `html[data-focus-modality]`
 * （`pointer` | `keyboard`），样式层（`app/globals.css`）据此决定字段要不要画焦点框：
 *   · pointer —— 统一 `outline: none !important`，字段保持自己的边框色；
 *   · keyboard —— 各组件自己的 `:focus-visible` 规则照常生效。
 *
 * 只关心「键盘用户会看到焦点」的按键（Tab / 方向键 / Enter / Space 等）；
 * 纯字母输入不切换档位 —— 打字时焦点框不该突然跳出来。
 * 带修饰键的组合（⌘/Ctrl/Alt）也不切 —— 那是快捷键，不是焦点移动。
 */
const KEYBOARD_KEYS = new Set([
  "Tab",
  "Enter",
  " ",
  "Spacebar",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * 这次按键是否代表「键盘用户在移动焦点」—— 纯函数，便于单测。
 * 带修饰键的组合（⌘ / Ctrl / Alt）不算：那是快捷键，不是焦点移动。
 */
export function isKeyboardModalityKey(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return KEYBOARD_KEYS.has(event.key);
}

export function useFocusModality(): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!root.dataset.focusModality) root.dataset.focusModality = "pointer";

    const markPointer = () => {
      root.dataset.focusModality = "pointer";
    };
    const markKeyboard = (event: KeyboardEvent) => {
      if (isKeyboardModalityKey(event)) root.dataset.focusModality = "keyboard";
    };

    // 捕获阶段：即使某个组件 stopPropagation 也要先记下模态。
    window.addEventListener("pointerdown", markPointer, true);
    window.addEventListener("keydown", markKeyboard, true);
    return () => {
      window.removeEventListener("pointerdown", markPointer, true);
      window.removeEventListener("keydown", markKeyboard, true);
    };
  }, []);
}
