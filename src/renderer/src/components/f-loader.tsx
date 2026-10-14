import type { JSX } from "react";
import pinextMark from "@/assets/pinext-mark.png";
import { i18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The PI NEXT mark breathing under a soft halo — the app's global loading mark.
 *
 * The mark is the shipped app icon (the gradient N on its white tile); the
 * halo is a blurred radial disc behind it, which keeps the loader legible on
 * both the light and the dark background. `index.html` paints the same mark in
 * its boot splash, which stays opaque until the restored conversation is ready.
 */
export function FLoader({
  className,
  label,
}: {
  className?: string;
  /** Accessible name; the mark is decorative chrome when a label is already shown. */
  label?: string;
}): JSX.Element {
  return (
    <span role="status" aria-label={label ?? (i18n.t("app:loading") as string)} className={cn("pn-loader size-11", className)}>
      <span className="pn-loader-glow" aria-hidden="true" />
      <img className="pn-loader-mark" src={pinextMark} alt="" aria-hidden="true" draggable={false} />
    </span>
  );
}
