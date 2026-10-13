"use client";

import type { JSX, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * fork:fastvibe-stack (L1) —— 设置页的两个行原语，逐条对应 FastVibe 的
 * `src/renderer/src/components/settings/settings-group.tsx`。
 *
 * ## 为什么先搬这个
 *
 * FastVibe 的注释写得很直白：「Every pane in Settings renders its preferences
 * through these two, so a row in 关于, 通用 and 更新 cannot drift apart.」
 * 19 个分节的观感一致，靠的不是每页各自小心，而是**只有这两个出口**。
 * 所以 L1 的第一刀落在这里：先把出口建好，后面逐个迁分节时就只是「把内容塞进去」。
 *
 * ## 与本仓旧原语（`SettingsUi.tsx` 的 PwBlock / PwField）的关系
 *
 * 两者**并存**，不是替换：`PwBlock` / `PwField` 服务的是还没迁的 15 个分节
 * （它们的 DOM 是 `.d-set-row` / `.m-setrow`，有画板对位测试钉着）。
 * 新写的、或迁到 FastVibe 形态的分节用 `SettingsGroup` / `SettingsRow`。
 * 等 L10 清场时旧原语才删 —— 与「先共存、最后统一清」同一条裁定。
 *
 * ## 两条规格不是随手写的
 *
 * · **`SettingsRow` 的标题占 12rem（`basis-48`）且允许换行**：桌面上一行放得下，
 *   手机上一枚宽控件（44 单位的 select）会**落到标签下面**，而不是把标签挤成
 *   一行一个词。这是 FastVibe 原文注释里的理由，照抄。
 * · **`align="start"` 时控件上提 1 个单位（`-mt-1`）**：`align="start"` 是给
 *   「描述比一行高」的行用的（比如一串选项）。居中对齐时一枚 sm 控件（h-7）
 *   自己会落在 h-5 的标题行中间；换成 start 之后它顶到描述那一行，所以要提回来。
 */

export function SettingsGroup({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-2">
      {title ? <h3 className="px-1 text-sm font-medium">{title}</h3> : null}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  control,
  align = "center",
}: {
  title: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  align?: "center" | "start";
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-wrap justify-between gap-x-6 gap-y-2 px-4 py-3",
        align === "start" ? "items-start" : "items-center",
      )}
    >
      <div className="min-w-0 flex-1 basis-48">
        {typeof title === "string" ? (
          <span className="text-sm font-medium">{title}</span>
        ) : (
          <div className="flex items-center gap-1 text-sm font-medium">{title}</div>
        )}
        {description ? (
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {/* 见文件头注第 2 条：start 对齐时把控件提回标题行的高度。 */}
      <div className={cn("shrink-0", align === "start" && "-mt-1")}>{control}</div>
    </div>
  );
}
