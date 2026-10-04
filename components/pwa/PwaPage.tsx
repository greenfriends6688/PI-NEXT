"use client";

/*
 * fork:v5-landing Wave B —— PWA 形态的一级页外壳。
 *
 * DOM 原样取自 `design/v5/pwa/boards/M-09`（商店 / 定时 / 用量三帧都是同一副骨架）：
 *   `.m-workspace`（定位层，画板里是 `.m-phone-inner`）
 *     › `.m-fade`（渐隐顶栏）
 *     › `.m-top`（返回 + 标题 + 右端动作）
 *     › `.m-settings` / `.m-store-body`（滚动正文，首行 108px 让给顶栏）
 *
 * 手机上这三块各自成页（不是 hub 卡片），所以这里给的是**页**而不是卡片。
 * 顶栏返回键只在 `onBack` 存在时渲染 —— 画板里那一格是「返回设置」，
 * 没有宿主就不该有一个按不动的按钮。
 */

import type { ReactNode } from "react";

export function PwaPage({
  title,
  onBack,
  backTitle,
  actions,
  children,
  /** `.m-settings`（设置流）/ `.m-store-body`（商店流）；默认 `.m-settings`。 */
  bodyClass = "m-settings",
}: {
  title: ReactNode;
  onBack?: () => void;
  backTitle?: string;
  /** 顶栏右端动作（`.m-top-btn`）。 */
  actions?: ReactNode;
  children: ReactNode;
  bodyClass?: string;
}) {
  return (
    <div className="m-workspace">
      <div className="m-fade" />
      <div className="m-top">
        {onBack ? (
          <button type="button" className="m-top-btn" title={backTitle} onClick={onBack}>
            <i data-ico="chevron-left" data-size="16" aria-hidden="true" />
          </button>
        ) : null}
        <span className="m-top-title m-grow">{title}</span>
        {actions}
      </div>
      <div className={bodyClass}>{children}</div>
    </div>
  );
}

/** `.m-banner`（+ `.warn` / `.err` 状态类）。M-09 三帧的口径行都走它。 */
export function PwaBanner({
  icon = "info",
  tone,
  children,
  role,
}: {
  icon?: string;
  tone?: "warn" | "err";
  children: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div className={`m-banner${tone ? ` ${tone}` : ""}`} role={role}>
      <i data-ico={icon} data-size="14" aria-hidden="true" />
      <span className="m-grow">{children}</span>
    </div>
  );
}

/**
 * `.m-setrow`（纯展示，`div`）+ `.m-setrow-body` + `.m-setrow-t` / `.m-setrow-s`。
 * 画板里带开关/徽章的行本体是 `<button>`，那种请用 `PwaSwitchRow`。
 */
export function PwaSetRow({
  icon,
  label,
  sub,
  trailing,
}: {
  icon?: string;
  label: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="m-setrow">
      {icon ? <i data-ico={icon} data-size="16" aria-hidden="true" /> : null}
      <span className="m-setrow-body">
        <span className="m-setrow-t">{label}</span>
        {sub ? <span className="m-setrow-s">{sub}</span> : null}
      </span>
      {trailing}
    </div>
  );
}

/** 带开关的 `.m-setrow`（画板 M-09 帧 B / M-05 帧 B 的标准行形）。 */
export function PwaSwitchRow({
  icon,
  label,
  sub,
  checked,
  onChange,
  switchLabel,
  disabled,
  trailing,
}: {
  icon?: string;
  label: ReactNode;
  sub?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 开关的无障碍名（画板里那枚 `.m-switch` 是纯视觉件，语义在整行上）。 */
  switchLabel: string;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="m-setrow"
      role="switch"
      aria-checked={checked}
      aria-label={switchLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      {icon ? <i data-ico={icon} data-size="16" aria-hidden="true" /> : null}
      <span className="m-setrow-body">
        <span className="m-setrow-t">{label}</span>
        {sub ? <span className="m-setrow-s">{sub}</span> : null}
      </span>
      {trailing}
      <span className={`m-switch${checked ? " on" : ""}`} aria-hidden="true" />
    </button>
  );
}

/**
 * `.m-pickbar` + `.m-picktag`：互斥多选。M-09 帧 B 的「每 30 分 / 每天 / 每晚 / 每周」
 * 与帧 C 的「7 天 / 30 天 / 全部」都是它 —— 手机上多一层下拉只为选三四个值是纯浪费。
 */
export function PwaPickBar({
  options,
  value,
  onChange,
  className,
}: {
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  return (
    <div className={`m-pickbar${className ? ` ${className}` : ""}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`m-picktag${option.value === value ? " is-on" : ""}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}