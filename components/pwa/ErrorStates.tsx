"use client";

import type { CSSProperties } from "react";

/*
 * fork:v5-wave-b-sysstate —— PWA 形态的**应用级错误态**（M-11 帧 D ⑪ / 帧 F）。
 *
 * DOM 抄自 `design/v5/pwa/boards/M-11-gestures-states.html`：
 *   · 帧 D ⑪「错误页」= `.m-empty` / `.m-empty-ico` / `.m-empty-t` / `.m-empty-s`
 *     + `.m-btn.sm`（重试）+ `.m-btn.sm`（关闭）——这是**页签级**边界的形态；
 *   · 帧 F-1「段级 · app/error.tsx」= 同上，但 digest 走 `.m-code`
 *     （`.m-code-head` + `.m-code-body`），动作行是 `.m-pickbar` 里的
 *     `.m-btn.primary`（重试）+ `.m-btn`（重新加载）。
 *
 * M-11 的判据原文：**两级都必须给「重试」**，错误页不许只给一颗按钮，
 * 也不许出现白屏。这里两个组件都遵守。
 *
 * 触控下限（M-11 帧 C）：`.m-btn.sm` 的 `min-height` 是 `--nx-ctl-sm`（36px），
 * 低于硬下限，所以每个按钮都补 `.m-touch-44` —— 规格与实现读同一批类。
 * 这里只做 UA 归零 / 触控下限 / 尺寸，没有第二套视觉值。
 */

export interface PwaErrorAction {
  /** 稳定的 key，给 React 列表用。 */
  key: string;
  label: string;
  icon: string;
  onClick: () => void;
  /** `primary` 是重试那一颗；`plain` / `ghost` 是次要动作。 */
  variant?: "primary" | "plain" | "ghost";
  disabled?: boolean;
}

/** 帧 D ⑪：页签级（`components/TabErrorBoundary.tsx`）。 */
export function PwaTabErrorState({
  title,
  hint,
  actions,
  style,
}: {
  title: string;
  hint: string;
  actions: PwaErrorAction[];
  style?: CSSProperties;
}) {
  return (
    <div className="m-empty" role="alert" style={style}>
      <div className="m-empty-ico" style={{ color: "var(--nx-danger)" }}>
        <i data-ico="triangle-alert" data-size="20" aria-hidden="true" />
      </div>
      <div className="m-empty-t">{title}</div>
      <div className="m-empty-s">{hint}</div>
      <div className="m-pickbar" style={{ padding: 0, alignSelf: "stretch" }}>
        {actions.map((action) => (
          <PwaErrorButton key={action.key} action={action} />
        ))}
      </div>
    </div>
  );
}

/** 帧 F-1：段级（`app/error.tsx`），带 digest 的 `.m-code`。 */
export function PwaPageError({
  title,
  hint,
  digest,
  digestLabel,
  actions,
  style,
}: {
  title: string;
  hint: string;
  digest?: string;
  digestLabel: string;
  actions: PwaErrorAction[];
  style?: CSSProperties;
}) {
  return (
    <div className="m-empty" role="alert" style={style}>
      <div className="m-empty-ico" style={{ color: "var(--nx-danger)" }}>
        <i data-ico="triangle-alert" data-size="22" aria-hidden="true" />
      </div>
      <div className="m-empty-t">{title}</div>
      <div className="m-empty-s">{hint}</div>
      {digest && (
        <div className="m-code" style={{ width: "100%" }}>
          <div className="m-code-head">
            <span className="m-grow">{digestLabel}</span>
            <span className="m-mono">digest</span>
          </div>
          <div className="m-code-body m-mono">{digest}</div>
        </div>
      )}
      <div className="m-pickbar" style={{ padding: 0, alignSelf: "stretch" }}>
        {actions.map((action) => (
          <PwaErrorButton key={action.key} action={action} />
        ))}
      </div>
    </div>
  );
}

function PwaErrorButton({ action }: { action: PwaErrorAction }) {
  const variant = action.variant === "primary" ? "primary" : action.variant === "ghost" ? "ghost" : "";
  return (
    <button
      type="button"
      className={`m-btn sm m-touch-44${variant ? ` ${variant}` : ""}`}
      onClick={action.onClick}
      disabled={action.disabled}
    >
      <i data-ico={action.icon} data-size="13" aria-hidden="true" />
      {action.label}
    </button>
  );
}
