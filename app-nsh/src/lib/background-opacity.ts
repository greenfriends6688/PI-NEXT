// How solid the window's background is: pi-web's General setting
// (`hooks/useChatAppearance.ts` `--pane-alpha`). 100 is the solid desk; lower
// makes the window and its panes see-through to the computer desktop, which is
// why the shell turns the window transparent and keeps any backdrop material
// off (`screens/Shell.tsx`).
//
// The panes read `paneAlpha()` through getters in their styles, so a slider
// move repaints them without remaking anything.
import { pref } from "../state/prefs";

/** pi-web's key for the window background's opacity, in percent. */
export const BACKGROUND_OPACITY_PREF = "pi-background-opacity";
export const BACKGROUND_OPACITY_DEFAULT = 100;
export const BACKGROUND_OPACITY_MIN = 40;
export const BACKGROUND_OPACITY_MAX = 100;
export const BACKGROUND_OPACITY_STEP = 5;

/** The stored opacity, kept inside the slider's range. */
export function backgroundOpacity(): number {
  const value = Number(pref<number>(BACKGROUND_OPACITY_PREF, BACKGROUND_OPACITY_DEFAULT));
  if (!Number.isFinite(value)) return BACKGROUND_OPACITY_DEFAULT;
  return Math.max(BACKGROUND_OPACITY_MIN, Math.min(BACKGROUND_OPACITY_MAX, Math.round(value)));
}

/** The panes' alpha: 1 for a solid desk, 0.4 at the lowest setting. */
export function paneAlpha(): number {
  return backgroundOpacity() / 100;
}

/** Whether the window has to be see-through for the setting to show. */
export function windowIsTranslucent(): boolean {
  return backgroundOpacity() < BACKGROUND_OPACITY_DEFAULT;
}
