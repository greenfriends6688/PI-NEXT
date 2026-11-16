// The side-chat client: the fork route's `{ side: true }` call, and its
// refusals as i18n keys.
//
// pi-next keeps this in `lib/side-chat-client.ts`; the semantics are
// `docs/agents/side-sessions.md`: a side chat is a fork of the current branch
// whose tools are the parent's pin (or the tools its transcript recorded),
// with a hidden boundary message as the leaf. The server does all of that in
// `POST /api/sessions/[id]/fork` when the body says `side: true`; nothing here
// copies entries itself.
//
// The mapping is data only (no `t()`), so a caller can translate the key it
// gets without this module reading the locale.

import { ApiError } from "../api/client";
import { forkSideSession } from "../api/sessions";
import type { SessionInfo } from "../api/types";

/** The fork route's side-chat refusals (`lib/session-fork.ts` `SessionForkError`). */
export const SIDE_REFUSAL_KEYS: Record<string, string> = {
  not_found: "sideChat.error.notFound",
  unsaved: "sideChat.error.unsaved",
  empty: "sideChat.error.empty",
  subagent: "sideChat.error.subagent",
  side: "sideChat.error.side",
};

export type SideChatResult =
  | { ok: true; session: SessionInfo }
  | { ok: false; message: string; key?: string };

/**
 * Forks `sourceSessionId` into a side chat. `name` replaces the default title
 * (the route sanitizes it with `sideChatNameFromText`).
 */
export async function createSideChat(
  sourceSessionId: string,
  name?: string,
): Promise<SideChatResult> {
  try {
    const created = await forkSideSession(sourceSessionId, name);
    return { ok: true, session: created.session };
  } catch (error) {
    if (error instanceof ApiError) {
      const key = error.code ? SIDE_REFUSAL_KEYS[error.code] : undefined;
      return { ok: false, message: error.message, ...(key ? { key } : {}) };
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
