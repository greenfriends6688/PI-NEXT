// The session list, as pi-next's `SessionSidebar` / `SessionTree` build it:
// a search field, the pinned band, a group per project, the archive view, and
// the footer's way into it. A row is a family: subagent runs and side chats
// fold under their root behind a branch toggle. Each band shows its first
// families and a "show more" row. The rows are pi-next's 30-point session rows
// and 32-point group rows; pins, archive, project order and project display names
// come from the server's `session_ui_state` (`api/ui-state.ts`), the running
// and awaiting dots from `GET /api/agent/running`, and the content matches
// from `GET /api/sessions/search`.
//
// The look is the gallery's kit (`ui/kit`): `listRow` for every row (30 points
// here, its hover fill reaching 8 points past the content), `iconButtonLook`
// for the header and footer actions, `inputLook` for the search field, and
// every color and radius the kit's tokens. The numbers are pi-next's
// `app/v5/sidebar.css`: a 44-point header (0 6 0 12, gap 8), a 30-point
// search pill, 12.5-point session titles, 10.5-point times, 11-point captions
// at 0.04em, a 30-point footer with a hairline above it.
//
// NSH rules (`skills/nsh/references/tsx.md`): the component body runs once,
// every changing value is a binding read in JSX, `If` / `Each` for conditions
// and lists, and the chosen id lives in `state/session.ts`.
import { cleanup, computed, effect, platform, resource, Scroll, signal, Text, View, windowSize } from "nsh";
import { Button as BaseButton, Input } from "nsh/base";
import { listSessions, searchSessions, type SessionInfo } from "../../api/sessions";
import { formatShortRelativeTime } from "../../i18n/format";
import type { SessionSearchResult } from "../../api/types";
import { activeCwd, openSettings, revealEntry, selectedSessionId } from "../../state/session";
import {
  alpha,
  Button,
  colors,
  Icon,
  iconButtonGlyph,
  iconButtonLook,
  inputLook,
  listRow,
  Spinner,
  Tip,
  type IconName,
} from "../../ui/kit";
import { sans, sansStyle } from "../../ui/fonts";
import { locale, t } from "../../ui/i18n";
import { chooseSession, closeSidebar, freshSession, startFreshSession } from "../shell/state";
import { ProjectHeaderMenu, SessionRowMenu, type SessionMenuContext } from "./SessionRowMenu";
import {
  actionError,
  ARCHIVE_OLDER_THAN_MS,
  archiveView,
  buildSidebarModel,
  closeArchive,
  errorText,
  familiesToArchive,
  familyIds,
  familyMemberTitleOf,
  isFamilyAwaiting,
  isFamilyExpanded,
  isFamilyPinned,
  isFamilyRunning,
  isFamilyUnread,
  isGroupOpen,
  isSessionAwaiting,
  isSessionRunning,
  isSessionUnread,
  listSessionFamilies,
  liveRunningIds,
  markRead,
  markReadMany,
  moreShown,
  noteActivity,
  openArchive,
  PINNED_GROUP,
  PINNED_MORE_KEY,
  ARCHIVE_PREFIX,
  pinSession,
  projectNameOf,
  projectRootOf,
  refreshUiState,
  removedSessionIds,
  awaitingIds,
  sessionFilter,
  sessionListVersion,
  sessionTitleOf,
  setActionError,
  setSessionFilter,
  showLess,
  showMore,
  startRunningPoll,
  toggleFamily,
  toggleGroup,
  uiState,
  uiStateError,
  unreadIds,
  workspaceKeyOf,
  type SessionFamily,
  type SidebarGroup,
  type SidebarMore,
} from "./state";

/** pi-next's session row (`lib/session-tree.ts`: 30 on a desktop, 44 on a phone). */
const ROW_HEIGHT = platform.desktop ? 30 : 44;
/** A project group's header (32 on a desktop, 44 on a phone). */
const GROUP_HEIGHT = platform.desktop ? 32 : 44;
/** The sidebar's own metal, `sidebar.css`: a 44-point head, 8 in from its edge. */
const HEADER_HEIGHT = 44;
const LIST_PADDING = 8;
const TITLE_SIZE = platform.desktop ? 12.5 : 15;
const DETAIL_SIZE = platform.desktop ? 10.5 : 12;
/** The content search waits this long after the typing stops (pi-next: 300 ms). */
const SEARCH_DEBOUNCE_MS = 300;
/** `GET /api/sessions/search` refuses a longer query with a 400 (`route.ts:8-11`). */
const SEARCH_MAX_QUERY = 200;

/** Whether the sidebar is the phone's drawer (as in the shell). */
const drawerMode = () => platform.idiom === "phone" || windowSize().width < 768;

/** A row's trailing time, as pi-next's `.srow__trail` reads it: a compact
 * relative time in the reader's language (`i18n/format.ts`). */
function timeLabel(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  return formatShortRelativeTime(new Date(then), locale());
}

/**
 * A header or footer action: 26 points across on a desktop (pi-next's
 * `.app-icon-button`), 34 on a phone (its `.m-top` button), round, with
 * `iconButtonLook`'s hover and lit fill.
 */
function IconAction(props: { icon: IconName; label: string; onPress: () => void; side?: number; testID?: string }) {
  const look = iconButtonLook();
  const side = () => props.side ?? (platform.desktop ? 26 : 34);
  return (
    <BaseButton
      onPress={props.onPress}
      testID={props.testID}
      accessibilityLabel={props.label}
      tooltip={<Tip label={props.label} />}
      {...look}
      style={{ ...look.style, width: side(), height: side(), borderRadius: side() / 2 }}
    >
      <Icon name={props.icon} {...iconButtonGlyph()} size={platform.desktop ? 15 : 18} />
    </BaseButton>
  );
}

/** The small pin at a row's trailing edge: lit while the session is pinned. */
function PinAction(props: { pinned: () => boolean; id: string }) {
  const look = iconButtonLook({ on: props.pinned });
  return (
    <BaseButton
      onPress={() => void pinSession(props.id, !props.pinned())}
      accessibilityLabel={props.pinned() ? t("sidebar.unpin") : t("sidebar.pin")}
      selected={props.pinned()}
      {...look}
      style={{ ...look.style, width: 22, height: 22, borderRadius: 6 }}
    >
      <Icon name="star" {...iconButtonGlyph({ on: props.pinned })} size={11} />
    </BaseButton>
  );
}

/** A small state dot (running, waiting for input, unread). */
function Dot(props: { color: string; label: string }) {
  return (
    <View
      accessibilityLabel={props.label}
      style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: props.color }}
    />
  );
}

/**
 * A running row's mark: the kit's spinner (a native CSS animation, no timer
 * per row). Awaiting input keeps its own dot instead, as the callers decide.
 */
function RunningMark(props: { size: number }) {
  return (
    <View testID="session-running" accessibilityLabel={t("sidebar.agentRunning")}>
      <Spinner size={props.size} tint={colors.accent} />
    </View>
  );
}

/** The small branch mark on a family row: how many subagent runs/side chats it has. */
function FamilyToggle(props: { family: () => SessionFamily; expanded: () => boolean }) {
  const count = () => props.family().members.length;
  const label = () => t("sidebar.subagentsCount", { count: count() });
  const look = iconButtonLook({ on: props.expanded });
  return (
    <If when={count() > 0}>
      <BaseButton
        onPress={() => toggleFamily(props.family().root.id)}
        accessibilityLabel={`${label()}, ${props.expanded() ? t("i18n.collapse") : t("i18n.expand")}`}
        tooltip={<Tip label={label()} />}
        {...look}
        style={{ ...look.style, width: 30, height: 20, borderRadius: 6, gap: 2, flexDirection: "row" }}
      >
        <Icon name="merge" {...iconButtonGlyph({ on: props.expanded })} size={10} />
        <Text style={{ fontSize: 9.5, color: props.expanded() ? colors.accent : colors.faint, fontVariant: ["tabular-nums"] }}>
          {count()}
        </Text>
      </BaseButton>
    </If>
  );
}

/**
 * A hidden member of a family (a subagent run or a side chat), indented under
 * its root while the family is open. A press opens its own transcript.
 */
function FamilyMemberRow(props: { session: () => SessionInfo }) {
  const selected = () => selectedSessionId() === props.session().id;
  const running = () => isSessionRunning(props.session());
  const awaiting = () => isSessionAwaiting(props.session());
  const unread = () => isSessionUnread(props.session());
  const look = listRow({
    style: () => ({
      height: platform.desktop ? 26 : 36,
      minHeight: platform.desktop ? 26 : 36,
      paddingVertical: 0,
      paddingTop: 0,
      paddingLeft: 20,
      gap: 6,
      borderRadius: 7,
      ...(selected() ? { backgroundColor: alpha(colors.accent, 0.07) } : {}),
    }),
  });
  const open = () => {
    const session = props.session();
    chooseSession(session.id, session.cwd, familyMemberTitleOf(session));
    markRead(session.id);
    if (drawerMode()) closeSidebar();
  };
  return (
    <View
      onPress={open}
      testID={"subagent:" + props.session().id}
      accessibilityLabel={familyMemberTitleOf(props.session())}
      accessibilityState={{ selected: selected() }}
      style={look.style}
      hoverStyle={look.hoverStyle}
      activeStyle={look.activeStyle}
      focusVisibleStyle={look.focusVisibleStyle}
    >
      <Icon name="merge" size={10} tint={running() ? colors.accent : colors.faint} />
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: platform.desktop ? 11.5 : 14,
          color: selected() ? colors.text : colors.muted,
          numberOfLines: 1,
        }}
      >
        {familyMemberTitleOf(props.session())}
      </Text>
      <Text style={{ fontSize: DETAIL_SIZE, color: colors.faint, fontVariant: ["tabular-nums"], numberOfLines: 1 }}>
        {timeLabel(props.session().modified)}
      </Text>
      <If when={awaiting()}>
        <Dot color={colors.warn} label={t("sidebar.agentAwaitingInput")} />
      </If>
      <If when={!awaiting() && running()}>
        <RunningMark size={9} />
      </If>
      <If when={unread()}>
        <Dot color={colors.text} label={t("sidebar.newActivity")} />
      </If>
    </View>
  );
}

/**
 * One family row: the kit's `listRow` at pi-next's 30 points, a chat mark,
 * the root's title, then the subagent toggle, the time (or, in the pinned
 * band, the project's name) and the state dots. Selected when any member is
 * on screen, it takes pi-next's 9% accent tint and a 4% inner ring; a long
 * press or the row menu pins, archives, renames, forks, deletes the family.
 */
function SessionRow(props: {
  family: () => SessionFamily;
  context: SessionMenuContext;
  onChanged: () => void;
}) {
  const root = () => props.family().root;
  const selected = () => props.family().sessions.some((session) => selectedSessionId() === session.id);
  const pinned = () => isFamilyPinned(props.family());
  const running = () => isFamilyRunning(props.family());
  const awaiting = () => isFamilyAwaiting(props.family());
  const unread = () => isFamilyUnread(props.family());
  // Expanded is the user's choice (`expandedFamilies`), not data: a picked
  // subagent leaves the family as open as its arrow says.
  const expanded = () => isFamilyExpanded(root().id);
  const look = listRow({
    style: () => ({
      height: ROW_HEIGHT,
      minHeight: ROW_HEIGHT,
      paddingVertical: 0,
      paddingTop: 0,
      gap: 6,
      borderRadius: 8,
      ...(selected()
        ? {
            backgroundColor: alpha(colors.accent, 0.09),
            boxShadow: `inset 0 0 0 1px ${alpha(colors.accent, 0.04)}`,
          }
        : {}),
    }),
  });
  const open = () => {
    const session = root();
    chooseSession(session.id, session.cwd, sessionTitleOf(session));
    markReadMany(familyIds(props.family()));
    if (drawerMode()) closeSidebar();
  };
  return (
    <>
      <SessionRowMenu session={root} context={() => props.context} running={running} onChanged={props.onChanged}>
        <View
          onPress={open}
          testID="session-row"
          // A stable target for the test suite: the row's own id is unique per
          // session, and a test must not depend on which session the machine
          // happens to hold (titles change with history).
          accessibilityLabel={`${sessionTitleOf(root())}; ${t("sidebar.sessionActions")}`}
          accessibilityState={{ selected: selected() }}
          style={look.style}
          hoverStyle={selected() ? undefined : look.hoverStyle}
          activeStyle={look.activeStyle}
          focusVisibleStyle={look.focusVisibleStyle}
        >
          <Icon name="chat" size={12} tint={running() ? colors.accent : colors.faint} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: TITLE_SIZE,
              fontWeight: selected() ? "500" : "400",
              color: selected() ? colors.text : colors.muted,
              numberOfLines: 1,
            }}
          >
            {sessionTitleOf(root())}
          </Text>
          <FamilyToggle family={props.family} expanded={expanded} />
          <If when={selected() || pinned()}>
            <PinAction pinned={pinned} id={root().id} />
          </If>
          <Text
            style={{
              fontSize: DETAIL_SIZE,
              color: colors.faint,
              fontVariant: ["tabular-nums"],
              numberOfLines: 1,
            }}
          >
            {props.context === "pinned"
              ? projectNameOf(projectRootOf(root()))
              : timeLabel(props.family().latestModified)}
          </Text>
          <If when={awaiting()}>
            <Dot color={colors.warn} label={t("sidebar.agentAwaitingInput")} />
          </If>
          <If when={!awaiting() && running()}>
            <RunningMark size={10} />
          </If>
          <If when={unread()}>
            <Dot color={colors.text} label={t("sidebar.newActivity")} />
          </If>
        </View>
      </SessionRowMenu>
      <If when={expanded() && props.family().members.length > 0}>
        <Each of={props.family().members} key={(session) => session.id}>
          {(session) => <FamilyMemberRow session={session} />}
        </Each>
      </If>
    </>
  );
}

/** A band's "show more · N" / "show less" row, pi-next's 26-point `*-more` row. */
function MoreRow(props: { more: () => SidebarMore | null; onMore: () => void; onLess: () => void }) {
  return (
    <View
      style={{
        height: platform.desktop ? 26 : 36,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 8,
      }}
    >
      <If when={(props.more()?.hidden ?? 0) > 0}>
        <Button
          label={t("sidebar.showMore", { count: props.more()?.hidden ?? 0 })}
          variant="ghost"
          size="small"
          onPress={props.onMore}
        />
      </If>
      <If when={props.more()?.canShowLess === true}>
        <Button label={t("sidebar.showLess")} variant="ghost" size="small" onPress={props.onLess} />
      </If>
    </View>
  );
}

/**
 * A project group's header: the chevron and folder at 22, its name at 13,
 * the session count at 10.5, 32 points high. A press folds the group away.
 * Its menu (`ProjectHeaderMenu` around it) renames the project, moves it and
 * pins it.
 */
function GroupHeader(props: {
  group: () => SidebarGroup;
  open: () => boolean;
  onToggle: () => void;
  current?: () => boolean;
}) {
  const current = () => props.current?.() === true;
  const look = listRow({
    style: {
      height: GROUP_HEIGHT,
      minHeight: GROUP_HEIGHT,
      paddingVertical: 0,
      paddingTop: 0,
      paddingEnd: 4,
      gap: 6,
      borderRadius: 8,
    },
  });
  return (
    <View
      onPress={props.onToggle}
      accessibilityLabel={`${props.group().name}, ${props.open() ? t("i18n.collapse") : t("i18n.expand")}`}
      accessibilityState={{ expanded: props.open() }}
      style={look.style}
      hoverStyle={look.hoverStyle}
      activeStyle={look.activeStyle}
      focusVisibleStyle={look.focusVisibleStyle}
    >
      <View
        style={{
          width: 12,
          height: 12,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ rotate: props.open() ? "90deg" : "0deg" }],
        }}
      >
        <Icon name="chevron" size={11} tint={colors.faint} />
      </View>
      <Icon name={props.open() ? "folder-open" : "folder"} size={13} tint={colors.faint} />
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: platform.desktop ? 13 : 15,
          fontWeight: current() ? "500" : "400",
          color: current() ? colors.text : colors.muted,
          numberOfLines: 1,
        }}
      >
        {props.group().name}
      </Text>
      <If when={props.group().awaiting > 0}>
        <Dot color={colors.warn} label={t("sidebar.agentAwaitingInput")} />
      </If>
      <If when={props.group().awaiting === 0 && props.group().running > 0}>
        <RunningMark size={10} />
      </If>
      <If when={props.group().unread > 0}>
        <Dot color={colors.text} label={t("sidebar.newActivity")} />
      </If>
      <Text style={{ fontSize: DETAIL_SIZE, color: colors.faint, fontVariant: ["tabular-nums"] }}>
        {props.group().count}
      </Text>
    </View>
  );
}

/** The pinned band's header, as pi-next's `pinned-header`: 30 points, folded by a press. */
function PinnedHeader(props: { count: number; open: () => boolean; onToggle: () => void }) {
  return (
    <View
      onPress={props.onToggle}
      accessibilityLabel={`${t("sidebar.pinned")}, ${props.open() ? t("i18n.collapse") : t("i18n.expand")}`}
      accessibilityState={{ expanded: props.open() }}
      style={{ height: 30, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8 }}
      hoverStyle={{ backgroundColor: alpha(colors.text, 0.05) }}
    >
      <View
        style={{
          width: 12,
          height: 12,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ rotate: props.open() ? "90deg" : "0deg" }],
        }}
      >
        <Icon name="chevron" size={10} tint={colors.faint} />
      </View>
      <Text style={{ flex: 1, fontSize: 11, letterSpacing: 0.44, color: colors.faint }}>{t("sidebar.pinned")}</Text>
      <Text style={{ fontSize: DETAIL_SIZE, color: colors.faint, fontVariant: ["tabular-nums"] }}>{props.count}</Text>
    </View>
  );
}

/** A band caption ("Conversations", "Messages"): 11 points at 0.04em, pi-next's `.sec-head`. */
function BandLabel(props: { label: string; count?: number }) {
  return (
    <View style={{ height: 24, marginTop: 6, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={{ flex: 1, fontSize: 11, letterSpacing: 0.44, color: colors.faint }}>{props.label}</Text>
      <If when={props.count !== undefined}>
        <Text style={{ fontSize: DETAIL_SIZE, color: colors.faint, fontVariant: ["tabular-nums"] }}>{props.count}</Text>
      </If>
    </View>
  );
}

/** A footer action: pi-next's 30-point Settings / Archived rows over a hairline. */
function FooterRow(props: { icon: IconName; label: string; note?: string; onPress: () => void; testID?: string }) {
  return (
    <View
      onPress={props.onPress}
      testID={props.testID}
      accessibilityLabel={props.label}
      style={{ height: 30, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 8 }}
      hoverStyle={{ backgroundColor: alpha(colors.text, 0.05) }}
    >
      <Icon name={props.icon} size={14} tint={colors.faint} />
      <Text style={{ flex: 1, fontSize: 12.5, color: colors.muted, numberOfLines: 1 }}>{props.label}</Text>
      <If when={props.note}>
        <Text style={{ fontSize: DETAIL_SIZE, color: colors.faint, fontVariant: ["tabular-nums"] }}>
          {props.note ?? ""}
        </Text>
      </If>
    </View>
  );
}

/**
 * One content match (`GET /api/sessions/search`): the session and project it
 * belongs to, then the matched words in their context (`before` / `match` /
 * `after`, `lib/session-search.ts:11-26`). Its title and project share one
 * line so a match never reads as a second session row in the tree. A press
 * opens the session and asks the chat to scroll to the matched entry
 * (`?entryId=` in pi-next; `pendingEntryId` here).
 */
function SearchResultRow(props: { result: () => SessionSearchResult }) {
  const open = () => {
    const result = props.result();
    chooseSession(result.session.id, result.session.cwd, sessionTitleOf(result.session));
    // A title hit has no message entry to reveal.
    if (result.entryId) revealEntry(result.session.id, result.entryId);
    markRead(result.session.id);
    if (drawerMode()) closeSidebar();
  };
  const meta = () => {
    const result = props.result();
    const parts = [sessionTitleOf(result.session), projectNameOf(projectRootOf(result.session))];
    const time = timeLabel(result.session.modified);
    if (time) parts.push(time);
    return parts.join(" · ");
  };
  return (
    <View
      onPress={open}
      testID={"search:" + props.result().session.id}
      accessibilityLabel={meta()}
      style={{ paddingVertical: 5, paddingHorizontal: 8, gap: 2, borderRadius: 8 }}
      hoverStyle={{ backgroundColor: alpha(colors.text, 0.05) }}
      focusVisibleStyle={{ boxShadow: `inset 0 0 0 2px ${alpha(colors.accent, 0.5)}` }}
    >
      <Text style={{ fontSize: 11, color: colors.faint, numberOfLines: 1 }}>{meta()}</Text>
      <If when={!props.result().titleMatch}>
        <Text style={{ fontSize: 11.5, color: colors.muted, numberOfLines: 1 }}>
          {props.result().before}
          <Text style={{ fontWeight: "600", color: colors.text }}>{props.result().match}</Text>
          {props.result().after}
        </Text>
      </If>
    </View>
  );
}

export function SessionsPanel() {
  // The list paints while the sessions are read; `refetch` reloads it in place
  // (the value stays while loading), so a poll never blanks the sidebar.
  /** The search pill is closed until its icon is pressed (the header's magnifier). */
  const searchShown = signal(false);
  const sessions = resource(async () => await listSessions({ summary: true }));
  const rows = computed(() => {
    const list = sessions()?.sessions ?? [];
    const removed = removedSessionIds();
    return removed.length === 0 ? list : list.filter((session) => !removed.includes(session.id));
  });
  const model = computed(() =>
    buildSidebarModel({
      sessions: rows(),
      state: uiState(),
      running: liveRunningIds(),
      awaiting: awaitingIds(),
      unread: unreadIds(),
      query: sessionFilter(),
      selectedSessionId: selectedSessionId(),
      moreShown: moreShown(),
    }),
  );

  // The server-side half (pins, archive, project order and names) loads once;
  // the running poll then keeps it and the state dots in step with every
  // window. `cleanup` stops the poll when the panel goes away.
  effect(() => {
    void refreshUiState();
    const stop = startRunningPoll();
    cleanup(stop);
  });

  // The list changed elsewhere (a new session, a delete, a fork): reload it.
  effect(() => {
    const version = sessionListVersion();
    const loaded = sessions();
    if (version < 0 || !loaded) return;
    if (version !== loaded.sessionListVersion) sessions.refetch();
  });

  // Nothing chosen yet: open the most recent session, as `pi-web` does, so the
  // app never starts on an empty chat. A choice the user made is left alone,
  // and so is a fresh session the user asked for (`freshSession`).
  effect(() => {
    if (selectedSessionId() !== null) return;
    if (freshSession()) return;
    const first = model().pinned[0]?.root ?? model().groups[0]?.sessions[0];
    if (!first) return;
    chooseSession(first.id, first.cwd, sessionTitleOf(first));
  });

  // New activity on a session the user is not looking at: an unread dot.
  effect(() => {
    noteActivity(rows(), selectedSessionId());
  });

  // The content search runs 300 ms after the typing stops (pi-next's
  // `SessionSearch`), and only for a non-empty query; the resource aborts a
  // superseded request and keeps the last answer while loading.
  const searchQuery = signal("");
  effect(() => {
    const query = sessionFilter().trim();
    if (!query) {
      searchQuery.set("");
      return;
    }
    const timer = setTimeout(() => searchQuery.set(query), SEARCH_DEBOUNCE_MS);
    cleanup(() => clearTimeout(timer));
  });
  const search = resource(searchQuery, async (query, info) =>
    query && query.length <= SEARCH_MAX_QUERY ? await searchSessions(query, { signal: info.signal }) : null,
  );
  const contentQuery = computed(() => sessionFilter().trim());
  const searchReady = computed(() => searchQuery() === contentQuery() && !search.loading());
  const searchResults = computed(() => (searchQuery() === contentQuery() ? search() ?? null : null));
  // Results arrive newest first; consecutive sessions of one folder form one
  // group under the folder's name, as pi-next's `SessionSearch` groups them.
  const searchGroups = computed(() => {
    const value = searchResults();
    if (!value) return [];
    const groups: { key: string; cwd: string; items: SessionSearchResult[] }[] = [];
    for (const result of value.results) {
      const last = groups[groups.length - 1];
      if (last && last.cwd === result.session.cwd) last.items.push(result);
      else {
        groups.push({
          key: `${result.session.cwd}:${result.session.id}:${result.blockIndex}`,
          cwd: result.session.cwd,
          items: [result],
        });
      }
    }
    return groups;
  });

  // A press opens the fresh composer (the middle pane's NewSessionBar): the
  // folder and worktree are chosen there, before any session exists. Creating
  // the runtime session here skipped that step and started one in whatever
  // folder was last used.
  const startNewSession = () => {
    startFreshSession();
    if (drawerMode()) closeSidebar();
  };

  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.surface, ...sansStyle }}>
      {/* The header row (`sidebar.css`: 44 high, 0 6 0 12, gap 8): the brand
          and the new-session action, or the archive view's way back. */}
      <View
        style={{
          height: HEADER_HEIGHT,
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 12,
          paddingRight: 6,
        }}
      >
        <If when={archiveView()}>
          <IconAction icon="back" label={t("sidebar.backToSessions")} onPress={closeArchive} />
          <Text
            style={{
              flex: 1,
              fontSize: drawerMode() ? 15 : 13.5,
              fontWeight: "600",
              letterSpacing: drawerMode() ? -0.15 : 0.14,
              color: colors.text,
              numberOfLines: 1,
            }}
          >
            {t("sidebar.archived")}
          </Text>
          <Text style={{ fontSize: DETAIL_SIZE, color: colors.faint, fontVariant: ["tabular-nums"] }}>
            {model().archivedCount}
          </Text>
        </If>
        <If when={!archiveView()}>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              <View style={{ width: 12, height: 1.8, borderRadius: 0.9, backgroundColor: colors.text }} />
              <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: -5, backgroundColor: colors.accent }} />
            </View>
            <View style={{ width: 8, height: 1.8, borderRadius: 0.9, backgroundColor: colors.text }} />
          </View>
          <Text
            style={{
              flex: 1,
              fontSize: drawerMode() ? 15 : 13.5,
              fontWeight: "600",
              letterSpacing: drawerMode() ? -0.15 : 0.14,
              color: colors.text,
              numberOfLines: 1,
            }}
          >
            {drawerMode() ? t("sidebar.tabSessions") : "PI NEXT"}
          </Text>
          <IconAction
            icon="search"
            testID="search-toggle"
            label={t("sidebar.searchSessions")}
            onPress={() => {
              const next = !searchShown();
              searchShown.set(next);
              if (!next) setSessionFilter("");
            }}
          />
          <IconAction icon="plus" testID="new-session-now"
          label={t("i18n.newSession")} onPress={startNewSession} />
        </If>
      </View>

      {/* The search pill (`sidebar-search-trigger`: 30 high, 10 in, a full
          radius). It is there while its icon is on, and whenever a filter is
          set: closing the field never hides the filter that is running. */}
      <If when={searchShown() || sessionFilter() !== ""}>
        <View style={{ flexShrink: 0, paddingHorizontal: LIST_PADDING, paddingBottom: LIST_PADDING }}>
          <Input
            {...inputLook({
              // A native field takes the text's own font, not its parent's: the
              // app's font, Chinese first.
              style: { height: 30, borderRadius: 15, paddingHorizontal: 10, fontSize: platform.desktop ? 12 : 15, fontFamily: sans },
            })}
            value={sessionFilter()}
            onChange={({ value }) => setSessionFilter(value)}
            placeholder={t("sidebar.searchSessions")}
            testID="search-sessions"
            accessibilityLabel={t("sidebar.searchSessions")}
          />
        </View>
      </If>

      {/* A refused write (a pin, a rename, a fork) or the state read's error:
          the first with a Dismiss, the second with a Retry. */}
      <If when={uiStateError()}>
        <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: LIST_PADDING, paddingBottom: 6 }}>
          <Text style={{ flex: 1, fontSize: 11.5, color: colors.danger, numberOfLines: 2 }}>{uiStateError() ?? ""}</Text>
          <Button label={t("changes.retry")} variant="secondary" size="small" onPress={() => void refreshUiState()} />
        </View>
      </If>
      <If when={actionError()}>
        <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: LIST_PADDING, paddingBottom: 6 }}>
          <Text style={{ flex: 1, fontSize: 11.5, color: colors.danger, numberOfLines: 2 }}>{actionError() ?? ""}</Text>
          <IconAction icon="close" label={t("sidebar.dismiss")} onPress={() => setActionError(null)} />
        </View>
      </If>

      <Scroll
        style={{ flex: 1, minHeight: 0 }}
        contentStyle={{ paddingHorizontal: LIST_PADDING, paddingTop: 2, paddingBottom: LIST_PADDING }}
      >
        {/* The states under the list, in the pi-next order: an error first, then loading, then nothing. */}
        <If when={sessions.error()}>
          <View style={{ paddingVertical: 8, gap: 8 }}>
            <Text style={{ fontSize: 12, color: colors.danger }}>{errorText(sessions.error())}</Text>
            <Button label={t("changes.retry")} variant="secondary" size="small" onPress={() => sessions.refetch()} />
          </View>
        </If>
        <If when={sessions.loading() && !sessions()}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
            <Spinner size={12} tint={colors.accent} />
            <Text style={{ fontSize: 12, color: colors.muted }}>{t("sidebar.loading")}</Text>
          </View>
        </If>

        {/* The content matches (`GET /api/sessions/search?q=`), above the tree
            and grouped by project; the tree below keeps the name filter. */}
        <If when={contentQuery() !== ""}>
          <BandLabel label={t("sidebar.messages")} count={searchResults()?.results.length} />
          <If when={!searchReady()}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 8 }}>
              <Spinner size={11} tint={colors.accent} />
              <Text style={{ fontSize: 11.5, color: colors.muted }}>{t("sidebar.sessionSearching")}</Text>
            </View>
          </If>
          <If when={search.error()}>
            <Text style={{ paddingHorizontal: 8, paddingVertical: 4, fontSize: 11.5, color: colors.danger }}>
              {`${t("sidebar.sessionSearchFailed")}: ${errorText(search.error())}`}
            </Text>
          </If>
          <If when={searchReady() && searchResults()?.truncated}>
            <Text style={{ paddingHorizontal: 8, paddingVertical: 2, fontSize: 11, color: colors.faint }}>
              {t("sidebar.sessionSearchPartial")}
            </Text>
          </If>
          <If when={contentQuery().length > SEARCH_MAX_QUERY}>
            <Text style={{ paddingHorizontal: 8, paddingVertical: 4, fontSize: 11.5, color: colors.muted }}>
              {t("sidebar.sessionSearchTooLong", { count: SEARCH_MAX_QUERY })}
            </Text>
          </If>
          <If when={searchReady() && contentQuery().length <= SEARCH_MAX_QUERY && (searchResults()?.results.length ?? 0) === 0}>
            <Text style={{ paddingHorizontal: 8, paddingVertical: 4, fontSize: 11.5, color: colors.muted }}>
              {t("sidebar.sessionSearchEmpty")}
            </Text>
          </If>
          <Each of={searchGroups()} key={(group) => group.key}>
            {(group) => (
              <View>
                <View style={{ height: 22, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Icon name="folder" size={11} tint={colors.faint} />
                  <Text style={{ flex: 1, fontSize: 11, color: colors.faint, numberOfLines: 1 }}>
                    {projectNameOf(group().cwd)}
                  </Text>
                  <Text style={{ fontSize: DETAIL_SIZE, color: colors.faint, fontVariant: ["tabular-nums"] }}>
                    {group().items.length}
                  </Text>
                </View>
                <Each
                  of={group().items}
                  key={(result) => `${result.session.id}:${result.entryId ?? ""}:${result.blockIndex}`}
                >
                  {(result) => <SearchResultRow result={result} />}
                </Each>
              </View>
            )}
          </Each>
        </If>

        <If when={!archiveView()}>
          <If when={sessions.state() === "ready" && model().pinned.length === 0 && model().groups.length === 0}>
            <View style={{ paddingVertical: 8 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>
                {contentQuery() ? t("sidebar.sessionSearchEmpty") : t("sidebar.noLiveSessions")}
              </Text>
            </View>
          </If>

          {/* Pinned families on top, then a band per project: pi-next's tree,
              each band showing its first families and a "show more" row. */}
          <If when={model().pinnedCount > 0}>
            <PinnedHeader
              count={model().pinnedCount}
              open={() => isGroupOpen(PINNED_GROUP)}
              onToggle={() => toggleGroup(PINNED_GROUP)}
            />
            <If when={isGroupOpen(PINNED_GROUP)}>
              <Each of={model().pinned} key={(family) => family.root.id}>
                {(family) => (
                  <SessionRow family={family} context="pinned" onChanged={() => sessions.refetch()} />
                )}
              </Each>
              <If when={model().pinnedMore !== null}>
                <MoreRow
                  more={() => model().pinnedMore}
                  onMore={() => showMore(PINNED_MORE_KEY, model().pinnedMore?.nextShown ?? 0)}
                  onLess={() => showLess(PINNED_MORE_KEY)}
                />
              </If>
            </If>
          </If>

          <BandLabel label={t("sidebar.conversations")} />
          <Each of={model().groups} key={(group) => group.key}>
            {(group) => (
              <View>
                <ProjectHeaderMenu
                  group={group}
                  order={() => model().groups.map((entry) => entry.key)}
                  olderIds={() =>
                    familiesToArchive(
                      {
                        sessions: rows(),
                        state: uiState(),
                        running: liveRunningIds(),
                        unread: unreadIds(),
                        selectedSessionId: selectedSessionId(),
                      },
                      group().key,
                      ARCHIVE_OLDER_THAN_MS,
                      Date.now(),
                    )}
                  // Every session of the project, hidden families and the
                  // archive included: the group's window shows only a few.
                  allIds={() => listSessionFamilies(rows().filter((session) => workspaceKeyOf(session) === group().key))
                    .flatMap((family) => familyIds(family))}
                >
                  <GroupHeader
                    group={group}
                    open={() => isGroupOpen(group().key)}
                    onToggle={() => toggleGroup(group().key)}
                    current={() =>
                      group().families.some((family) =>
                        family.sessions.some((session) => selectedSessionId() === session.id))}
                  />
                </ProjectHeaderMenu>
                <If when={isGroupOpen(group().key)}>
                  <Each of={group().families} key={(family) => family.root.id}>
                    {(family) => (
                      <SessionRow family={family} context="group" onChanged={() => sessions.refetch()} />
                    )}
                  </Each>
                  <If when={group().more !== null}>
                    <MoreRow
                      more={() => group().more}
                      onMore={() => showMore(group().key, group().more?.nextShown ?? 0)}
                      onLess={() => showLess(group().key)}
                    />
                  </If>
                </If>
              </View>
            )}
          </Each>
        </If>

        {/* The archive: the families the user put away, by project, newest
            archive first; a project's header folds its rows away. */}
        <If when={archiveView()}>
          <BandLabel label={t("sidebar.conversations")} count={model().archivedCount} />
          <If when={model().archived.length === 0}>
            <View style={{ paddingVertical: 8 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>
                {contentQuery() ? t("sidebar.noArchivedMatch") : t("sidebar.noArchived")}
              </Text>
            </View>
          </If>
          <Each of={model().archived} key={(group) => group.key}>
            {(group) => (
              <View>
                <GroupHeader
                  group={group}
                  open={() => isGroupOpen(ARCHIVE_PREFIX + group().key)}
                  onToggle={() => toggleGroup(ARCHIVE_PREFIX + group().key)}
                />
                <If when={isGroupOpen(ARCHIVE_PREFIX + group().key)}>
                  <Each of={group().families} key={(family) => family.root.id}>
                    {(family) => (
                      <SessionRow family={family} context="archive" onChanged={() => sessions.refetch()} />
                    )}
                  </Each>
                </If>
              </View>
            )}
          </Each>
        </If>
      </Scroll>

      {/* The footer: the archive's way in (or back), then Settings, over a hairline. */}
      <View
        style={{
          flexShrink: 0,
          paddingHorizontal: LIST_PADDING,
          paddingVertical: 6,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <If when={archiveView()}>
          <FooterRow icon="back" label={t("sidebar.backToSessions")} onPress={closeArchive} />
        </If>
        <If when={!archiveView()}>
          <FooterRow
            icon="layers"
            label={t("sidebar.archived")}
            note={model().archivedCount > 0 ? String(model().archivedCount) : undefined}
            onPress={openArchive}
          />
        </If>
        <FooterRow
          icon="sliders"
          testID="open-settings"
          label={t("common.settings")}
          onPress={() => {
            openSettings();
            if (drawerMode()) closeSidebar();
          }}
        />
      </View>
    </View>
  );
}
