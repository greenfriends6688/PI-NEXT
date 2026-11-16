// The two completion switches: the chime a finished turn plays, and the
// system notification it shows while the app is in the background.
//
// pi-web keeps both in the browser's storage under the same keys
// (`lib/notification-preference.ts`, `hooks/useAudio.ts`), and both are on by
// default: the product always sent the notifications, it just had no switch
// and never asked for the permission.
import { pref, setPref } from "../state/prefs";
import { Notifications } from "nsh";

/** pi-web's key for the completion chime. */
export const COMPLETION_SOUND_PREF = "pi-completion-sound";
/** pi-web's key for the completion notification. */
export const COMPLETION_NOTIFICATIONS_PREF = "pi-completion-notifications";

/** On unless the user turned it off (a missing key reads as on, as pi-web does). */
export function completionSoundEnabled(): boolean {
  return pref<boolean>(COMPLETION_SOUND_PREF, true) !== false;
}

export function setCompletionSoundEnabled(on: boolean): void {
  setPref(COMPLETION_SOUND_PREF, on);
}

export function completionNotificationsEnabled(): boolean {
  return pref<boolean>(COMPLETION_NOTIFICATIONS_PREF, true) !== false;
}

/** Turns the notification on and, the first time, asks the system for permission. */
export function setCompletionNotificationsEnabled(on: boolean): void {
  setPref(COMPLETION_NOTIFICATIONS_PREF, on);
  if (on) void ensureNotificationPermission();
}

/**
 * Asks for the notification permission when that is still undecided. A build
 * that shows none (`"unavailable"`) and a platform that answers `"denied"`
 * are left alone: asking again changes nothing and only nags.
 */
export async function ensureNotificationPermission(): Promise<void> {
  try {
    const state = await Notifications.permission();
    if (state !== "default") return;
    await Notifications.requestPermission();
  } catch {
    // No `notifications` capability, or no notification centre: the switch
    // still shows, and the notification is simply not taken.
  }
}

/** Whether the system would take a notification now. */
export async function notificationsAllowed(): Promise<boolean> {
  try {
    return (await Notifications.permission()) === "granted";
  } catch {
    return false;
  }
}
