// The dock's two session-backed openings, shared by the sidebar and the chat:
// a side chat (a `{ side: true }` fork) and a subagent run's tab.
//
// Opening is not a tab-body concern: the sidebar row menu, the `Agent` tool
// card and the panel's own controls all call here, so the fork's refusal
// messages and the tab's default name are written once.

import { t } from "../../ui/i18n";
import { createSideChat } from "../../lib/side-chat-client";
import { pushToast } from "../overlays/state";
import { openPanelTab } from "./state";

/**
 * Forks `sourceSessionId` into a side chat and opens its tab. Answers whether
 * a tab was opened; a refusal is a toast (the route's code translated, else
 * the server's message), as pi-next shows it in its sidebar.
 */
export async function openSideChatTab(sourceSessionId: string, name?: string): Promise<boolean> {
  const result = await createSideChat(sourceSessionId, name);
  if (!result.ok) {
    pushToast(result.key ? t(result.key) : result.message, {
      title: t("sideChat.title"),
      tone: "danger",
    });
    return false;
  }
  // The route names a side chat `SIDE_SESSION_NAME` ("Side chat") until its
  // first prompt; that placeholder takes the reader's language in the tab.
  const raw = (result.session.name ?? "").trim();
  const title = raw && raw !== "Side chat" ? raw : t("sideChat.title");
  openPanelTab({ kind: "side", sessionId: result.session.id, name: title });
  return true;
}

/**
 * Opens (or selects) a subagent run's tab. `name` is what the `Agent` card
 * shows: the run's description, else its profile.
 */
export function openAgentTab(sessionId: string, name?: string): void {
  openPanelTab({ kind: "agent", sessionId, ...(name ? { name } : {}) });
}
