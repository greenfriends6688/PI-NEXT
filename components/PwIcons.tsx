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
    Icons?: {
      hydrate: (root?: ParentNode) => void;
      svg: (name: string, size: number, stroke: number) => string;
    };
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

/** 已画上去的那枚字形由 `名字:尺寸:线宽` 记在 `data-ico-done` 上；与它一致就什么都不做。
 *  icons.js 的 `hydrate` 写的是字面量 `"1"`，那也照样重画一次（幂等）。 */
function repaint(el: Element) {
  const Icons = window.Icons;
  const name = el.getAttribute("data-ico");
  if (!Icons || !name) return;
  const size = el.getAttribute("data-size") || "16";
  const stroke = el.getAttribute("data-stroke") || "1.5";
  const key = `${name}:${size}:${stroke}`;
  if (el.getAttribute("data-ico-done") === key) return;
  const html = Icons.svg(name, Number(size), Number(stroke));
  if (!html) return;
  el.innerHTML = html;
  el.setAttribute("data-ico-done", key);
}

/**
 * 挂在根布局的图标 hydrator：把 DOM 里所有 <i data-ico> 替换成
 * design/pi-web-design/assets/icons.js 里的 lucide SVG（16px / stroke 1.5 默认）。
 * MutationObserver 兜住流式渲染新增的节点（转录、菜单、弹层都是动态插入）。
 *
 * fork:icon-swap（用户 2026-10-05：「折叠子智能体的箭头为啥不跟着变」）—— 还要兜住
 * **属性**变化。`<i data-ico={collapsed ? "chevron-right" : "chevron-down"}>` 这类写法
 * 换的是同一个节点上的属性，React 不碰 React 不知道的那份 innerHTML，而 `hydrate()`
 * 又被 `data-ico-done` 挡掉 —— 于是整类「按状态换图标」的控件（折叠箭头 / 复制→check /
 * pin→pin-off / volume-x / loader）全都**冻在第一次渲染的那枚字形上**。全仓约 100 处，
 * 所以修在这一个 seam，而不是逐个把 `data-ico={x ? a : b}` 改写成别的东西。
 */
export function PwIcons() {
  useEffect(() => {
    window.Icons?.hydrate();
    const mo = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          if (mutation.target instanceof Element) repaint(mutation.target);
          continue;
        }
        if (mutation.type !== "childList") continue;
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) hydrateInto(node);
        });
      }
    });
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // 只认这三枚；`data-ico-done` 是 repaint 自己写的，不在名单里所以不会自激。
      attributeFilter: ["data-ico", "data-size", "data-stroke"],
    });
    return () => mo.disconnect();
  }, []);
  return null;
}
