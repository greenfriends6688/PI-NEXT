"use client";

import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";

/*
 * fork:v5-wave-b-sysstate —— 应用级错误态（页签级 + 段级）。
 *
 * fork:fastvibe-stack (L8) —— 从 `.m-*` 迁到 Tailwind + `components/ui/button`。
 *
 * 为什么可以迁：这两个组件**只有 PWA 形态**（`.m-*` 只在 ≤639px 生效），
 * 而它们在窄屏之外也真的会被渲染（`app/error.tsx` / `TabErrorBoundary.tsx`
 * 在任何视口都可能命中）。旧写法在桌面上拿到的是**没有样式的裸 DOM**
 * （`.m-empty` 那些规则全在 `@media (max-width: 639px)` 里）—— 也就是
 * 「桌面上一崩就是一个没排版的错误页」。换成 Tailwind 之后两种视口同一套。
 *
 * 两条判据照旧（M-11 的原文）：
 *   · **两级都必须给「重试」**，错误页不许只给一颗按钮，也不许白屏；
 *   · 一级行动钮比次要动作高一档（FastVibe 的 Button 也分 default / outline）。
 *
 * 触控下限：按钮走 `h-11`（44px）与 `h-12`（48px，一级）—— 与 FastVibe 的
 * `pointer-coarse:h-*` 同档，且是**真实高度**而不是 `::after` 外扩（外扩在
 * 这屏上会与相邻按钮的命中区重叠）。
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

/** 页签级（`components/TabErrorBoundary.tsx`）。 */
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
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center"
      style={style}
    >
      <span className="mb-1 grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
        <i data-ico="triangle-alert" data-size="20" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-80 text-xs leading-5 text-muted-foreground">{hint}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {actions.map((action) => (
          <PwaErrorButton key={action.key} action={action} />
        ))}
      </div>
    </div>
  );
}

/** 段级（`app/error.tsx`），带 digest。 */
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
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center"
      style={style}
    >
      <span className="mb-1 grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <i data-ico="triangle-alert" data-size="22" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-80 text-xs leading-5 text-muted-foreground">{hint}</p>
      {digest && (
        <div className="mt-2 w-full max-w-md overflow-hidden rounded-lg border border-border bg-card text-left">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{digestLabel}</span>
            <span className="font-mono">digest</span>
          </div>
          <div className="px-3 py-2 font-mono text-xs break-all text-muted-foreground">{digest}</div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {actions.map((action) => (
          <PwaErrorButton key={action.key} action={action} />
        ))}
      </div>
    </div>
  );
}

function PwaErrorButton({ action }: { action: PwaErrorAction }) {
  const primary = action.variant === "primary";
  return (
    <Button
      type="button"
      variant={primary ? "default" : "outline"}
      // 一级行动钮 48px、次要 44px —— 都在触控下限之上，且是真实高度。
      className={primary ? "h-12 gap-1.5 px-4" : "h-11 gap-1.5 px-3"}
      onClick={action.onClick}
      disabled={action.disabled}
    >
      <i data-ico={action.icon} data-size="13" aria-hidden="true" />
      {action.label}
    </Button>
  );
}
