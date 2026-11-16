// One chat message, laid out as the NSH gallery's chat demo lays its rows out
// (`examples/gallery/demos/Chat.tsx`): the prompt is a bubble at the trailing
// edge (82% at most, 20-point corners with the bottom-right one tighter, the
// raised fill and a hairline), the reply is plain text — the avatar and the
// model's name on a line, the reasoning folded to one row that opens, its tool
// calls as the gallery's cards, then its Markdown and, under it, what went
// wrong or what it copied.
//
// What differs from the demo is only where the data comes from: its scripted
// `Msg` objects are replaced by our session's `AgentMessage` (`lib/types.ts`)
// and its live run's signals by `state/agent.ts`. The shapes, the spacing and
// the motion are the gallery's, drawn with our kit (`ui/kit`) and its copied
// chat parts (`ui/chat`).
//
// Rules this follows (`nsh/skills/nsh/references/tsx.md`): the body runs once,
// branches are `<If>`, rows are `<Each>`, and every value is read where it is
// shown. Markdown is `TextView`'s, through the gallery's `Markdown` component
// (`ui/chat/markdown.tsx`), which repairs a reply still being written.
import { Clipboard, computed, effect, platform, signal, Text, untracked, View } from "nsh";
import { Collapsible } from "nsh/base";
import {
  getAssistantErrorMessage,
  getThinkingPreview,
  isAssistantTruncated,
} from "../../lib/message-display";
import { formatTurnDuration } from "../../lib/turn-duration";
import {
  formatCacheWarmCost,
  formatNoticeCost,
  formatNoticeTokens,
  getTranscriptNotices,
  type TranscriptNotice,
} from "../../lib/transcript-notices";
import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
  BashExecutionMessage,
  CustomMessage,
  ImageContent,
  ThinkingContent,
  ToolResultMessage,
  UserMessage,
} from "../../lib/types";
import { openThinking, openToolCalls } from "../../state/agent";
import { pref } from "../../state/prefs";
import { readEntryThinking, toolResultImageUrl } from "../../api/sessions";
import { errorText, uiText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { ActionButton, Avatar, Caret, ErrorRow, Photo, Spinner } from "../../ui/chat/parts";
import { Glyph } from "../../ui/chat/glyphs";
import { Markdown } from "../../ui/chat/markdown";
import { alpha, Badge, Card, colors, density, DisclosureChevron, Press, radius, Status, toneTint } from "../../ui/kit";
import { BashOutputView, ToolCallView } from "./ToolCallView";

/** A custom message's text is a notice, not a document: cut long summaries. */
const MAX_CUSTOM_CHARS = 600;

/**
 * The default a new reasoning block opens with: pi-next's
 * `thinking-expansion-preference.ts` key (`pi-thinking-expanded`), kept in this
 * app's preferences so the choice survives a launch. A block the reader opened
 * or closed explicitly wins over it (`openThinking`, keyed by the block).
 */
const THINKING_EXPANDED_PREF = "pi-thinking-expanded";

const thinkingExpandedByDefault = (): boolean => {
  const stored = pref<unknown>(THINKING_EXPANDED_PREF, false);
  return stored === true || stored === "true";
};

/** The message whose reply was just copied, for a moment (`ActionButton`'s check). */
const copiedKey = signal<string | null>(null);

// --- deferred thinking ------------------------------------------------------
//
// With `?deferThinking` the read of a historical session carries only a preview
// of each thinking block (`{ deferred: true }`). The whole text is one request
// per block (`GET …/entries/[entryId]/thinking?blockIndex=`), made when the
// reader opens the reasoning. The cache lives here, keyed by the block, and not
// in a row: list rows are recycled (`tsx.md` "List").

/** A deferred thinking block's full text, by `sessionId:entryId:blockIndex`. */
const thinkingTexts = signal<Record<string, string>>({});
/** Blocks whose full text is on its way. */
const thinkingLoading = signal<Record<string, boolean>>({});
/** Why a block could not be read. */
const thinkingFailures = signal<Record<string, string>>({});
/** One request per block, shared by every row that shows it. */
const thinkingRequests = new Map<string, Promise<void>>();
/** How many blocks stay in memory; the oldest go first (pi-next keeps 100). */
const MAX_THINKING_CACHE_ENTRIES = 100;

/** Stores the text, dropping the oldest entries past the cap. */
function rememberThinking(key: string, text: string): void {
  thinkingTexts.update((all) => {
    const next = { ...all, [key]: text };
    const keys = Object.keys(next);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_THINKING_CACHE_ENTRIES))) delete next[old];
    return next;
  });
}

function thinkingKey(sessionId: string | undefined, entryId: string | undefined, index: number): string | null {
  return sessionId && entryId ? `${sessionId}:${entryId}:${index}` : null;
}

/**
 * Fetches one deferred block once. A block without a session / entry id (a
 * live message) cannot be fetched: it keeps its preview, and the open row says
 * so (`i18n.thinkingUnavailable`).
 */
function ensureThinking(sessionId: string | undefined, entryId: string | undefined, index: number): void {
  const key = thinkingKey(sessionId, entryId, index);
  if (!key || sessionId === undefined || entryId === undefined) return;
  if (thinkingRequests.has(key) || thinkingTexts()[key] !== undefined) return;
  thinkingLoading.update((all) => ({ ...all, [key]: true }));
  thinkingFailures.update((all) => {
    if (all[key] === undefined) return all;
    const next = { ...all };
    delete next[key];
    return next;
  });
  const request = readEntryThinking(sessionId, entryId, index)
    .then((text) => rememberThinking(key, text))
    .catch((cause: unknown) => thinkingFailures.update((all) => ({ ...all, [key]: errorText(cause) })))
    .finally(() => {
      thinkingRequests.delete(key);
      thinkingLoading.update((all) => {
        if (all[key] === undefined) return all;
        const next = { ...all };
        delete next[key];
        return next;
      });
    });
  thinkingRequests.set(key, request);
}

/** The deferred blocks of one message, with their `blockIndex` in its content. */
function deferredThinkingBlocks(message: AssistantMessage): { block: ThinkingContent; index: number }[] {
  return (message.content ?? []).flatMap((block, index) => (
    block.type === "thinking" && block.deferred === true ? [{ block, index }] : []
  ));
}

export interface MessageViewProps {
  message: AgentMessage;
  /** Every tool result of the session by call id, live ones included (`state/agent.ts`). */
  toolResults: () => Map<string, ToolResultMessage>;
  /** The reply is still being written: Markdown repairs itself, the caret follows. */
  streaming?: boolean;
  /** The session entry id; the per-block state (open thinking, tool cards) is keyed by it. */
  entryId?: string;
  /** The open session's id: deferred thinking and tool-result images are read by entry. */
  sessionId?: string;
  /** The turn's length, shown on the message that ends it. */
  durationMs?: number;
  /** Sends the turn's prompt again (`ChatView`), for the error's Retry and the reply's Regenerate. */
  onRetry?: () => void;
}

/** One message of the transcript, by role. */
export function MessageView(props: MessageViewProps) {
  return (
    <If
      when={props.message.role === "assistant"}
      else={
        <If when={props.message.role === "user"} else={<OtherMessageView message={props.message} sessionId={props.sessionId} />}>
          <UserMessageView message={props.message} />
        </If>
      }
    >
      <AssistantMessageView
        message={props.message}
        toolResults={props.toolResults}
        streaming={props.streaming}
        entryId={props.entryId}
        sessionId={props.sessionId}
        durationMs={props.durationMs}
        onRetry={props.onRetry}
      />
    </If>
  );
}

// --- the user's message -----------------------------------------------------

/** A message's text, whatever form its content has. */
function contentText(content: string | (AssistantContentBlock | { type: string; text?: string })[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block.type === "text" && typeof (block as { text?: string }).text === "string" ? (block as { text: string }).text : ""))
    .filter(Boolean)
    .join("\n");
}

/** A message's images (`{ source: { type, data | url } }`, or pi's flat on-disk form). */
function contentImages(content: unknown): ImageContent[] {
  if (!Array.isArray(content)) return [];
  return content.filter((block): block is ImageContent => block?.type === "image");
}

/**
 * The image's `src`: a `data:` URI from base64 bytes, or the URL pi wrote.
 * The flat `{ data, mimeType }` form is what older session files hold.
 */
function imageSource(image: ImageContent): string {
  const source = image.source;
  if (source) {
    if (source.type === "base64" && source.data) return `data:${source.media_type ?? "image/png"};base64,${source.data}`;
    if (source.url) return source.url;
  }
  const flat = image as unknown as { data?: string; mimeType?: string };
  return flat.data ? `data:${flat.mimeType ?? "image/png"};base64,${flat.data}` : "";
}

/** An image of a message, rounded as the gallery's `Photo` rounds one. */
function MessageImage(props: { image: ImageContent }) {
  const src = computed(() => imageSource(props.image));
  return <Photo src={src()} width={200} height={140} />;
}

/**
 * The prompt: its images, then its bubble — the gallery's `userRow`
 * (`Chat.tsx:371`): the raised fill, a hairline around it, 20-point corners
 * with the bottom-right one tighter, 82% of the column at most.
 */
function UserMessageView(props: { message: AgentMessage }) {
  const user = computed(() => props.message as UserMessage);
  // Session files can hold `\r\n` or a lone `\r`; both show as one line break.
  const text = computed(() => contentText(user().content).replace(/\r\n?/g, "\n"));
  const images = computed(() => contentImages(user().content));
  return (
    <View style={{ alignItems: "flex-end", paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
      <Each of={images()} key="index">
        {(image) => <MessageImage image={image()} />}
      </Each>
      <If when={text()}>
        {(value) => (
          <View
            style={{
              maxWidth: "82%",
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 20,
              borderBottomRightRadius: 6,
              borderCurve: "continuous",
              // A message is read, not pressed: flat, a hairline around it.
              backgroundColor: colors.raised,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ userSelect: "text", fontSize: 15, lineHeight: 21, color: colors.text }}>{value()}</Text>
          </View>
        )}
      </If>
    </View>
  );
}

// --- the assistant's reply --------------------------------------------------

interface AssistantViewProps {
  message: AgentMessage;
  toolResults: () => Map<string, ToolResultMessage>;
  streaming?: boolean;
  entryId?: string;
  sessionId?: string;
  durationMs?: number;
  onRetry?: () => void;
}

/**
 * A reply, as the gallery's `assistantRow` (`Chat.tsx:404`) draws one: who
 * answered, its reasoning, its tools, its Markdown, and what is left to say
 * about it.
 */
function AssistantMessageView(props: AssistantViewProps) {
  const assistant = computed(() => props.message as AssistantMessage);
  const streaming = () => props.streaming === true;
  const blocks = computed(() => assistant().content ?? []);
  // The reasoning is one row, whatever the number of thinking blocks. A
  // deferred block shows its preview until the reader opens the row.
  const thinkingBlocks = computed(() => blocks()
    .flatMap((block, index) => (block.type === "thinking" ? [{ block, index }] : []))
    .filter(({ block }) => (block.thinking ?? "").trim().length > 0));
  const reasoning = computed(() => thinkingBlocks()
    .map(({ block, index }) => thinkingTexts()[thinkingKey(props.sessionId, props.entryId, index) ?? ""] ?? block.thinking ?? "")
    .join("\n\n"));
  const deferredBlocks = computed(() => deferredThinkingBlocks(assistant()));
  // Why an opened block still shows its preview: no entry to read, a failed
  // read, or the text on its way.
  const thinkingFailure = computed(() => {
    for (const { index } of deferredBlocks()) {
      const key = thinkingKey(props.sessionId, props.entryId, index);
      if (!key) return uiText("i18n.thinkingUnavailable");
      const failure = thinkingFailures()[key];
      if (failure) return failure;
    }
    return null;
  });
  const thinkingBusy = computed(() => deferredBlocks().some(({ index }) => {
    const key = thinkingKey(props.sessionId, props.entryId, index);
    return key !== null && thinkingLoading()[key] === true;
  }));
  // Everything else keeps the order it arrived in: a tool call between two
  // paragraphs stays between them.
  const rest = computed(() => blocks().filter((block) => block.type !== "thinking"));
  const trailing = computed(() => rest().length - 1);
  const liveThinking = computed(() => streaming() && blocks().length > 0 && blocks()[blocks().length - 1].type === "thinking");
  const waitingForWords = computed(() => streaming() && rest().length === 0 && reasoning() === "");
  const label = () => assistant().model || assistant().provider || t("session.assistant");
  const stopped = computed(() => assistant().stopReason === "aborted");
  const error = computed(() => getAssistantErrorMessage(assistant(), { isStreaming: streaming() }));
  const truncated = computed(() => isAssistantTruncated(assistant(), { isStreaming: streaming() }));
  const notices = computed(() => getTranscriptNotices(assistant()));
  const answer = computed(() => blocks()
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n"));
  const openKey = () => `${props.entryId ?? "live"}:thinking`;
  const copyKey = () => `${props.entryId ?? "live"}:reply`;
  const reasoningOpen = () => openThinking()[openKey()] ?? thinkingExpandedByDefault();
  const thinkingLabel = () => {
    if (liveThinking()) return t("chat.thinking");
    // The response's own generation time is closer to the thinking than a
    // whole turn's length (which includes its tools and its answer).
    const time = assistant().durationMs ?? props.durationMs;
    const took = typeof time === "number" && time > 0 ? formatTurnDuration(time) : null;
    return took ? t("chat.thoughtFor", { time: took }) : t("chat.thought");
  };
  const preview = computed(() => getThinkingPreview(thinkingBlocks().map(({ block }) => block.thinking ?? "").join("\n\n")));
  const duration = computed(() => {
    const ms = props.durationMs;
    return typeof ms === "number" && ms > 0 ? formatTurnDuration(ms) : null;
  });
  const copy = () => {
    Clipboard.writeText(answer());
    copiedKey.set(copyKey());
    setTimeout(() => copiedKey() === copyKey() && copiedKey.set(null), 1600);
  };
  /** Records the reader's choice for this block (the remembered default is only a fallback). */
  const toggleReasoning = () => {
    const opening = !reasoningOpen();
    const key = openKey();
    openThinking.update((open) => ({ ...open, [key]: opening }));
  };

  // A block starts open from the preference (or was opened before): read every
  // deferred block then, not only when a press asks for it. The read writes
  // its own signals, so the loop is untracked.
  effect(() => {
    if (!reasoningOpen()) return;
    const deferred = deferredBlocks();
    untracked(() => {
      for (const { index } of deferred) ensureThinking(props.sessionId, props.entryId, index);
    });
  });

  // A desktop transcript is denser than a phone's: the same blocks, closer
  // together, so a reply with tools and reasoning still fits a screen.
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: platform.desktop ? 6 : 8,
        paddingBottom: platform.desktop ? 2 : 4,
        gap: platform.desktop ? 8 : 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 26 }}>
        <Avatar />
        <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: colors.muted }}>{label()}</Text>
        <If when={duration()}>{(value) => <Text style={{ fontSize: 12, color: colors.faint, fontVariant: ["tabular-nums"] }}>{value()}</Text>}</If>
        <If when={!streaming() && stopped()}>
          <Badge label={t("chat.stopped")} tone="warn" />
        </If>
      </View>

      {/* The reasoning: one folded row, opened to the whole of it. `reveal`
          clips its height and springs it through a scoped LayoutAnimation, so
          the rows below follow without JS per frame. */}
      <If when={reasoning()}>
        <Collapsible
          open={reasoningOpen()}
          reveal
          content={
            <View
              style={{
                flexDirection: "row",
                gap: platform.desktop ? 8 : 12,
                paddingLeft: platform.desktop ? 4 : 7,
                paddingTop: platform.desktop ? 6 : 8,
              }}
            >
              <View style={{ width: 2, borderRadius: 1, backgroundColor: colors.border }} />
              <If when={thinkingFailure()}
                else={
                  <If when={thinkingBusy()}
                    else={
                      <Text
                        style={{
                          userSelect: "text",
                          flex: 1,
                          fontSize: platform.desktop ? 12.5 : 14,
                          lineHeight: platform.desktop ? 18 : 20,
                          color: colors.muted,
                        }}
                      >
                        {reasoning()}
                      </Text>
                    }
                  >
                    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Spinner size={platform.desktop ? 11 : 12} tint={colors.muted} />
                      <Text
                        style={{
                          fontSize: platform.desktop ? 12.5 : 14,
                          lineHeight: platform.desktop ? 18 : 20,
                          color: colors.muted,
                        }}
                      >
                        {uiText("i18n.loadingThinking")}
                      </Text>
                    </View>
                  </If>
                }
              >
                {(message) => (
                  <Text
                    style={{
                      userSelect: "text",
                      flex: 1,
                      fontSize: platform.desktop ? 12.5 : 14,
                      lineHeight: platform.desktop ? 18 : 20,
                      color: colors.danger,
                    }}
                  >
                    {message()}
                  </Text>
                )}
              </If>
            </View>
          }
        >
          <Press
            scale={0.98}
            onPress={toggleReasoning}
            accessibilityLabel={t("i18n.thinking")}
            accessibilityState={{ selected: reasoningOpen() }}
            style={{ alignSelf: "stretch" }}
          >
            <View
              testID="thinking-row"
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: platform.desktop ? 6 : 8,
                height: platform.desktop ? 26 : 32,
                alignSelf: "flex-start",
              }}
            >
              <If
                when={liveThinking()}
                else={<Glyph name="brain" size={platform.desktop ? 14 : 16} tint={colors.muted} />}
              >
                <Spinner size={platform.desktop ? 12 : 14} tint={colors.muted} />
              </If>
              <Text
                style={{
                  fontSize: platform.desktop ? 12.5 : 14,
                  color: colors.muted,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {thinkingLabel()}
              </Text>
              <If when={!reasoningOpen()}>
                <Text
                  style={{
                    flexShrink: 1,
                    numberOfLines: 1,
                    fontSize: platform.desktop ? 11.5 : 14,
                    color: colors.faint,
                  }}
                >
                  {preview()}
                </Text>
              </If>
              <DisclosureChevron open={reasoningOpen()} />
            </View>
          </Press>
        </Collapsible>
      </If>

      <Each of={rest()} key={(block, index) => `${index}:${block.type}`}>
        {(block, index) => (
          <BlockView
            block={block()}
            blockKey={`${props.entryId ?? "live"}:${index()}`}
            streaming={streaming()}
            trailing={index() === trailing()}
            toolResults={props.toolResults}
            entryId={props.entryId}
            sessionId={props.sessionId}
          />
        )}
      </Each>

      <If when={waitingForWords()}>
        <View style={{ flexDirection: "row", height: 22, alignItems: "center" }}>
          <Caret />
        </View>
      </If>

      <If when={error()}>
        {(message) => <ErrorRow message={message()} onRetry={() => props.onRetry?.()} />}
      </If>

      <If when={truncated()}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 8,
            padding: 10,
            borderRadius: radius.inset,
            borderCurve: "continuous",
            backgroundColor: toneTint("warn"),
            borderWidth: 1,
            borderColor: alpha(colors.warn, 0.32),
          }}
        >
          <Glyph name="alert" size={16} tint={colors.warn} />
          <Text style={{ flex: 1, fontSize: density.note, lineHeight: 18, color: colors.text }}>
            {t("chat.truncatedWithoutAnswer")}
          </Text>
        </View>
      </If>

      <Each of={notices()} key="index">
        {(notice) => <NoticeRow notice={notice()} />}
      </Each>

      <If when={!streaming() && stopped()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Glyph name="stop" size={12} tint={colors.faint} />
          <Text style={{ fontSize: 13, color: colors.faint }}>{t("chat.stoppedReply")}</Text>
        </View>
      </If>

      <If when={!streaming() && !error() && answer() !== ""}>
        <View style={{ flexDirection: "row", alignItems: "center", marginLeft: -8, marginTop: -6 }}>
          <ActionButton
            glyph={copiedKey() === copyKey() ? "check" : "copy"}
            label={t("i18n.copy")}
            active={copiedKey() === copyKey()}
            tone="up"
            onPress={copy}
          />
          <ActionButton glyph="regenerate" label={t("chat.regenerate")} onPress={() => props.onRetry?.()} />
        </View>
      </If>
    </View>
  );
}

/** One block of a reply: its text, a tool call, an image. */
function BlockView(props: {
  block: AssistantContentBlock;
  blockKey: string;
  /** The reply is still being written. */
  streaming: boolean;
  /** The last block: where the caret goes. */
  trailing: boolean;
  toolResults: () => Map<string, ToolResultMessage>;
  entryId?: string;
  sessionId?: string;
}) {
  const text = computed(() => (props.block.type === "text" ? props.block.text : null));
  const toolCall = computed(() => (props.block.type === "toolCall" ? props.block : null));
  const image = computed(() => (props.block.type === "image" ? props.block : null));
  const result = computed(() => {
    const call = toolCall();
    return call ? props.toolResults().get(call.toolCallId) : undefined;
  });
  const live = () => props.streaming && props.trailing;
  // The result's images are lazy (`?deferMedia`): they are loaded once the
  // card is opened, not with every historical tool call.
  const cardOpen = () => openToolCalls()[props.blockKey] === true;
  return (
    <>
      <If when={text()}>
        {(value) => (
          <Markdown md={value()} id={props.blockKey} streaming={live()} caret={live() ? <Caret /> : undefined} />
        )}
      </If>
      <If when={toolCall()}>
        {(block) => (
          <>
            <ToolCallView block={block()} result={result()} blockKey={props.blockKey} />
            <If when={cardOpen()}>
              <Each of={resultImages(result())} key={(entry) => entry.index}>
                {(entry) => (
                  <ResultImage
                    image={entry().image}
                    index={entry().index}
                    entryId={props.entryId}
                    sessionId={props.sessionId}
                  />
                )}
              </Each>
            </If>
          </>
        )}
      </If>
      <If when={image()}>{(block) => <MessageImage image={block()} />}</If>
    </>
  );
}

/** A tool result's images, by their index in its content (the route's `blockIndex`). */
function resultImages(result: ToolResultMessage | undefined): { image: ImageContent; index: number }[] {
  if (!result) return [];
  return result.content.flatMap((block, index) => (block.type === "image" ? [{ image: block, index }] : []));
}

/**
 * One image of a tool result. A deferred block names the lazy route (the
 * bytes are read when the card opens); a live result still carries its base64
 * bytes, which `imageSource` turns into a `data:` URI.
 */
function ResultImage(props: { image: ImageContent; index: number; entryId?: string; sessionId?: string }) {
  const src = computed(() => {
    if (props.image.source?.type === "url" && props.sessionId && props.entryId) {
      return toolResultImageUrl(props.sessionId, props.entryId, props.index);
    }
    return imageSource(props.image);
  });
  return <If when={src()}>{(value) => <Photo src={value()} width={240} height={160} />}</If>;
}

// --- notices, and the messages that are not a bubble ------------------------

/** One `transcriptNotices` line (`lib/transcript-notices.ts`), as pi's TUI writes it. */
function NoticeRow(props: { notice: TranscriptNotice }) {
  return <Status label={noticeText(props.notice)} />;
}

function noticeText(notice: TranscriptNotice): string {
  switch (notice.kind) {
    case "cache_miss": {
      const cost = formatNoticeCost(notice.missedCost);
      const params = {
        tokens: formatNoticeTokens(notice.missedTokens),
        cost: cost ? t("transcriptNotice.costSuffix", { cost }) : "",
      };
      if (notice.modelChanged) return t("transcriptNotice.cacheMissModelSwitch", params);
      if (notice.idleMinutes !== undefined) return t("transcriptNotice.cacheMissIdle", { ...params, minutes: notice.idleMinutes });
      return t("transcriptNotice.cacheMiss", params);
    }
    case "cache_warm":
      return t("transcriptNotice.cacheWarmed", {
        note: notice.note ? t("transcriptNotice.cacheWarmedNote", { note: notice.note }) : "",
        cost: formatCacheWarmCost(notice.cost),
      });
    case "summary_cost": {
      const cost = formatNoticeCost(notice.cost);
      return t(notice.source === "compaction" ? "transcriptNotice.compactionCost" : "transcriptNotice.branchSummaryCost", {
        tokens: formatNoticeTokens(notice.tokens),
        cost: cost ? t("transcriptNotice.costSuffix", { cost }) : "",
      });
    }
    case "thinking_dropped":
      return t(notice.count === 1 ? "transcriptNotice.thinkingDroppedOne" : "transcriptNotice.thinkingDropped", { count: notice.count });
    default:
      return "";
  }
}

/**
 * A message that is neither a prompt nor a reply: a compaction summary, a
 * subagent's completion notice, or a `!command` pi ran itself.
 */
function OtherMessageView(props: { message: AgentMessage; sessionId?: string }) {
  const custom = computed(() => (props.message.role === "custom" ? (props.message as CustomMessage) : null));
  const bash = computed(() => (props.message.role === "bashExecution" ? (props.message as BashExecutionMessage) : null));
  const text = computed(() => {
    const message = custom();
    if (!message) return "";
    const value = contentText(message.content).replace(/\r\n?/g, "\n");
    return value.length > MAX_CUSTOM_CHARS ? `${value.slice(0, MAX_CUSTOM_CHARS)}\n…` : value;
  });
  const label = () => customLabel(custom()?.customType ?? "");
  return (
    <>
      <If when={custom()}>
        <Card title={label()} style={{ paddingVertical: 2 }}>
          <Text style={{ fontSize: density.body, lineHeight: 19, color: colors.muted, userSelect: "text" }}>{text()}</Text>
        </Card>
      </If>
      <If when={bash()}>
        {(message) => <BashOutputView message={message()} sessionId={props.sessionId} />}
      </If>
    </>
  );
}

/** A custom message's headline, by its type (`compaction`, `subagent-notification`, …). */
function customLabel(type: string): string {
  switch (type) {
    case "compaction":
      return t("chat.contextCompacted");
    case "subagent-notification":
    case "pi-web:subagent-notification":
      return t("chat.subagentFinished");
    case "":
      return t("chat.extensionMessage");
    default:
      return type;
  }
}
