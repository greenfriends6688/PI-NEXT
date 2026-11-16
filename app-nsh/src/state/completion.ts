// A finished turn's two signals: the chime and, while the app is not in front,
// the system notification.
//
// pi-web fires both when a run ends (`components/AppShell.tsx` `handleAgentEnd`,
// `components/ChatWindow.tsx`'s wrapped end): a stopped run did not finish
// anything, and one whose subagents still work did not finish the task. This
// app sees the same end as `agentRunning()` going true → false, which is what
// the chat's stream reports (`state/agent.ts`).
//
// The notification is per session: showing another with the same id replaces
// it, and a press brings the window forward and opens that session
// (`Notifications.on("press")`). What the press must open travels in a map,
// because a press can arrive in a later run of the app, where the id is all
// there is.
import { effect, lifecycle, untracked } from "nsh";
import { Notifications } from "nsh";
import { play } from "../ui/kit/sound";
import { t } from "../ui/i18n";
import { activeCwd, selectedSessionId } from "./session";
import { agentRunning } from "./agent";
import { sessionTitle } from "../screens/shell/state";
import {
  completionNotificationsEnabled,
  completionSoundEnabled,
  ensureNotificationPermission,
} from "../lib/completion-prefs";

/** What a press on a session's notification opens. */
interface NotificationTarget {
  sessionId: string;
  cwd: string;
  title: string;
}

/** The targets of the notifications this run showed, by notification id. */
const targets = new Map<string, NotificationTarget>();

/** The notification id of a session's completion (pi-web's tag, kept apart from other notifications). */
function completionId(sessionId: string): string {
  return `pi-session-complete:${sessionId}`;
}

/** The title a notification shows: the session's name, else the app's word. */
function notificationTitle(sessionId: string): string {
  const name = untracked(() => sessionTitle());
  return name && name.trim() ? name : t("i18n.sessionComplete");
}

/**
 * Shows the finished session's notification, if the user wants it, the system
 * takes it and the app is not the one in front (a notification while the reply
 * is on screen is noise).
 */
async function notifyFinished(sessionId: string): Promise<void> {
  if (!completionNotificationsEnabled()) return;
  if (lifecycle() === "active") return;
  const cwd = untracked(() => activeCwd()) ?? "";
  targets.set(completionId(sessionId), { sessionId, cwd, title: notificationTitle(sessionId) });
  try {
    await Notifications.show({
      id: completionId(sessionId),
      title: notificationTitle(sessionId),
      body: t("i18n.taskFinished"),
      // The chime above is the app's own; the system's would be a second one.
      silent: completionSoundEnabled(),
    });
  } catch {
    // Not granted, or no notification centre on this platform.
  }
}

/**
 * Watches the open session's run and fires the chime and the notification when
 * it ends. Mounted once by the shell (`screens/Shell.tsx`), whose body runs
 * once, so the state below lives for the app's life.
 */
export function watchCompletion(openSession: (sessionId: string, cwd: string, title: string) => void): () => void {
  let wasRunning = false;
  let ranSession: string | null = null;

  effect(() => {
    const running = agentRunning();
    const id = selectedSessionId();
    if (running) {
      wasRunning = true;
      ranSession = id;
      return;
    }
    if (!wasRunning) return;
    wasRunning = false;
    const finished = ranSession ?? id;
    ranSession = null;
    if (!finished) return;
    untracked(() => {
      if (completionSoundEnabled()) play("ready");
      void notifyFinished(finished);
    });
  });

  // Ask once at startup when the switch is on, as pi-web does: a notification
  // the system never allowed is a switch that lies.
  effect(() => {
    if (!completionNotificationsEnabled()) return;
    untracked(() => void ensureNotificationPermission());
  });

  // A press brings the app forward and opens the session the notification
  // named. The listener is app-wide (it also hears the notification that
  // started the app), so it stays for the app's life.
  let stop: (() => void) | null = null;
  try {
    stop = Notifications.on("press", (press) => {
      const target = targets.get(press.id);
      if (!target) return;
      targets.delete(press.id);
      openSession(target.sessionId, target.cwd, target.title);
      void Notifications.close(press.id).catch(() => undefined);
    });
  } catch {
    // No `notifications` capability: nothing to press.
    stop = null;
  }

  return () => stop?.();
}
