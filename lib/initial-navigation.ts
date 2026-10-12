// fork:initial-navigation — upstream-port marker
import type { TabOpen } from "./tab-session";

export interface InitialNavigation {
  requestedCwd: string | null;
  sessionId: string | null;
  /** fork:upstream-0.12-sidebar-parity —— `sessionId` 是本标签页的记忆（withTabOpen），不是 URL 的 `?session=`（#1180）。 */
  sessionFromTab?: boolean;
  sidebarCollapsed: boolean;
}

export function getInitialNavigation(
  searchParams: Pick<URLSearchParams, "get">,
): InitialNavigation {
  const requestedCwd = searchParams.get("cwd")?.trim() || null;

  return {
    requestedCwd,
    sessionId: requestedCwd ? null : (searchParams.get("session") || null),
    sidebarCollapsed: searchParams.get("sidebar") === "collapsed",
  };
}

/**
 * Apply per-tab memory to a navigation snapshot that was taken from the URL
 * alone. Returns the same object when the URL already chose a cwd or session,
 * or when this tab has nothing stored.
 *
 * A remembered session fills `sessionId` and sets `sessionFromTab`. A
 * remembered new-session composer fills `requestedCwd` so reload shows that
 * UI instead of the previous chat.
 *
 * Call this after mount. Reading sessionStorage during the first client render
 * (including a `useState` initializer) makes SSR HTML diverge from the client
 * tree — sessionStorage is empty on the server — and React reports a
 * hydration text mismatch in the sidebar / placeholder.
 */
export function withTabOpen(
  navigation: InitialNavigation,
  tabOpen: TabOpen | null,
): InitialNavigation {
  if (navigation.requestedCwd || navigation.sessionId || !tabOpen) {
    return navigation;
  }
  if (tabOpen.kind === "session") {
    return { ...navigation, sessionId: tabOpen.sessionId, sessionFromTab: true };
  }
  return { ...navigation, requestedCwd: tabOpen.cwd };
}

/**
 * fork:upstream-0.12-sidebar-parity —— URL 的 `?session=` 要求的那个会话，或 null
 * （没有，或是本标签页记住的）。该会话已不在时什么都不顶替它：侧栏随后采纳的项目
 * 不恢复它的上次打开会话（那是项目切换的行为），也不把那个会话写进 URL（#1168）。
 * 只被本标签页记住的已消失会话，按新标签页的方式回退。
 */
export function linkedSessionId(navigation: InitialNavigation): string | null {
  return navigation.sessionFromTab ? null : navigation.sessionId;
}
