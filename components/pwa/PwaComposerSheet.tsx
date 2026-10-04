"use client";

/*
 * fork:v5-landing Wave B —— 输入卡那条线上的**底部面板**宿主（能力面板 / 模型面板）。
 *
 * DOM 原样取自 `design/v5/pwa/boards/M-01-conversation-drawer.html` 帧 C 与
 * `M-03-composer-sheet.html` 帧 A：
 *   `.m-scrim.is-open`（点遮罩即收）+
 *   `.m-sheet.is-open` › `.m-sheet-grab` › `.m-sheet-title` › `.m-sheet-body` ›（可选）`.m-pickbar`
 * 类名、嵌套层级、状态类一字不动，只把静态文案接到真实数据。
 *
 * 为什么走 portal：画板里 `.m-sheet` 的定位祖先是 `.m-phone-inner`
 * （`position: relative`）；产品的输入卡在聊天列里正常流中，祖先链上没有那个取景框，
 * `.m-sheet` 的 `position: absolute` 会退化成相对初始包含块定位。所以外面套一层
 * `position: fixed; inset: 0` 的定位层 —— 铁律四允许的「几何定位 / z-index 层的摆放」，
 * 其余一律走 `var()`。
 *
 * 行为（焦点约束 / Esc / 遮罩点一下即收）走既有 `useDialogA11y`，与桌面弹层同一套。
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogA11y } from "@/hooks/useDialogA11y";

export function PwaComposerSheet({
  open,
  title,
  label,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  /** `.m-sheet-title` 的内容（静态文案 → 真实数据）。 */
  title: ReactNode;
  /** 无障碍名；缺省用 title。 */
  label?: string;
  /** 点遮罩 / Esc 都走它（行为不变，仍由调用方自己的 state 决定）。 */
  onClose: () => void;
  children: ReactNode;
  /** 底部动作行（`.m-pickbar`）；省略即不渲染这一层。 */
  footer?: ReactNode;
}) {
  // portal 只能在挂载后落 document.body；SSR 与首帧不渲染，避免 hydration 不一致。
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const ready = open && mounted;
  const { dialogRef, dialogProps } = useDialogA11y({ open: ready, onClose });

  if (!ready) return null;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: "var(--nx-z-modal)" }}>
      <div className="m-scrim is-open" onClick={onClose} />
      <div
        ref={dialogRef}
        {...dialogProps}
        className="m-sheet is-open"
        style={{ pointerEvents: "auto" }}
        aria-label={label}
      >
        <div className="m-sheet-grab" />
        <div className="m-sheet-title">{title}</div>
        <div className="m-sheet-body">{children}</div>
        {footer ? <div className="m-pickbar">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * `.m-sheet-row`：可点（`button`）与纯展示（`div`）两档。
 * `is-on` 是画板点名的互斥选中态（`.m-sheet-row.is-on` 自带 ✓）。
 * 形状取自 M-01 帧 C「一行一个模型」：图标 + `m-setrow-body`（标题 + 副行）+ 右侧件。
 */
export function PwaComposerSheetRow({
  icon,
  title,
  desc,
  on,
  onClick,
  trailing,
  disabled,
  ariaLabel,
  className,
}: {
  icon?: string;
  title: ReactNode;
  desc?: ReactNode;
  on?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  /** 0-2-0 之外的逃生口：`.m-menu-row` 这类同构行形（能力面板里的三档列表）。 */
  className?: string;
}) {
  const cls = className ?? "m-sheet-row";
  const body = (
    <>
      {icon ? <i data-ico={icon} data-size="16" aria-hidden="true" /> : null}
      <span className="m-setrow-body">
        <span className="m-setrow-t">{title}</span>
        {desc ? <span className="m-sheet-row-desc">{desc}</span> : null}
      </span>
      {trailing}
    </>
  );
  if (!onClick) {
    return <div className={cls}>{body}</div>;
  }
  return (
    <button
      type="button"
      className={`${cls}${on ? " is-on" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {body}
    </button>
  );
}

/**
 * `.m-menu-row` + `.m-pop-foot`：浮层底部的说明行（M-03 帧 D-1「点一项即插入并收起」）。
 * 纯展示，不带交互。
 */
export function PwaPopFoot({ children }: { children: ReactNode }) {
  return <div className="m-pop-foot">{children}</div>;
}