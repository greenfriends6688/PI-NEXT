"use client";

import type { CSSProperties, JSX } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Loading03Icon,
  MultiplicationSignCircleIcon,
} from "@hugeicons/core-free-icons";
// fork:fastvibe-stack (H2) — 原版读 FastVibe 的 `@/stores/settings` + `@/lib/themes`
// （zustand store 的 themeMode/lightTheme/darkTheme + resolveTheme）。本仓的主题
// 状态在 `hooks/useTheme.ts`（useSyncExternalStore + localStorage `pi-theme`），
// 所以换成本仓的 hook —— 语义一样（都给出「当前显示的是亮还是暗」），只有一个答案。
import { useTheme } from "@/hooks/useTheme";

/**
 * shadcn's sonner, with the theme wired to this app's own.
 *
 * The generated component reads `next-themes`, which neither FastVibe nor this repo uses:
 * appearance lives in the theme layer, which writes the active theme's tokens onto
 * `<html>` and toggles the `dark` class. Outside a `ThemeProvider` `useTheme()` reports
 * "system", so a window pinned to 亮色 while the OS is dark would have handed sonner the
 * wrong one.
 *
 * The colours come from the CSS variables below, so a toast follows whichever theme is
 * active without naming any of them; `theme` only decides sonner's own light/dark class,
 * and it is read from `useTheme()` — the same source the rest of the shell uses, so there
 * is one answer to "which kind is showing".
 */

/**
 * The toast is drawn by us, not by sonner (`unstyled`). Sonner's own skin brings its own
 * font stack, a fixed 13px size, and description greys (`#3f3f3f` / `#e8e8e8`) that are
 * the same on every theme — so a toast was the one surface that ignored both the theme
 * and 界面字号. It now matches `PopoverContent` through the shared overlay surface:
 * translucent popover colour, a quiet border and desktop-style shadow, `rounded-lg`,
 * `text-sm` title over a muted `text-xs` description, and the type carried by the icon's
 * colour alone rather than a tinted card.
 *
 * `unstyled` drops only sonner's `[data-styled=true]` rules; stacking, swiping and the
 * enter/exit motion stay its own. The one visual rule of that set worth keeping is that a
 * toast stacked behind the front one hides its content — otherwise its text shows through
 * the peeking edge — so it is restated below.
 */
function Toaster({ ...props }: ToasterProps): JSX.Element {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      closeButton
      icons={{
        success: <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4 text-success" />,
        info: <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="size-4 text-info" />,
        warning: <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-4 text-warning" />,
        error: <HugeiconsIcon icon={MultiplicationSignCircleIcon} strokeWidth={2} className="size-4 text-destructive" />,
        loading: (
          <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="size-4 animate-spin text-muted-foreground" />
        ),
        close: <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />,
      }}
      // rem, so the column follows 界面字号 like everything else.
      style={{ "--width": "22rem" } as CSSProperties}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "overlay-surface group/toast flex w-(--width) items-start gap-2.5 rounded-lg bg-popover/95 p-3 pr-9 font-sans text-sm text-popover-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50 *:transition-opacity data-[expanded=false]:data-[front=false]:*:opacity-0",
          icon: "relative mt-0.5 flex size-4 shrink-0 items-center justify-center",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          title: "leading-5 font-medium",
          description: "text-xs leading-relaxed text-muted-foreground",
          actionButton:
            "h-6 shrink-0 self-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-hidden",
          cancelButton:
            "h-6 shrink-0 self-center rounded-md bg-muted px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-hidden",
          // Hover-revealed like the transcript's row actions, and always drawn on touch,
          // where there is no hover to reveal it. The colours are `!`: sonner's dark theme
          // paints the close button in one rule `unstyled` does not gate, and at four
          // attribute selectors it outranks any utility.
          closeButton:
            "absolute top-2.5 right-2.5 flex size-5 items-center justify-center rounded-md bg-transparent! text-muted-foreground! opacity-0 transition hover:bg-muted! hover:text-foreground! focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-hidden group-hover/toast:opacity-100 pointer-coarse:opacity-100",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
