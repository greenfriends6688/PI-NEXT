// The chat pane: the transcript of `selectedSessionId()`, read from the session
// file, with the agent's live stream appended under it.
//
// The thread is the NSH gallery chat demo's (`examples/gallery/demos/Chat.tsx`,
// its `pane` and the `List` in it): a `List` laid out from the bottom
// (`alignment="bottom"`) whose
// `maintainVisibleContentPosition` follows a reply as it streams and keeps the
// rows on screen where they are when the reader scrolls up; a day's rows under
// a `DateSeparator`; the reply being written in the list's footer, above the
// composer; and a round button that springs in, over the list's bottom right,
// while the reader is scrolled up. Rows are `MessageView`s, as in the demo.
//
// What is ours is where the rows come from: the session file read by
// `readSession`, the agent's events folded into `state/agent.ts`, and the
// earlier pages the server's `?tail=` reads (`context.hasMore`). The demo's
// scripted scenarios, its offline banner, its "+" menu and its composer are
// not here — the composer is `screens/chat/Composer.tsx`, beside this pane.
//
// Scrolling is the list's: within `autoscrollToBottomThreshold` of its end it
// follows a growing reply by itself, and scrolled further up it keeps the rows
// on screen where they are. Nothing here adds up row heights.
import { computed, createAnimatedValue, effect, type JSX, keymap, List, type ListRef, resource, signal, Text, untracked, View } from "nsh";
import { readSession, readSessionContext } from "../../api/sessions";
import { chatContentWidth } from "../../lib/chat-width";
import { FIRST_PAINT_MESSAGES } from "../../lib/chat-lazy-load";
import { isMessageGroupAnchor } from "../../lib/message-display";
import { formatTurnDuration, getTurnDurationMs } from "../../lib/turn-duration";
import { locale, t } from "../../ui/i18n";
import { formatRelativeTime } from "../../i18n/format";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, ToolResultMessage } from "../../lib/types";
import {
  collapsesProcessDetails,
  countProcessActions,
  type ProcessActionCounts,
} from "../../lib/message-display";
import { getFinalAnswerViews, type FinalAnswerViews } from "../../lib/turn-views";
import {
  activeToolResults,
  agentPhase,
  agentRunning,
  applySessionView,
  compactError,
  compacting,
  connectAgentSession,
  dismissNotice,
  entryIds,
  extensionUi,
  messageKeys,
  messages,
  notices,
  openProcess,
  queuedMessages,
  reloadGeneration,
  resetChatState,
  retryInfo,
  streamingMessage,
  toggleProcess,
} from "../../state/agent";
import { sendPrompt } from "../../state/composer";
import { clearPendingEntry, pendingEntryId, revealEntry, selectedSessionId } from "../../state/session";
import { DateSeparator } from "../../ui/chat/parts";
import { errorText } from "../../ui/errors";
import {
  alpha,
  Badge,
  Button,
  colors,
  density,
  DisclosureChevron,
  Icon,
  IconTile,
  insetSurface,
  motion,
  Press,
  RoundButton,
  Row,
  Spinner,
  Status,
  toneTint,
} from "../../ui/kit";
import { sansStyle } from "../../ui/fonts";
import { enter } from "../../ui/motion";
import { ChatMinimap, minimapEnabled, toggleMinimap, type MinimapTurn } from "./ChatMinimap";
import { MessageView } from "./MessageView";
import { SessionTranscript } from "./SessionTranscript";
import { branchLeaf, branchRevision, BranchNavigator } from "./BranchNavigator";

/** How many entries the first read asks for (`?tail=`), as pi's chat does. */
const INITIAL_TAIL = 50;

/** The server clamps `?tail=` here (`app/api/sessions/[id]/route.ts`). */
const MAX_TAIL = 1000;

/** How near the end (in points) the list counts as following the stream. */
const FOLLOW_THRESHOLD = 40;

/** The demo's reading column: messages and the composer in 820 points at most. */
const THREAD_MAX_WIDTH = () => chatContentWidth();

/** A day's separator: it stays a row of its own between turns. */
type DateRow = { kind: "date"; key: string; timestamp: number };

/** One message the chat shows as its own block. */
type MessageRow = {
  kind: "message";
  /** Stable across a re-read of the file (`lib/message-keys.ts`). */
  key: string;
  message: AgentMessage;
  /** The session entry id, for the per-block state; undefined while a reply streams. */
  entryId: string | undefined;
  /** Its place in the transcript, for `getTurnDurationMs`. */
  index: number;
  /** First row of a turn: a prompt, a compaction summary, a subagent's notice. */
  turnStart: boolean;
  /** The turn's length, on the row that ends it (`lib/turn-duration.ts`). */
  durationMs?: number;
  /** The prompt this turn answered: what Retry and Regenerate send again. */
  prompt?: string;
};

/** A turn's rows under one fold; early turns start folded in a long session. */
type TurnRow = {
  kind: "turn";
  key: string;
  rows: MessageRow[];
  /** 1-based among the transcript's turns. */
  number: number;
  /** The rows start at a prompt or a custom message that owns a turn. */
  startsTurn: boolean;
  /** The transcript's last turn: a live run keeps it open. */
  last: boolean;
  /** The prompt's first line, for the fold's label. */
  prompt?: string;
  /** The turn's length, shown under its answer (pi-next's `.turn-meta`). */
  durationMs?: number;
};

/** One row of the list: a day separator, or a whole turn. */
type ChatRow = DateRow | TurnRow;

/**
 * The chat of the open session, or a placeholder when none is chosen.
 *
 * With `sessionId` it shows that session instead — the dock's side-chat tab
 * uses this — through a transcript scoped to the id (`SessionTranscript`),
 * because the main chat's live store belongs to exactly one session. The
 * default path (no prop) is unchanged: the open session, its stream and the
 * composer under it.
 */
export interface ChatViewProps {
  /** A session to show without taking over the main chat; default the open one. */
  sessionId?: string;
}

export function ChatView(props: ChatViewProps = {}) {
  return (
    <If when={props.sessionId} else={<MainChatView />}>
      <SessionTranscript sessionId={props.sessionId!} />
    </If>
  );
}

/** The main chat: `selectedSessionId()`'s transcript and its live run. */
function MainChatView() {
  return (
    // The chat's texts take the app's font (Chinese first) by inheritance.
    // Transparent: the dock pane's surface (and the General setting's
    // opacity, `lib/background-opacity.ts`) is what shows behind the thread.
    <View style={{ flex: 1, backgroundColor: "transparent", ...sansStyle }}>
      <If when={selectedSessionId()} else={<NoSession />}>
        <BranchNavigator />
        <ChatThread />
      </If>
    </View>
  );
}

function NoSession() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
      <IconTile name="chat" tint={colors.accent} size={48} />
      <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{t("chat.noSessionOpen")}</Text>
      <Text style={{ fontSize: density.body, color: colors.muted }}>{t("chat.chooseSession")}</Text>
    </View>
  );
}

function ChatThread() {
  /** How many entries the read asks for; doubled when the top is reached. */
  const tail = signal(INITIAL_TAIL);
  /** The user is at the end (the jump button hides while they are). */
  const following = signal(true);
  /** The turn the viewport is in, for the minimap's highlight. */
  const activeTurnKey = signal<string | null>(null);
  /** A longer tail is on its way (`loadEarlier`). */
  const loadingEarlier = signal(false);
  let list: ListRef | undefined;
  /** The session whose rows are already on screen, so a read lands at its end once. */
  let painted: string | null = null;
  /** The branch leaf whose row was already asked to be revealed. */
  let branchRevealed: string | null = null;
  /** A drag is in progress: only then does a scroll say whether the reader follows. */
  let dragging = false;

  // The load source: the session, how much of it, and a generation bumped by
  // anything that makes the file the truth again (`requestReload`). A branch
  // switch adds its leaf and a revision, so the sheet on screen is the new
  // path rather than the old one with another row highlighted.
  const source = computed(() => {
    const id = selectedSessionId();
    if (!id) return null;
    const requested = branchLeaf();
    return {
      id,
      tail: tail(),
      generation: reloadGeneration(),
      branch: branchRevision(),
      leafId: requested?.sessionId === id ? requested.leafId : undefined,
    };
  });

  const view = resource(source, async (asked, info) => {
    const loaded = await readSession(asked.id, {
      tail: asked.tail,
      leafId: asked.leafId,
      // Historical tool-result images and reasoning are lazy: the transcript
      // stays small, and `MessageView` reads a block when it is opened.
      deferThinking: true,
      deferMedia: true,
      signal: info.signal,
    });
    // The session route reports the wrapper's leaf; the live wrapper moved by
    // `navigate_tree` is that leaf already. A server that ignores `?leafId=`
    // (or a wrapper that went away between the command and this read) still
    // gets the requested branch from the context route, which names one.
    if (!asked.leafId || loaded.leafId === asked.leafId) return loaded;
    const page = await readSessionContext(asked.id, {
      leafId: asked.leafId,
      tail: asked.tail,
      deferThinking: true,
      deferMedia: true,
      signal: info.signal,
    });
    return { ...loaded, leafId: asked.leafId, context: page.context };
  });

  // Another session, or the same one opened again: nothing of the last belongs here.
  effect(() => {
    const id = selectedSessionId();
    // A reveal request for a session that is no longer (or not yet) the open
    // one waits for nothing: dropping it keeps a later open from jumping.
    const pending = pendingEntryId();
    if (pending && pending.sessionId !== id) untracked(() => clearPendingEntry());
    resetChatState();
    painted = null;
    branchRevealed = null;
    following.set(true);
    tail.set(INITIAL_TAIL);
    if (!id) return;
    // The stream of this session, until the session or the pane goes.
    return connectAgentSession(id);
  });

  // A read landed. Both the mount's and every reload's ("the file is the truth
  // after a stream"), superseded reads never reach here (`resource`).
  effect(() => {
    const loaded = view();
    if (!loaded || loaded.sessionId !== selectedSessionId()) return;
    applySessionView(loaded);
    // A branch switch names its leaf: the chat reveals it once the new branch
    // is the one on screen, not while the previous branch's rows still show it.
    const requested = branchLeaf();
    if (requested?.sessionId === loaded.sessionId && branchRevealed !== requested.leafId) {
      branchRevealed = requested.leafId;
      untracked(() => revealEntry(loaded.sessionId, requested.leafId));
    }
    // An earlier page has arrived: the hint above the rows goes. Read untracked:
    // an effect must not change a signal it reads.
    if (untracked(() => loadingEarlier())) loadingEarlier.set(false);
  });

  const rows = computed(() => groupTurns(buildMessageRows(messages(), entryIds(), messageKeys())));

  // The minimap's turns, with the titles the transcript already gives them.
  const turnItems = computed<MinimapTurn[]>(() => rows().flatMap((row) => (
    row.kind === "turn"
      ? [{
          key: row.key,
          number: row.number,
          label: turnTitle(row),
          prompt: row.prompt,
          answer: turnAnswer(row),
          tools: turnTools(row),
        }]
      : []
  )));

  // Following the stream: the newest turn is what the reader looks at. Scrolled
  // up, the list's viewability reports the turn in view instead.
  effect(() => {
    if (!following()) return;
    const turns = turnItems();
    const last = turns[turns.length - 1];
    if (last && untracked(() => activeTurnKey()) !== last.key) activeTurnKey.set(last.key);
  });

  // A jump from the minimap: the turn's row (a day separator may be above it),
  // scrolled near the top of the viewport.
  const jumpToTurn = (index: number): void => {
    const turn = turnItems()[index];
    if (!turn) return;
    const target = rows().findIndex((row) => row.kind === "turn" && row.key === turn.key);
    if (target < 0) return;
    // Land on the prompt's own row: the turn starts there, and its process
    // details may stay folded (as pi-next jumps to a turn's first message).
    activeTurnKey.set(turn.key);
    following.set(target >= rows().length - 1);
    const scroll = () => list?.scrollToIndex({ index: target, viewPosition: 0, animated: true });
    scroll();
    // The rows above an old turn are estimated until the list measures them;
    // a second pass lands with their real heights (the first can stop early).
    setTimeout(scroll, 320);
  };

  // The middle of what the list reports viewable names the turn in view; the
  // middle is nearer pi-next's 30%-of-the-viewport focus than the first row.
  const trackViewable = (event: { viewableItems: { index: number }[] }): void => {
    const anchor = event.viewableItems[Math.floor(event.viewableItems.length / 2)] ?? event.viewableItems[0];
    if (!anchor) return;
    const list = rows();
    if (list.length === 0) return;
    let target = -1;
    for (let index = Math.max(0, anchor.index); index < list.length; index++) {
      if (list[index].kind === "turn") {
        target = index;
        break;
      }
    }
    if (target < 0) {
      for (let index = Math.min(anchor.index, list.length - 1); index >= 0; index--) {
        if (list[index].kind === "turn") {
          target = index;
          break;
        }
      }
    }
    const row = target >= 0 ? list[target] : null;
    if (row?.kind === "turn") activeTurnKey.set(row.key);
  };

  // The turn map's switch, for a desktop's keyboard (the preference is the
  // state; `minimapEnabled` reads it in `ChatMinimap`).
  keymap.bind("mod+shift+m", () => toggleMinimap());

  // Every tool result of the session by call id, the live ones included: a card
  // finds its output whichever page of the transcript carries it.
  const toolResults = computed(() => {
    const results = new Map<string, ToolResultMessage>(activeToolResults());
    for (const message of messages()) {
      if (message.role === "toolResult") results.set(message.toolCallId, message);
    }
    return results;
  });

  // Open a session at its newest message. The list follows its own end while
  // rows measure, but it may still stand in another session's transcript.
  effect(() => {
    const id = selectedSessionId();
    if (!id || rows().length === 0 || painted === id) return;
    painted = id;
    requestAnimationFrame(() => {
      if (selectedSessionId() !== id) return;
      following.set(true);
      list?.scrollToEnd({ animated: false });
    });
  });

  // A search result (or a branch's leaf) names one entry to reveal: scroll to
  // its row once it is on screen, reading more of the branch when it is older
  // than the page on screen (pi-next's `searchTarget`, its `?entryId=`).
  let revealedEntry: string | null = null;
  effect(() => {
    const pending = pendingEntryId();
    if (!pending) {
      revealedEntry = null;
      return;
    }
    if (pending.sessionId !== selectedSessionId()) {
      // The request named a session that is no longer the open one.
      untracked(() => clearPendingEntry());
      return;
    }
    const index = rows().findIndex((row) => row.kind === "turn" && row.rows.some((message) => message.entryId === pending.entryId));
    if (index >= 0) {
      if (revealedEntry === pending.entryId) return;
      revealedEntry = pending.entryId;
      // A hit under a folded process group opens the group before the list
      // scrolls to it. Read untracked: this effect must not change a signal it
      // reads. Opening the fold changes the rows' heights, so the scroll waits
      // two frames for them to be measured.
      const turn = rows()[index] as TurnRow;
      const opening = untracked(() => !processOpen(turn));
      if (opening) toggleProcessFold(turn);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (pendingEntryId()?.entryId !== pending.entryId) return;
        // The rows may have grown an older page meanwhile: find it again.
        const currentRows = rows();
        const current = currentRows.findIndex((row) => row.kind === "turn" && row.rows.some((message) => message.entryId === pending.entryId));
        if (current < 0) return;
        // An older turn is now what the reader looks at, not the end; the last
        // row is the end unless a reply is still streaming under it.
        following.set(current < currentRows.length - 1 || streamingMessage() !== null);
        list?.scrollToIndex({ index: current, viewPosition: 0.5, animated: true });
        untracked(() => clearPendingEntry());
      }));
      return;
    }
    const loaded = view();
    if (!loaded || loaded.sessionId !== pending.sessionId) return;
    if (view.state() === "pending" || view.state() === "refreshing") return;
    if (!loaded.context.hasMore || tail() >= MAX_TAIL) {
      // Not on the part of the branch the server hands out (another branch,
      // or deleted): a request that cannot be honoured is dropped.
      untracked(() => clearPendingEntry());
      return;
    }
    const next = Math.min(MAX_TAIL, Math.max(tail() * 2, tail() + INITIAL_TAIL));
    if (next <= tail()) {
      untracked(() => clearPendingEntry());
      return;
    }
    // The match is older than this page: read more of the branch and look again.
    untracked(() => {
      loadingEarlier.set(true);
      tail.set(next);
    });
  });

  /** Reads more of the branch: the tail doubles, and the list keeps the rows in place. */
  const loadEarlier = () => {
    if (!view()?.context.hasMore) return;
    if (view.state() === "pending" || view.state() === "refreshing") return;
    const next = Math.min(MAX_TAIL, Math.max(tail() * 2, tail() + INITIAL_TAIL));
    if (next <= tail()) return;
    loadingEarlier.set(true);
    tail.set(next);
  };

  const toEnd = (animated = true) => {
    following.set(true);
    list?.scrollToEnd({ animated });
  };

  // Home and End read the transcript from either end; a text input keeps them
  // for its caret (`keymap`'s default `when`, `docs/dev/js-modules.md`).
  keymap.bind("home", () => {
    following.set(false);
    list?.scrollToIndex({ index: 0, viewPosition: 0, animated: true });
  });
  keymap.bind("end", () => toEnd());

  /** Sends the turn's prompt again, as Retry and Regenerate do in the demo. */
  const retry = (prompt: string | undefined) => {
    const id = selectedSessionId();
    if (!id || !prompt || agentRunning()) return;
    following.set(true);
    void sendPrompt(id, prompt);
    requestAnimationFrame(() => toEnd());
  };

  // The jump button springs in while the reader is scrolled up (the demo's
  // `jump`, run natively when the state changes).
  const jump = createAnimatedValue(0);
  effect(() => void jump.spring(following() ? 0 : 1, motion.settle));

  /** Above the rows: an earlier page on its way, and that there is more before this. */
  const header = (
    <View style={{ alignItems: "center", paddingVertical: 2 }}>
      <If when={loadingEarlier()}>
        <Status label={t("chat.loadingEarlierMessages")} />
      </If>
      <If when={!loadingEarlier() && rows().length > 0 && view()?.context.hasMore === true}>
        <Status label={t("chat.scrollUpForEarlier")} />
      </If>
    </View>
  );

  /** Under the rows: the reply being written, then the run's working line. */
  const footer = (
    <View>
      <If when={streamingMessage()}>
        {(message) => (
          <MessageEntrance>
            <MessageView message={message()} streaming={true} toolResults={toolResults} />
          </MessageEntrance>
        )}
      </If>
      <If when={agentRunning() || retryInfo() || compacting()}>
        <WorkingLine />
      </If>
      <If when={extensionUi().length > 0}>
        <View style={{ paddingVertical: 4 }}>
          <Status label={t("chat.extensionWaiting")} tone="warn" />
        </View>
      </If>
    </View>
  );

  const empty = (
    <View style={{ alignItems: "center", gap: 12, paddingVertical: 24 }}>
      <IconTile name="spark" tint={colors.accent} size={56} />
      <If when={view.state() === "pending" || view.state() === "refreshing"}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Spinner size={12} tint={colors.accent} />
          <Text style={{ fontSize: density.body, color: colors.muted }}>{t("i18n.loading")}</Text>
        </View>
      </If>
      <If when={view.state() === "ready"}>
        <Text style={{ fontSize: 15, color: colors.muted }}>{t("chat.noMessagesYet")}</Text>
      </If>
      <If when={view.state() === "errored"}>
        <Status label={t("chat.sessionReadFailed")} tone="danger" />
      </If>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {/* What the session itself has to say: a rejected prompt, an extension's fall. */}
      <Each of={notices()} key={(notice) => notice.id}>
        {(notice) => (
          <View style={{ width: "100%", maxWidth: THREAD_MAX_WIDTH(), alignSelf: "center", paddingHorizontal: 16, paddingTop: 8 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 10,
                paddingVertical: 6,
                ...insetSurface(),
                backgroundColor: notice().kind === "error" ? toneTint("danger") : colors.surface,
                borderColor: notice().kind === "error" ? alpha(colors.danger, 0.4) : colors.line,
              }}
            >
              <Badge label={notice().kind === "error" ? t("chat.error") : t("chat.notice")} tone={notice().kind === "error" ? "danger" : "neutral"} />
              <Text
                style={{
                  flex: 1,
                  fontSize: density.note,
                  lineHeight: 17,
                  color: notice().kind === "error" ? colors.danger : colors.muted,
                }}
              >{notice().text}</Text>
              <Button label={t("chat.dismiss")} variant="ghost" size="small" onPress={() => dismissNotice(notice().id)} />
            </View>
          </View>
        )}
      </Each>

      <If when={view.error()}>
        {(error) => (
          <View style={{ width: "100%", maxWidth: THREAD_MAX_WIDTH(), alignSelf: "center", paddingHorizontal: 16, paddingTop: 8 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 10,
                paddingVertical: 6,
                ...insetSurface(),
                backgroundColor: toneTint("danger"),
                borderColor: alpha(colors.danger, 0.4),
              }}
            >
              <Badge label={t("chat.error")} tone="danger" />
              <Text style={{ flex: 1, fontSize: density.note, lineHeight: 17, color: colors.danger }}>{errorText(error())}</Text>
              <Button label={t("chat.retry")} variant="secondary" size="small" icon="undo" onPress={() => view.refetch()} />
            </View>
          </View>
        )}
      </If>

      <View style={{ flex: 1, width: "100%", maxWidth: THREAD_MAX_WIDTH(), alignSelf: "center" }}>
        {/* One selection across messages: in the List, over the rows that are mounted. */}
        <View selectable style={{ flex: 1 }}>
          <List
            ref={(node) => {
              list = node;
            }}
            each={rows()}
            keyExtractor={(row) => row.key}
            estimatedItemSize={140}
            alignment="bottom"
            initialScrollAtEnd
            maintainVisibleContentPosition={{ autoscrollToBottomThreshold: FOLLOW_THRESHOLD }}
            onLoadMoreAtStart={loadEarlier}
            style={{ flex: 1 }}
            // The rail now sits on the pane's own left edge, so the thread keeps
            // only a small gutter: enough that message text does not run under
            // the dashes when the pane is narrower than the reading column.
            contentStyle={{ paddingTop: 8, paddingBottom: 16, paddingLeft: minimapEnabled() ? 16 : 0 }}
            keyboardDismissMode="interactive"
            scrollEventThrottle={100}
            viewabilityConfig={{ itemVisibleThreshold: 0.15 }}
            onViewableItemsChange={trackViewable}
            onScrollDragStart={() => (dragging = true)}
            onScroll={(event) => {
              // Every scroll says whether the reader is at the end, not only a
              // drag: a wheel scroll up stops the stream from pulling the view
              // back, and a scroll back to the end follows it again.
              const atEnd = event.offset.y + event.size.height >= event.contentSize.height - FOLLOW_THRESHOLD;
              if (atEnd !== following()) following.set(atEnd);
            }}
            onMomentumEnd={() => (dragging = false)}
            onScrollEnd={() => (dragging = false)}
            header={header}
            footer={footer}
            empty={empty}
          >
            {(row) => <ChatRowView row={row} toolResults={toolResults} onRetry={retry} />}
          </List>
        </View>

        {/* Scrolled up: one press back to the newest message. */}
        <View
          style={{
            pointerEvents: following() ? "none" : "auto",
            position: "absolute",
            right: 16,
            bottom: 12,
            opacity: jump,
            scale: jump.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }),
          }}
        >
          <RoundButton icon="arrow-down" label={t("chat.scrollToLatest")} variant="secondary" onPress={() => toEnd()} />
          <If when={streamingMessage() !== null}>
            <View
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: colors.accent,
                borderWidth: 2,
                borderColor: colors.background,
              }}
            />
          </If>
        </View>
      </View>

      {/* The turn map on the pane's leading edge (desktop, `prefs` on): a tick a
          turn, the viewport's turn accented. It is mounted outside the centered
          reading column so its dashes hug the sidebar rather than the thread. */}
      <ChatMinimap turns={() => turnItems()} activeKey={() => activeTurnKey()} onJump={jumpToTurn} />
    </View>
  );
}

/** One transcript row: a day's separator, or a whole turn (its fold and its messages). */
function ChatRowView(props: {
  row: () => ChatRow;
  toolResults: () => Map<string, ToolResultMessage>;
  onRetry: (prompt: string | undefined) => void;
}) {
  const row = props.row;
  return (
    <If
      when={row().kind === "date"}
      else={<TurnView turn={() => row() as TurnRow} toolResults={props.toolResults} onRetry={props.onRetry} />}
    >
      <DateSeparator label={dayLabel((row() as DateRow).timestamp)} />
    </If>
  );
}

/** The state key of one turn's process fold. */
function processFoldKey(turn: TurnRow): string {
  return `process:${turn.key}`;
}

/** A turn's final answer message, if it has one (the fold is closed only above it). */
function turnAnswerMessage(turn: TurnRow): AssistantMessage | null {
  return splitTurn(turn).answer?.message ?? null;
}

/**
 * Whether a turn's process details are open: a live turn's work is what the
 * reader watches, an answered turn starts folded (pi-next's `ProcessDetails`,
 * `collapsesProcessDetails`), and a press records an explicit choice in the
 * same store the chat's thinking and tool folds use.
 */
function processOpen(turn: TurnRow): boolean {
  if (!turn.startsTurn) return true;
  if (turn.last && (agentRunning() || streamingMessage() !== null)) return true;
  const chosen = openProcess()[processFoldKey(turn)];
  return chosen === undefined ? !collapsesProcessDetails(turnAnswerMessage(turn)) : chosen;
}

function toggleProcessFold(turn: TurnRow): void {
  toggleProcess(processFoldKey(turn));
}

/** The first line of a turn's prompt, if it has one. */
function turnPrompt(rows: MessageRow[]): string | undefined {
  for (const row of rows) {
    if (row.message.role !== "user") continue;
    const text = userText(row.message).replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return undefined;
}

/** How many tool calls a turn made, for the minimap's card. */
function turnTools(turn: TurnRow): number {
  let total = 0;
  for (const row of turn.rows) {
    const message = row.message;
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "toolCall") total += 1;
    }
  }
  return total;
}

/** The opening of a turn's reply, for the minimap's hover card. */
function turnAnswer(turn: TurnRow): string | undefined {
  for (const row of turn.rows) {
    const message = row.message;
    if (message.role !== "assistant") continue;
    const text = (message.content ?? [])
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  }
  return undefined;
}

/** What the fold says a turn was: its prompt, or the custom message that started it. */
function turnTitle(turn: TurnRow): string {
  const prompt = turn.prompt;
  if (prompt) {
    const text = prompt.length > 56 ? `${prompt.slice(0, 56)}…` : prompt;
    return t("chat.turnTitle", { number: turn.number, title: text });
  }
  const first = turn.rows[0]?.message;
  if (first?.role === "custom") {
    switch (first.customType) {
      case "compaction":
        return t("chat.turnTitle", { number: turn.number, title: t("chat.contextCompacted") });
      case "subagent-notification":
      case "pi-web:subagent-notification":
        return t("chat.turnTitle", { number: turn.number, title: t("chat.subagentFinished") });
      default:
        return t("chat.turnTitle", { number: turn.number, title: first.customType || t("chat.extensionMessage") });
    }
  }
  return turn.startsTurn ? t("chat.turnOnly", { number: turn.number }) : t("chat.loadEarlierFallback");
}

/** The final answer's views, sliced once per stored message (`getFinalAnswerViews`). */
const answerViews = new WeakMap<AssistantMessage, FinalAnswerViews>();

/** One process step: the row it belongs to and the message it draws. */
interface TurnStep {
  row: MessageRow;
  message: AgentMessage;
  entryId: string | undefined;
}

/** A turn split as pi-next draws it: the prompt, the folded process, the answer. */
interface TurnParts {
  /** The user message (or the custom message) that starts the turn. */
  anchor: MessageRow | null;
  /** Thinking, tools and interim replies, folded together. */
  steps: TurnStep[];
  /** The last assistant message with an answer, shown below the fold. */
  answer: { row: MessageRow; message: AssistantMessage } | null;
  /** Custom notices that come after the answer (a retry, a compaction). */
  tail: MessageRow[];
  /** What the steps did, for the fold's summary. */
  actions: ProcessActionCounts;
}

/**
 * Splits a turn into the parts pi-next's chat shows: the prompt stays at the
 * top, every intermediate step (thinking, tool calls, text before the final
 * answer) folds under one "process details" row, and the final answer stays
 * visible — the turn itself is never folded away. The final assistant
 * message's own pre-answer blocks join the process group through
 * `getFinalAnswerViews`, which keeps their stored block indices for deferred
 * thinking.
 */
function splitTurn(turn: TurnRow): TurnParts {
  const rows = turn.rows;
  let answerAt = -1;
  let views: FinalAnswerViews | null = null;
  for (let index = rows.length - 1; index >= 0; index--) {
    const message = rows[index].message;
    if (message.role !== "assistant") continue;
    const next = getFinalAnswerViews(answerViews, message);
    if (next.answer) {
      answerAt = index;
      views = next;
      break;
    }
  }

  const anchor = turn.startsTurn ? (rows[0] ?? null) : null;
  const start = anchor ? 1 : 0;
  const end = answerAt >= 0 ? answerAt : rows.length;
  const steps: TurnStep[] = [];
  const blocks: AssistantContentBlock[] = [];
  for (let index = start; index < end; index++) {
    const row = rows[index];
    steps.push({ row, message: row.message, entryId: row.entryId });
    if (row.message.role === "assistant") blocks.push(...(row.message.content ?? []));
  }
  if (views && answerAt >= 0) {
    const process = views.process.content ?? [];
    if (process.length > 0) {
      steps.push({ row: rows[answerAt], message: views.process, entryId: rows[answerAt].entryId });
      blocks.push(...process);
    }
  }

  return {
    anchor,
    steps,
    answer: views?.answer ? { row: rows[answerAt], message: views.answer } : null,
    tail: answerAt >= 0 ? rows.slice(answerAt + 1) : [],
    actions: countProcessActions(blocks),
  };
}

/** The fold's words, as pi-next's `ProcessDetails` sums the turn up. */
function processSummary(actions: ProcessActionCounts): string {
  const parts: string[] = [];
  if (actions.thinking) parts.push(t("chat.processThinking"));
  if (actions.read > 0) parts.push(t("chat.processRead", { count: actions.read }));
  if (actions.search > 0) parts.push(t("chat.processSearch", { count: actions.search }));
  if (actions.run > 0) parts.push(t("chat.processRun", { count: actions.run }));
  if (actions.edit > 0) parts.push(t("chat.processEdit", { count: actions.edit }));
  if (actions.other > 0) parts.push(t("chat.processOther", { count: actions.other }));
  return parts.length > 0 ? parts.join(" · ") : t("chat.processThinking");
}

/** The process fold's header: a quiet pill, the spark, what it did, a chevron. */
function ProcessHeader(props: { actions: ProcessActionCounts; open: boolean; onToggle: () => void }) {
  const summary = () => processSummary(props.actions);
  return (
    <Press
      onPress={props.onToggle}
      scale={0.99}
      accessibilityLabel={`${t("chat.processDetails")} · ${summary()}`}
      accessibilityState={{ selected: props.open }}
    >
      <View
        style={{
          height: 28,
          alignSelf: "flex-start",
          maxWidth: "100%",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 9,
          borderRadius: 14,
        }}
        hoverStyle={{ backgroundColor: alpha(colors.text, 0.05) }}
      >
        <Icon name="spark" size={13} tint={colors.faint} />
        <Text style={{ flexShrink: 0, fontSize: 11.5, color: colors.faint }}>{t("chat.processDetails")}</Text>
        <Text style={{ flexShrink: 1, minWidth: 0, fontSize: 11.5, color: colors.muted, numberOfLines: 1 }}>
          {summary()}
        </Text>
        <DisclosureChevron open={props.open} />
      </View>
    </Press>
  );
}

/** A turn: the prompt, its process details (folded when answered), its answer. */
function TurnView(props: {
  turn: () => TurnRow;
  toolResults: () => Map<string, ToolResultMessage>;
  onRetry: (prompt: string | undefined) => void;
}) {
  const turn = props.turn;
  const parts = () => splitTurn(turn());
  const open = () => processOpen(turn());

  return (
    <View style={{ paddingBottom: 2 }}>
      <If when={parts().anchor}>
        {(anchor) => (
          <MessageRowView row={() => anchor()} toolResults={props.toolResults} onRetry={props.onRetry} />
        )}
      </If>

      <If when={parts().steps.length > 0}>
        <ProcessHeader actions={parts().actions} open={open()} onToggle={() => toggleProcessFold(turn())} />
        <If when={open()}>
          <View style={{ marginTop: 8, gap: 14 }}>
            <Each of={parts().steps} key={(step) => step.row.key}>
              {(step) => (
                <MessageRowView
                  row={() => step().row}
                  message={step().message}
                  entryId={step().entryId}
                  toolResults={props.toolResults}
                  onRetry={props.onRetry}
                />
              )}
            </Each>
          </View>
        </If>
      </If>

      <If when={parts().answer}>
        {(answer) => (
          <MessageRowView
            row={() => answer().row}
            message={answer().message}
            durationMs={turn().durationMs}
            toolResults={props.toolResults}
            onRetry={props.onRetry}
          />
        )}
      </If>

      <Each of={parts().tail} key={(row) => row.key}>
        {(row) => <MessageRowView row={row} toolResults={props.toolResults} onRetry={props.onRetry} />}
      </Each>
    </View>
  );
}

/**
 * A row's entrance: a fade and a slight rise, natively (`ui/motion.ts`), with
 * no motion when the reader asked for less. A list cell runs its body once, so
 * a row that is re-bound to another item keeps the completed value instead of
 * fading again.
 */
function MessageEntrance(props: { children: JSX.Element }) {
  const style = enter();
  return <View style={[style, { width: "100%" }]}>{props.children}</View>;
}

/** One message of a turn (a prompt, a reply, or the custom message that started it). */
function MessageRowView(props: {
  row: () => MessageRow;
  toolResults: () => Map<string, ToolResultMessage>;
  onRetry: (prompt: string | undefined) => void;
  /** A split copy of the row's message (an answer without its process blocks). */
  message?: AgentMessage;
  entryId?: string;
  /** The turn's length, under its answer only. */
  durationMs?: number;
}) {
  return (
    <MessageEntrance>
      <MessageView
        message={props.message ?? props.row().message}
        entryId={props.entryId ?? props.row().entryId}
        sessionId={selectedSessionId() ?? undefined}
        durationMs={props.durationMs ?? (props.message ? undefined : props.row().durationMs)}
        toolResults={props.toolResults}
        onRetry={() => props.onRetry(props.row().prompt)}
      />
    </MessageEntrance>
  );
}

/** What the run is doing, under the reply: the model, a tool, a retry, a compaction.
 * TODO(nsh): the kit has no run-status strip; this is a `Row` in an `insetSurface()`
 * well until it offers one. */
function WorkingLine() {
  const label = () => {
    if (compacting()) return t("chat.compacting");
    const retry = retryInfo();
    if (retry) return t("chat.retrying", { attempt: retry.attempt, max: retry.maxAttempts });
    const phase = agentPhase();
    if (phase?.kind === "running_tools" && phase.tools.length > 0) {
      return t("chat.runningTools", { names: phase.tools.map((tool) => tool.name).join(", ") });
    }
    return t("chat.waitingModel");
  };
  const queued = () => {
    const queue = queuedMessages();
    const count = queue.steering.length + queue.followUp.length;
    return count === 0 ? null : t("chat.queued", { count });
  };
  return (
    <View style={{ ...insetSurface(), marginTop: 8, marginHorizontal: 16, paddingHorizontal: 10 }}>
      <Row first>
        <Spinner size={12} tint={colors.accent} />
        <Text style={{ flex: 1, fontSize: density.note, color: colors.muted }}>{label()}</Text>
        <If when={queued()}>{(text) => <Badge label={text()} />}</If>
      </Row>
      <If when={retryInfo()?.errorMessage}>
        {(message) => (
          <View style={{ paddingBottom: 8 }}>
            <Status label={message()} tone="danger" />
          </View>
        )}
      </If>
      <If when={compactError()}>
        {(message) => (
          <View style={{ paddingBottom: 8 }}>
            <Status label={t("chat.compactionFailed", { message: message() })} tone="danger" />
          </View>
        )}
      </If>
    </View>
  );
}

/** A prompt's text, whatever form its content has. */
function userText(message: AgentMessage): string {
  if (message.role !== "user") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

/** The day a message was written, as the chat's separator says it. */
function dayLabel(timestamp: number): string {
  const at = new Date(timestamp);
  const today = new Date();
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(at)) / 86_400_000);
  if (days <= 1) return formatRelativeTime(at, locale(), today);
  const sameYear = at.getFullYear() === today.getFullYear();
  return at.toLocaleDateString(locale(), sameYear
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" });
}

/** One visible block before turns are grouped: a day's separator or a message. */
type RawRow = DateRow | MessageRow;

/**
 * The rows the chat shows: a day's separator, a prompt, a reply, and the custom
 * messages that start a turn (a compaction summary, a subagent's notice). A tool
 * result is drawn inside its call's card; a transcript system message is never
 * shown (pi's `visibleMessages` and `isMessageGroupAnchor`).
 */
function buildMessageRows(list: AgentMessage[], ids: string[], keys: string[]): RawRow[] {
  const rows: RawRow[] = [];
  let day: number | null = null;
  let prompt: string | undefined;
  for (let index = 0; index < list.length; index++) {
    const message = list[index];
    const turnStart = isMessageGroupAnchor(message);
    if (message.role !== "assistant" && !turnStart) continue;
    if (message.role === "user") prompt = userText(message);
    // A separator between days, as the demo draws one.
    if (typeof message.timestamp === "number") {
      const at = new Date(message.timestamp);
      const start = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
      if (start !== day) {
        day = start;
        rows.push({ kind: "date", key: `date:${start}`, timestamp: message.timestamp });
      }
    }
    rows.push({
      kind: "message",
      key: keys[index] ?? `row:${index}`,
      message,
      entryId: ids[index],
      index,
      turnStart,
      prompt: message.role === "assistant" ? prompt : undefined,
    });
  }
  applyTurnDurations(rows, list);
  return rows;
}

/**
 * Groups the visible blocks into turns for the list. A long session keeps its
 * newest `OPEN_RECENT_TURNS` turns open and folds the earlier ones by default;
 * a turn whose prompt is older than the first-paint window counts as early too.
 * A day separator stays a list row of its own, so a turn split by midnight is
 * two foldable pieces rather than one very tall row.
 */
function groupTurns(rows: RawRow[]): ChatRow[] {
  const pieces: (DateRow | MessageRow[])[] = [];
  let current: MessageRow[] | null = null;
  const flush = () => {
    if (current && current.length > 0) pieces.push(current);
    current = null;
  };
  for (const row of rows) {
    if (row.kind === "date") {
      flush();
      pieces.push(row);
      continue;
    }
    // A new turn starts after the one in progress: flush it and open the next.
    // (`flush()` leaves `current` null, so the array is made again here.)
    if (current !== null && row.turnStart) flush();
    if (current === null) current = [];
    current.push(row);
  }
  flush();

  const turnTotal = pieces.reduce((count, piece) => count + (Array.isArray(piece) ? 1 : 0), 0);
  let turnNumber = 0;
  return pieces.map((piece): ChatRow => {
    if (!Array.isArray(piece)) return piece;
    const index = turnNumber++;
    const first = piece[0];
    const last = index === turnTotal - 1;
    const durationMs = [...piece].reverse().find((row) => typeof row.durationMs === "number")?.durationMs;
    return {
      kind: "turn",
      key: `turn:${first.key}`,
      rows: piece,
      number: index + 1,
      startsTurn: first.turnStart,
      last,
      prompt: turnPrompt(piece),
      durationMs,
    };
  });
}

/** A turn's length, on the row that ends it: from its anchor to the last answer or result. */
function applyTurnDurations(rows: RawRow[], list: AgentMessage[]): void {
  const turns = rows.filter((row): row is MessageRow => row.kind === "message");
  for (let start = 0; start < turns.length; start++) {
    if (!turns[start].turnStart) continue;
    let end = start + 1;
    while (end < turns.length && !turns[end].turnStart) end++;
    if (end === start + 1) continue;
    const endIndex = end < turns.length ? turns[end].index : list.length;
    const duration = getTurnDurationMs(list, turns[start].index, endIndex);
    if (duration !== undefined && duration > 0) turns[end - 1].durationMs = duration;
  }
}
