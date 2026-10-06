"use client";

import { useEffect } from "react";

/**
 * fork:instant-tip —— 悬浮提示**立刻**出现（用户 2026-10-05：「悬浮上去后立刻出现提示文字」）。
 *
 * 原生 `title` 的弹出延迟由浏览器 / 系统决定，页面上没有任何办法改它。所以这一层在指针
 * 进场那一刻把 `title` 挪到 `data-tip`（原生提示随即被取消，永远来不及弹），并用一块
 * fixed 图层自己画；指针 / 焦点离开时 `title` 原样还回去 —— 无障碍属性、浏览器可访问
 * 名称、源码里对 `title=` 的断言都不受影响。
 *
 * 图层挂现成的 `.d-pop-float`（浮层那件：底色 / 描边 / 圆角 / 阴影都是库里的），这里只
 * 补它没有的定位几何与「不吃指针」；`role="tooltip"` 是既有契约，`app/fork-mac-skeuo.css`
 * 的 Mac 拟物档早就按这个属性写好了底色，接上即生效。
 *
 * 不用任何依赖：一个 delegated 监听 + 一块图层，鼠标与键盘（focusin）共用一条路径。
 */

/** 借走 `title` 之后存放它的地方。名字与 `title` 不同，才不会又被原生提示捡回去。 */
const STASH = "data-tip";

export function InstantTooltip() {
  useEffect(() => {
    const layer = document.createElement("div");
    layer.setAttribute("role", "tooltip");
    layer.setAttribute("data-tip-layer", "");
    layer.className = "d-pop-float";
    document.body.appendChild(layer);

    let host: HTMLElement | null = null;

    const place = () => {
      if (!host) return;
      const box = host.getBoundingClientRect();
      const width = layer.offsetWidth;
      const height = layer.offsetHeight;
      // 默认落在下方；下方放不下就翻到上方，再夹进视口。
      const below = box.bottom + 6;
      const top = below + height <= window.innerHeight - 4 ? below : Math.max(4, box.top - height - 6);
      const left = Math.min(window.innerWidth - width - 4, Math.max(4, box.left + box.width / 2 - width / 2));
      layer.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    };

    const hide = () => {
      host = null;
      layer.removeAttribute("data-on");
    };

    const show = (el: HTMLElement) => {
      const title = el.getAttribute("title");
      if (title !== null) {
        el.setAttribute(STASH, title);
        el.removeAttribute("title");
      }
      const text = el.getAttribute(STASH) ?? "";
      // 空 / 纯空白的 `title` 一律不画（原生提示也不画）。
      if (!text.trim()) {
        hide();
        return;
      }
      host = el;
      layer.textContent = text;
      layer.setAttribute("data-on", "");
      place();
    };

    /** 把 `title` 还回去。React 在悬停期间改写了 `title`（新值已经落在属性上）时不还，
     *  否则会用借走的旧值把它盖掉。 */
    const giveBack = (el: HTMLElement) => {
      const stashed = el.getAttribute(STASH);
      if (stashed === null) return;
      if (!el.hasAttribute("title")) el.setAttribute("title", stashed);
      el.removeAttribute(STASH);
    };

    const enter = (event: Event) => {
      const from = event.target instanceof Element ? event.target.closest(`[title], [${STASH}]`) : null;
      if (!(from instanceof HTMLElement) || from === host) return;
      hide();
      show(from);
    };

    const leave = (event: Event) => {
      if (!host) return;
      // mouseout 与 focusout 都带 relatedTarget（鼠标 = 下一个鼠标目标，焦点 = 下一个拿到焦点的元素）。
      const to = (event as MouseEvent | FocusEvent).relatedTarget;
      if (to instanceof Node && host.contains(to)) return;
      const leaving = host;
      hide();
      giveBack(leaving);
    };

    const reposition = () => place();
    const cancel = () => hide();

    document.addEventListener("mouseover", enter);
    document.addEventListener("mouseout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("focusout", leave);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("keydown", cancel);

    return () => {
      document.removeEventListener("mouseover", enter);
      document.removeEventListener("mouseout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("focusout", leave);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("keydown", cancel);
      layer.remove();
    };
  }, []);
  return null;
}
