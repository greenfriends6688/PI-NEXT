// A session's transcript, scoped by id: what the dock's subagent and side-chat
// tabs show.
//
// `ChatView` is the main chat and owns the app-wide agent store
// (`state/agent.ts`); a side tab must not overwrite the main chat's messages
// while both are on screen. So this view reads the session file itself
// (`GET /api/sessions/[id]`) and listens to the agent stream only to know when
// to read again: the file is the truth after every finished message, exactly
// as `ChatView` treats it. The live reply appears with its `message_end`, not
// token by token; the working line says a run is going meanwhile.
import { computed, effect, List, resource, signal, Text, View, type ListRef } from "nsh";
import { openAgentEvents } from "../../api/agent";
import { readSession } from "../../api/sessions";
import type { AgentMessage, ToolResultMessage } from "../../lib/types";
import { errorText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { Button, colors, Spinner, Status } from "../../ui/kit";
import { MessageView } from "./MessageView";

/** The first read; the top button doubles it until the whole branch is here. */
const INITIAL_TAIL = 200;
/** The session route's clamp. */
const MAX_TAIL = 1000;
/** The chat's reading column, as `ChatView`'s. */
const THREAD_MAX_WIDTH = 820;

interface TranscriptRow {
  key: string;
  message: AgentMessage;
  entryId?: string;
}

export interface SessionTranscriptProps {
  sessionId: string;
}

/**
 * The transcript of `sessionId`, with its status line. It has no composer:
 * `SideChatPanel` puts the normal `Composer` under it; the subagent tab is
 * read-only apart from steer / abort.
 */
export function SessionTranscript(props: SessionTranscriptProps) {
  const revision = signal(0);
  const tail = signal(INITIAL_TAIL);
  const running = signal(false);
  let list: ListRef | undefined;
  /** The session whose rows were already scrolled to their end once. */
  let painted: string | null = null;
  /** Why the run could not start (or a prompt was refused); shown above the list. */
  const liveError = signal<string | null>(null);

  const source = computed(() => ({ id: props.sessionId, revision: revision(), tail: tail() }));
  const view = resource(source, async (asked, info) => {
    return await readSession(asked.id, {
      tail: asked.tail,
      deferThinking: false,
      deferMedia: false,
      signal: info.signal,
    });
  });

  // One stream per mounted transcript. It is not folded into state here: the
  // events only say when a finished message makes the file worth reading
  // again. Closing the tab (or the dock) runs the effect's cleanup.
  effect(() => {
    const id = props.sessionId;
    return openAgentEvents(id, (event) => {
      switch (event.type) {
        case "connected":
          running.set(event.isStreaming === true);
          revision.update((value) => value + 1);
          return;
        case "agent_start":
          running.set(true);
          liveError.set(null);
          return;
        case "message_end":
        case "tool_execution_end":
        case "compaction_end":
          revision.update((value) => value + 1);
          return;
        case "agent_settled":
        case "prompt_done":
        case "session_shutdown":
          running.set(false);
          revision.update((value) => value + 1);
          return;
        case "prompt_error":
        case "startup_error": {
          running.set(false);
          const message = event.error ?? event.message;
          if (typeof message === "string" && message.trim()) liveError.set(message);
          revision.update((value) => value + 1);
          return;
        }
        default:
          return;
      }
    }, { holder: "nsh-panel-chat" });
  });

  const messages = computed(() => (view()?.context.messages ?? []) as AgentMessage[]);
  const entryIds = computed(() => view()?.context.entryIds ?? []);
  const rows = computed<TranscriptRow[]>(() => {
    const list = messages();
    const ids = entryIds();
    const rows: TranscriptRow[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const message = list[index];
      // A side chat's hidden boundary (`pi-web:side-boundary`) marks where the
      // fork begins; pi-next draws it as a line at most, and the dock leaves it out.
      if (message.role === "custom" && message.customType === "pi-web:side-boundary") continue;
      const entryId = ids[index];
      rows.push({ key: entryId ?? `live:${index}`, message, ...(entryId ? { entryId } : {}) });
    }
    return rows;
  });
  const toolResults = computed(() => {
    const results = new Map<string, ToolResultMessage>();
    for (const message of messages()) {
      if (message.role === "toolResult") results.set(message.toolCallId, message);
    }
    return results;
  });

  // The read lands after the list mounts: put a freshly opened transcript at
  // its newest message once, as the main chat does.
  effect(() => {
    const loaded = view();
    if (!loaded || loaded.sessionId !== props.sessionId) return;
    if (rows().length === 0 || painted === props.sessionId) return;
    painted = props.sessionId;
    requestAnimationFrame(() => list?.scrollToEnd({ animated: false }));
  });

  const loading = () => view.state() === "pending" || view.state() === "refreshing";
  const hasMore = () => view()?.context.hasMore === true && tail() < MAX_TAIL;
  const loadEarlier = () => {
    const next = Math.min(MAX_TAIL, Math.max(tail() * 2, tail() + INITIAL_TAIL));
    if (next > tail()) tail.set(next);
  };

  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: "transparent" }}>
      <If when={hasMore()}>
        <View style={{ alignItems: "center", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <Button label={t("chat.loadEarlier")} variant="ghost" size="small" onPress={loadEarlier} />
        </View>
      </If>

      <If when={view.error()}>
        <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 12, color: colors.danger }}>
              {t("sessionPanel.error")}
            </Text>
            <Button label={t("i18n.refresh")} variant="ghost" size="small" onPress={() => view.refetch()} />
          </View>
          <Text style={{ fontSize: 11, color: colors.faint }}>{errorText(view.error())}</Text>
        </View>
      </If>

      <If when={liveError()}>
        {(message) => (
          <View style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ fontSize: 12, color: colors.danger }}>{message()}</Text>
          </View>
        )}
      </If>

      <View style={{ flex: 1, minHeight: 0 }}>
        <If
          when={rows().length > 0}
          else={
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 6, padding: 24 }}>
              <If when={loading() || running()} else={<Text style={{ fontSize: 12.5, color: colors.muted }}>{t("chat.noMessagesYet")}</Text>}>
                <View style={{ alignItems: "center", gap: 6 }}>
                  <Spinner size={16} tint={colors.accent} />
                  <Text style={{ fontSize: 12, color: colors.muted }}>{t("sessionPanel.loading")}</Text>
                </View>
              </If>
            </View>
          }
        >
          <List
            ref={list}
            each={rows()}
            keyExtractor={(row) => row.key}
            estimatedItemSize={120}
            alignment="bottom"
            initialScrollAtEnd
            maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 40 }}
            style={{ flex: 1 }}
            contentStyle={{ paddingTop: 8, paddingBottom: 12 }}
          >
            {(row) => (
              <View style={{ width: "100%", maxWidth: THREAD_MAX_WIDTH, alignSelf: "center" }}>
                <MessageView
                  message={row().message}
                  entryId={row().entryId}
                  sessionId={props.sessionId}
                  toolResults={toolResults}
                />
              </View>
            )}
          </List>
        </If>
      </View>

      <If when={running()}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            backgroundColor: colors.surface,
          }}
        >
          <Spinner size={12} tint={colors.accent} />
          <Status label={t("chat.statsWorking")} tone="info" />
        </View>
      </If>
    </View>
  );
}
