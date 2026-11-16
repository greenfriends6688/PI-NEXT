// The chat's reading column: pi-next's `--chat-content-width` (its General
// setting, `components/SettingsPanel.tsx`). The transcript, the composer and
// the stats strip share it, so narrowing the column narrows all three
// together, as the web app's CSS variable does.
//
// The preference is device-local (`state/prefs.ts`), like the font size.
import { pref } from "../state/prefs";

/** pi-web's key for the chat content's width. */
export const CHAT_WIDTH_PREF = "pi-chat-content-width";
export const CHAT_WIDTH_DEFAULT = 820;
export const CHAT_WIDTH_MIN = 640;
export const CHAT_WIDTH_MAX = 1200;
/** The slider's step: 20 points, so a drag lands on round numbers. */
export const CHAT_WIDTH_STEP = 20;

/** The stored width, kept inside the slider's range. */
export function chatContentWidth(): number {
  const value = Number(pref<number>(CHAT_WIDTH_PREF, CHAT_WIDTH_DEFAULT));
  if (!Number.isFinite(value)) return CHAT_WIDTH_DEFAULT;
  return Math.max(CHAT_WIDTH_MIN, Math.min(CHAT_WIDTH_MAX, Math.round(value)));
}
