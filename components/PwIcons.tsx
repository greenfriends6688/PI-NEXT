"use client";

import { useEffect } from "react";
// fork:icons-manual —— **必须排在 icons.js 前面**：它把画板文件末尾那次自跑关掉
// （自跑会赶在 React 认领流式片段之前改 DOM → hydration mismatch）。
import "./pw-icons-manual";
// fork:design-components —— 设计画板的图标集**原样进 client bundle**：
// 这是一次副作用 import，执行后 window.Icons = { paths, svg, hydrate }。
// 产品组件里直接写 <i data-ico="check" data-size="12"></i>，与画板 HTML 同一写法。
import "../design/pi-web-design/assets/icons.js";

declare global {
  interface Window {
    Icons?: { hydrate: (root?: ParentNode) => void };
  }
}

function hydrateInto(el: Element) {
  const Icons = window.Icons;
  if (!Icons) return;
  // hydrate(scope) 只扫 scope **内部**的 [data-ico]；
  // 新增节点自身就是 <i data-ico> 时退到父级扫一遍（data-ico-done 防重复，开销可控）。
  if (el.matches("[data-ico]")) {
    Icons.hydrate(el.parentElement ?? document.body);
  } else {
    Icons.hydrate(el);
  }
}

/**
 * 挂在根布局的图标 hydrator：把 DOM 里所有 <i data-ico> 替换成
 * design/pi-web-design/assets/icons.js 里的 lucide SVG（16px / stroke 1.5 默认）。
 * MutationObserver 兜住流式渲染新增的节点（转录、菜单、弹层都是动态插入）。
 */
export function PwIcons() {
  useEffect(() => {
    window.Icons?.hydrate();
    const mo = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) hydrateInto(node);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return null;
}
