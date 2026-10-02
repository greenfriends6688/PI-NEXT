"use client";

import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * fork:ui-pop-portal — 渲染在 `<body>` 上的定值定位下拉。
 *
 * 以前侧栏的下拉（worktree 切换、项目 ⋯ 菜单）是 `position:absolute` 挂在滚动区
 * 里的行上：行靠近滚动区底部时浮窗要么被 `overflow` 裁掉、要么把滚动区撑长。
 * portal + fixed 让浮窗脱离所有裁切祖先；展开方向沿用 ModelSelector 的规则——
 * 下面放不下（<260px）才朝上，否则贴着触发点向下开。
 *
 * 2026-09-29 从 `SessionSidebar.tsx` 提出来：顶栏的「分支 / 工作区」芯片与
 * 「MCP / 插件」两枚图标浮窗要的是同一套定位与动画，复制一份必然走偏。
 */

export const DROPDOWN_ANIMATION_MS = 140;

export function AnimatedDropdown({ open, children, style, className }: { open: boolean; children: ReactNode; style: CSSProperties; className?: string }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let frame: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (open) {
      setMounted(true);
      setVisible(false);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timeout = setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      className={className}
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
        transformOrigin: "top center",
        transition: `opacity ${DROPDOWN_ANIMATION_MS}ms ease, transform ${DROPDOWN_ANIMATION_MS}ms ease`,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}

export function PortalDropdown({
  open,
  anchorRef,
  panelRef,
  className,
  width,
  align,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  panelRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  /** 期望宽度；缺省跟随触发点宽度。 */
  width?: number;
  /** right = 浮窗右缘对齐触发点右缘（⋯ 菜单）；left = 左缘对齐触发点左缘。 */
  align?: "left" | "right";
  children: ReactNode;
}) {
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null);
  const [above, setAbove] = useState(false);
  const [maxH, setMaxH] = useState(360);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const viewportH = window.innerHeight;
      const viewportW = window.innerWidth;
      const w = width ?? r.width;
      const spaceBelow = viewportH - r.bottom - 8;
      const spaceAbove = r.top - 8;
      // 与 ModelSelector 相同的规则：下方还有一段就不朝上。
      const openAbove = spaceBelow < 260 && spaceAbove > spaceBelow;
      setAbove(openAbove);
      setMaxH(Math.max(180, Math.min(openAbove ? spaceAbove : spaceBelow, viewportH * 0.6)));
      const left = align === "right"
        ? Math.max(8, Math.min(r.right - w, viewportW - w - 8))
        : Math.max(8, Math.min(r.left, viewportW - w - 8));
      setRect({ left, top: r.top, bottom: r.bottom, width: w });
    };
    update();
    window.addEventListener("resize", update);
    // 捕获阶段才能收到侧栏滚动容器的滚动。
    document.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [open, align, width, anchorRef]);

  if (!rect) return null;

  return createPortal(
    /* fork:ui-pop-portal-fix —— 这一层必须自己声明 z-index。
       portal 到 body 只解决「被祖先 overflow 裁掉」，不解决「被祖先盖住」：
       浮窗自己只有 `position: fixed` + `z-index: auto`，在根层叠上下文里是第 0 层，
       而 `.sidebar-container` 是 `position: relative; z-index: 200` —— 侧栏里的
       项目 ⋯ 菜单与 worktree 下拉于是被侧栏整块盖住：DOM 里有、点不到、看不见，
       表现就是「这一行点不动」。取 `--z-popover`(500)：在侧栏 200 / 分隔把手
       220-261 / 展开的文件视图 400 之上，模态 1000 之下。 */
    <div ref={panelRef} style={{ position: "relative", zIndex: "var(--z-popover)" }}>
      <AnimatedDropdown
        open={open}
        className={className}
        style={{
          position: "fixed",
          left: rect.left,
          width: rect.width,
          ...(above
            ? { bottom: window.innerHeight - rect.top + 6, maxHeight: maxH }
            : { top: rect.bottom + 6, maxHeight: maxH }),
          overflowY: "auto",
        }}
      >
        {children}
      </AnimatedDropdown>
    </div>,
    document.body,
  );
}

/** 点外部 / 按 Escape 关闭的通用判据（面板在 body 上，必须连同 panelRef 一起算）。 */
export function useDismissOnOutside(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, anchorRef, panelRef, close]);
}

/**
 * fork:pwa-sidebar-files —— 手机上专用的关闭判据，与 `useDismissOnOutside` 同签名。
 *
 * 差别只有两处，都是触摸设备上的实故障：
 *  1. `pointerdown` 取代 `mousedown`。触摸一次会先派发 `pointerdown` → `mousedown` →
 *     `mouseup` → `click`；旧判据在 `mousedown` 同步卸载面板，那一发 `click` 的目标
 *     已经不在 DOM 里，菜单项「点了没反应」（项目行 / 面板头的 ⋯ 都是这个症状）。
 *     `pointerdown` 之后浏览器仍会补上 `click`，面板能吃到这一下。
 *  2. Escape 走**捕获阶段**并跳过 `defaultPrevented` / `[role=dialog]` / `[aria-modal]`。
 *     抽屉自己的 Esc 监听在冒泡阶段，浮层的 Esc 也在冒泡阶段 —— 不加这层判据时，
 *     在 ⋯ 菜单里按一次 Esc 会先把菜单关掉、再被抽屉/设置弹层接手，两个界面一起消失。
 */
export function useDismissMenu(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Escape") return;
      const el = event.target as HTMLElement | null;
      if (el?.closest?.("[role=dialog], [aria-modal=true]")) return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, anchorRef, panelRef, close]);
}
