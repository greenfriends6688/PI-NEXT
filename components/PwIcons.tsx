"use client";

import { useEffect } from "react";
// fork:icons-manual —— **必须排在 icons.js 前面**：它把画板文件末尾那次自跑关掉
// （自跑会赶在 React 认领流式片段之前改 DOM → hydration mismatch）。
import "./pw-icons-manual";
// fork:fastvibe-stack (H3) —— Hugeicons 数据源（双轨共存）。
//
// `components/PwIcons.tsx` 是全仓唯一的图标渲染 seam（940 处 `<i data-ico>`
// 都走 `repaint()`）。H3 的做法是**换数据源、不换调用点**：映射表命中就用
// Hugeicons 画，未命中回落 icons.js 的 lucide 路径。于是可以按页、按组件
// 逐步验证，不会出现「换到一半图标全没了」。
//
// L 批次把调用点逐个改写成 `<HugeiconsIcon>` 后，本文件的 data-ico 分支与
// icons.js 一起退役（L10）。
import { ICON_MAP } from "@/lib/hugeicons-map";
import { hugeiconSvg } from "@/lib/hugeicons-render";
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
  // fork:fastvibe-stack (H3) —— 这里以前直接调 `Icons.hydrate()`（lucide 专用）。
  //
  // **那是 H3 接入时的真 bug**：`Icons.hydrate()` 会给每个节点写
  // `data-ico-done="1"`，而 `repaint()` 只在 key 不匹配时重画 —— 于是首屏的
  // 764 个图标全部被 lucide 抢先画完并标记为已完成，Hugeicons 路径一次都没走到
  // （实测：图标都画出来了，但字形全是 lucide 的，不报错，只是换库没生效）。
  //
  // 现在统一走 `repaint()`：它自己做 Hugeicons 优先 + lucide 回落的判断，
  // 并且写的 `data-ico-done` 是 `名字:尺寸:线宽`（比 icons.js 的字面量 `"1"` 更严），
  // 尺寸/线宽变化时能正确重画。
  const targets = el.matches("[data-ico]")
    ? Array.from(el.parentElement?.querySelectorAll("[data-ico]") ?? [el])
    : Array.from(el.querySelectorAll("[data-ico]"));
  for (const target of targets) repaint(target);
}

/** 已画上去的那枚字形由 `名字:尺寸:线宽` 记在 `data-ico-done` 上；与它一致就什么都不做。
 *  icons.js 的 `hydrate` 写的是字面量 `"1"`，那也照样重画一次（幂等）。 */
function repaint(el: Element) {
  const Icons = window.Icons;
  const name = el.getAttribute("data-ico");
  if (!name) return;
  const size = el.getAttribute("data-size") || "16";
  const stroke = el.getAttribute("data-stroke") || "1.5";
  const key = `${name}:${size}:${stroke}`;
  if (el.getAttribute("data-ico-done") === key) return;
  /* fork:fastvibe-stack (H3) —— Hugeicons 优先，未命中回落 lucide。

     命中时用的是 `hugeiconSvg()`，它产出的外层 `<svg>` 与 `Icons.svg()` 的
     逐字同形（viewBox / fill / stroke / stroke-width / aria 全部一致），所以
     `data-size` / `data-stroke` 与既有 CSS 选择器不用改一行。

     为什么不直接删掉 lucide 分支：映射表只覆盖产品实际用到的 152 个名字，
     画板专属的另 104 个不在里面；而且这正是「H3 只换数据源、不动 940 处
     调用点」这个分批策略的安全垫 —— 漏掉的名字只会画成原来的字形，不会空白。 */
  const huge = ICON_MAP[name as keyof typeof ICON_MAP];
  const html = huge
    ? hugeiconSvg(huge, Number(size), Number(stroke))
    : (Icons ? Icons.svg(name, Number(size), Number(stroke)) : "");
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
    // fork:fastvibe-stack (H3) —— 首屏不再调 `Icons.hydrate()`，理由见 `hydrateInto`。
    hydrateInto(document.body);
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
