import type { JSX } from "react";
import appIconLight from "@/assets/app-icon-light.png";
import appIconDark from "@/assets/app-icon-dark.png";
import { cn } from "@/lib/utils";

/**
 * The PI NEXT mark — the same gradient N the app icon is built from.
 *
 * The asset here is the **transparent cut**, not the white tile the packaged icon uses,
 * because this one is drawn on the app's own surfaces. The `dark` swap is kept so a
 * theme-specific tile can land later without touching call sites.
 */
export function AppLogo({ className }: { className?: string }): JSX.Element {
  return (
    <>
      <img
        src={appIconLight}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn("dark:hidden", className)}
      />
      <img
        src={appIconDark}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn("hidden dark:block", className)}
      />
    </>
  );
}
