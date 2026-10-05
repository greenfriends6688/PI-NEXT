"use client";

/*
 * fork:v5-landing Wave B —— PWA 形态的**底部面板**宿主。
 *
 * DOM 原样取自 `design/v5/pwa/boards/M-09` 与 `M-10` 的 `.m-sheet`
 * （`m-sheet-grab` › `m-sheet-title` › `m-sheet-body` › `m-pickbar` 动作行）
 * 与 `.m-scrim`：类名、嵌套层级、状态类一字不动，只把画板里的 `<div>` 换成
 * `<button>` / `<input>`，并把静态文案接到真实数据。
 *
 * 为什么走 portal：画板里 `.m-sheet` 的定位祖先是 `.m-phone-inner`
 * （`position: relative`）。产品里这些面板是**内嵌**在某页设置流里的，祖先链上
 * 没有任何 `position: relative` 的元素，`.m-sheet` 会退化成相对最近定位祖先
 * （甚至初始包含块）定位。所以外面套一层 `position: fixed; inset: 0` 的定位层
 * —— 铁律四允许的「几何定位 / z-index 层的摆放」，其余一律走 `var()`。
 * `.m-sheet` 自带 `max-height: 78%` 与 `display:flex`，高度上限因此落在视口上。
 *
 * `useDialogA11y` 的 ref 挂在宿主层而不是 `.m-sheet` 上：hook 把 ref 节点的
 * **兄弟**设为 inert，挂在 sheet 上时兄弟恰好是遮罩，「点遮罩即收」就死了
 * （2026-10-05 用户报告）；挂在宿主上兄弟是应用根，遮罩照常可点 —— 与
 * `DirectoryPicker` / `PwaComposerSheet` 同一口径。抓手同理换成可点的 button。
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useI18n } from "@/hooks/useI18n";

export function PwaSheet({
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
  /** 无障碍名；默认用 title 的纯文本。 */
  label?: string;
  /** 点遮罩 / Esc 都走它（行为不变，仍然由各调用方自己的 state 决定）。 */
  onClose: () => void;
  children: ReactNode;
  /** 底部动作行（`.m-pickbar`）。省略即不渲染这一层。 */
  footer?: ReactNode;
}) {
  // portal 只能在挂载后落 document.body；SSR 与首帧不渲染，避免 hydration 不一致。
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // 焦点 / inert 必须在根节点真的存在之后才交给 useDialogA11y，否则它只跑一次空转。
  const ready = open && mounted;
  const { dialogRef, dialogProps } = useDialogA11y({ open: ready, onClose });
  const { t } = useI18n();

  if (!ready) return null;

  return createPortal(
    <div
      ref={dialogRef}
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: "var(--nx-z-modal)" }}
    >
      {/* 画板 `.m-scrim`：点它即收面板（M-09 帧 A「点遮罩即收」）。 */}
      <div className="m-scrim is-open" onClick={onClose} />
      <div
        {...dialogProps}
        className="m-sheet is-open"
        style={{ pointerEvents: "auto" }}
        aria-label={label}
      >
        <button type="button" className="m-sheet-grab" aria-label={t("chat.close")} onClick={onClose} />
        <div className="m-sheet-title">{title}</div>
        <div className="m-sheet-body">{children}</div>
        {footer ? <div className="m-pickbar">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * `.m-sheet-row` 的两档：可点（`button`）与纯展示（`div`）。
 * 画板里两者同源，`is-on` 表示互斥选中（`.m-sheet-row.is-on` 自带 ✓）。
 */
export function PwaSheetRow({
  icon,
  label,
  desc,
  on,
  onClick,
  trailing,
  disabled,
  ariaLabel,
}: {
  icon?: string;
  label: ReactNode;
  desc?: ReactNode;
  on?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const body = (
    <>
      {icon ? <i data-ico={icon} data-size="16" aria-hidden="true" /> : null}
      <span className="m-setrow-body">
        <span className="m-setrow-t">{label}</span>
        {desc ? <span className="m-sheet-row-desc">{desc}</span> : null}
      </span>
      {trailing}
    </>
  );
  if (!onClick) {
    return <div className="m-sheet-row">{body}</div>;
  }
  return (
    <button
      type="button"
      className={`m-sheet-row${on ? " is-on" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {body}
    </button>
  );
}

/** `.m-switch`（`.on` 是状态类）—— 画板 M-09 帧 B「开关就是开关」。 */
export function PwaSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`m-switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    />
  );
}