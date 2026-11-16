// One tool call: the gallery's tool card (`ui/chat/parts.tsx` `ToolCard`, from
// `demos/chat/parts.tsx:134`), opened to its arguments (`lib/tool-fields.ts`)
// and its result.
//
// The card's frame — the surface, the icon tile, the name, the one-line detail
// and the state (a spinner while it runs, a badge after) — is the gallery's,
// unchanged. Its body is ours, because our calls carry a real tool's arguments
// and output rather than the demo's scripted search / weather / code.
//
// A result that carries a patch (`details.patch` / `details.diff`) is drawn as
// a diff through `lib/patch.ts`, which is pi's own parser (`parseUnifiedPatch`
// → `unifiedDiffLines`), not a second one. Everything else is monospaced text,
// cut at a limit so one `bash` dumping a log cannot make a row of megabytes.
//
// The open/closed state lives in `state/agent.ts` keyed by block, never in a
// signal of the card: list rows are recycled, and a signal created here would
// travel to the next item (`tsx.md` "List").
import { computed, openUrl, platform, Scroll, signal, Text, View } from "nsh";
import { bashOutputUrl, readBashOutput } from "../../api/agent";
import { diffGapLabel, parseUnifiedPatch, unifiedDiffLines, type SplitDiffFile, type SplitDiffGap, type UnifiedDiffLine } from "../../lib/patch";
import { toolFieldsOfInput } from "../../lib/tool-fields";
import type { BashExecutionMessage, TextContent, ToolCallContent, ToolResultMessage } from "../../lib/types";
import { openToolCalls, toggleToolCall } from "../../state/agent";
import { openAgentTab } from "../panel/actions";
import { ToolCard, type ToolState } from "../../ui/chat/parts";
import { errorText, uiText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { alpha, Button, Card, colors, Icon, type IconName, insetSurface, mono, plainRow, Press, toneTint } from "../../ui/kit";

/** A result longer than this is cut: a tool can print a whole log. */
const MAX_RESULT_CHARS = 6_000;

/** Below this a card shows no time: it would read 0.0s on every quick read. */
const MIN_DURATION_MS = 100;

/** A tool's run time as pi's "Took" writes it: 2.4s, then 3m 5s, then 1h 2m 5s. */
function formatToolDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${total % 60}s`;
}

/** The icon of a step, by what the tool does (pi's `STEP_ICON_RULES`), in the kit's glyphs. */
function toolIcon(name: string): IconName {
  const tool = name.toLowerCase();
  if (/write|edit|patch|apply|replace|delete/.test(tool)) return "replace";
  if (/bash|shell|terminal|exec|command|spawn|powershell/.test(tool)) return "terminal";
  if (/grep|search|glob|find|list|scan/.test(tool)) return "search";
  if (/read|cat|open|doc|file/.test(tool)) return "file";
  if (/web|fetch|http|url|browse/.test(tool)) return "link";
  if (/image|photo|screenshot/.test(tool)) return "image";
  return "layers";
}

/** The one-line subject of a call: its command, path, pattern, or first argument. */
function toolPreview(block: ToolCallContent): string {
  if (block.rawInput !== undefined) return t("chat.generatingToolInput");
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  if (typeof input.command === "string") return input.command.slice(0, 120);
  if (typeof input.path === "string") return input.path.slice(0, 120);
  if (typeof input.file_path === "string") return input.file_path.slice(0, 120);
  if (typeof input.pattern === "string") return input.pattern.slice(0, 120);
  if (typeof input.query === "string") return input.query.slice(0, 120);
  if (typeof input.url === "string") return input.url.slice(0, 120);
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  const first = input[keys[0]];
  return typeof first === "string" ? first.slice(0, 120) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A result's text blocks, joined. */
function resultText(result: ToolResultMessage | undefined): string {
  if (!result) return "";
  return result.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/** The patch a result carries, if any (`details.patch`, else `details.diff`), as files. */
function resultDiff(result: ToolResultMessage | undefined): SplitDiffFile[] | null {
  if (!result || result.isError) return null;
  const details = result.details;
  if (!isRecord(details)) return null;
  const patch = typeof details.patch === "string" ? details.patch : typeof details.diff === "string" ? details.diff : null;
  return patch ? parseUnifiedPatch(patch) : null;
}

/** The subagent a result belongs to, if it is the `Agent` tool's (`details.kind === "pi-web-subagent"`). */
function subagentOf(result: ToolResultMessage | undefined): { sessionId: string; label?: string } | null {
  const details = result?.details;
  if (!isRecord(details) || details.kind !== "pi-web-subagent" || typeof details.sessionId !== "string") return null;
  const description = typeof details.description === "string" ? details.description.trim() : "";
  const profile = typeof details.profile === "string" ? details.profile.trim() : "";
  const label = description || profile;
  return { sessionId: details.sessionId, ...(label ? { label } : {}) };
}

/** Whether a result says it failed: an error flag, or a command's non-zero exit. */
function failed(result: ToolResultMessage | undefined): boolean {
  if (!result) return false;
  if (result.isError) return true;
  const exit = /Command exited with code (\d+)/.exec(resultText(result));
  return !!exit && exit[1] !== "0";
}

/** The card's state, in the gallery's four words and one for a failure. */
function toolState(block: ToolCallContent, result: ToolResultMessage | undefined): ToolState {
  // Still streaming its arguments: the call is queued, not running yet.
  if (block.rawInput !== undefined) return "pending";
  if (!result) return "running";
  if (failed(result)) return "failed";
  if (isRecord(result.details) && result.details.cancelled === true) return "cancelled";
  return "done";
}

export interface ToolCallViewProps {
  block: ToolCallContent;
  /** The call's result, live while it runs (`state/agent.ts` `activeToolResults`). */
  result?: ToolResultMessage;
  /** The block's key: its open state lives under it. */
  blockKey: string;
}

/** One tool call card, closed to a line and open to its arguments and result. */
export function ToolCallView(props: ToolCallViewProps) {
  const block = computed(() => props.block);
  const open = () => openToolCalls()[props.blockKey] === true;
  const name = () => block().toolName || t("chat.tool");
  const preview = () => toolPreview(block());
  const state = computed(() => toolState(block(), props.result));
  const subagent = computed(() => subagentOf(props.result));
  // Flat arguments as rows, unless the call is still streaming its JSON or its
  // arguments are nested (`lib/tool-fields.ts`).
  const fields = computed(() => (block().rawInput === undefined ? toolFieldsOfInput(block().input) : null));
  const inputText = computed(() => block().rawInput ?? JSON.stringify(block().input, null, 2));
  const diff = computed(() => resultDiff(props.result));
  const output = computed(() => {
    const text = resultText(props.result);
    return text.length > MAX_RESULT_CHARS
      ? `${text.slice(0, MAX_RESULT_CHARS)}\n… ${t("chat.moreCharacters", { count: text.length - MAX_RESULT_CHARS })}`
      : text;
  });
  const empty = computed(() => {
    if (!props.result) return false;
    const text = output().trim();
    return text === "" || text === "(no output)";
  });
  const duration = computed(() => {
    const ms = props.result?.durationMs;
    return typeof ms === "number" && ms >= MIN_DURATION_MS ? formatToolDuration(ms) : null;
  });
  const detail = () => {
    const time = duration();
    const subject = preview();
    if (!time) return subject;
    return subject ? `${subject} · ${time}` : time;
  };

  return (
    <ToolCard
      icon={toolIcon(block().toolName)}
      title={name()}
      detail={detail()}
      state={state()}
      open={open()}
      onPress={() => toggleToolCall(props.blockKey)}
    >
      <If when={subagent()}>
        {(child) => (
          <Press
            onPress={() => openAgentTab(child().sessionId, child().label)}
            accessibilityLabel={t("subagent.open")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: platform.desktop ? 8 : 12,
              paddingVertical: platform.desktop ? 6 : 7,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
            hoverStyle={{ backgroundColor: colors.raised }}
          >
            <Icon name="external" size={12} tint={colors.accent} />
            <Text style={{ flex: 1, fontSize: 12, color: colors.accent }}>{t("subagent.open")}</Text>
          </Press>
        )}
      </If>
      <If when={open()}>
        <View testID="tool-card-body" style={{ borderTopWidth: 1, borderTopColor: colors.line, padding: 8, gap: 6 }}>
          {/* The arguments: rows when flat, the JSON otherwise (streamed input is incomplete JSON). */}
          <If when={fields()} else={<ScrollingText text={inputText()} tone="muted" />}>
            {(list) => (
              <View>
                <Each of={list()} key={(field) => field.key}>
                  {(field, index) => (
                    <View
                      style={{
                        ...plainRow({ first: index() === 0, dense: true }),
                        alignItems: field().multiline ? "flex-start" : "center",
                      }}
                    >
                      <Text style={{ width: 88, fontFamily: mono, fontSize: 11, color: colors.muted }}>
                        {field().key}
                      </Text>
                      <Text
                        style={{
                          flex: 1,
                          fontFamily: mono,
                          fontSize: 11.5,
                          lineHeight: 16,
                          color: colors.text,
                          userSelect: "text",
                        }}
                      >
                        {field().value}
                      </Text>
                    </View>
                  )}
                </Each>
              </View>
            )}
          </If>

          {/* The result: a diff when it carries a patch, its text otherwise. */}
          <If when={diff()}>
            {(files) => <DiffView files={files() ?? []} />}
          </If>
          <If when={!diff() && empty()}>
            <Text style={{ fontFamily: mono, fontSize: 11.5, fontStyle: "italic", color: colors.faint }}>
              {t("i18n.noOutput")}
            </Text>
          </If>
          <If when={!diff() && !empty() && output() !== ""}>
            <ScrollingText text={output()} tone={state() === "failed" ? "error" : "plain"} />
          </If>
        </View>
      </If>
    </ToolCard>
  );
}

// --- a `!command` run's full output -----------------------------------------
//
// pi spills a long bash output to a `pi-bash-*.log` and leaves the message
// `truncated` with `fullOutputPath`. `GET /api/agent/[id]/bash-output?path=`
// reads it back (the route only accepts a path one of the session's
// `bashExecution` entries names), and `?download=1` streams it as a file, which
// `openUrl` hands to the system browser. The cache is keyed by session and
// path, not by row: list rows are recycled (`tsx.md` "List").

/** Full outputs already read, by `sessionId:path`. */
const bashOutputs = signal<Record<string, string>>({});
/** Reads on their way, by the same key. */
const bashLoading = signal<Record<string, boolean>>({});
/** Why a read or a download failed, by the same key. */
const bashErrors = signal<Record<string, string>>({});
/** One request per file, shared by every view of it. */
const bashRequests = new Map<string, Promise<void>>();
/** A log can be 5 MB: keep a few, not every one the reader opened. */
const MAX_BASH_OUTPUT_CACHE_ENTRIES = 4;

/** Stores the output, dropping the oldest entries past the cap. */
function rememberBashOutput(key: string, output: string): void {
  bashOutputs.update((all) => {
    const next = { ...all, [key]: output };
    const keys = Object.keys(next);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_BASH_OUTPUT_CACHE_ENTRIES))) delete next[old];
    return next;
  });
}

function bashKey(sessionId: string | undefined, path: string | undefined): string | null {
  return sessionId && path ? `${sessionId}:${path}` : null;
}

function loadBashOutput(sessionId: string, path: string): void {
  const key = `${sessionId}:${path}`;
  if (bashRequests.has(key) || bashOutputs()[key] !== undefined) return;
  bashLoading.update((all) => ({ ...all, [key]: true }));
  bashErrors.update((all) => {
    if (all[key] === undefined) return all;
    const next = { ...all };
    delete next[key];
    return next;
  });
  const request = readBashOutput(sessionId, path)
    .then((output) => rememberBashOutput(key, output))
    .catch((cause: unknown) => bashErrors.update((all) => ({ ...all, [key]: errorText(cause) })))
    .finally(() => {
      bashRequests.delete(key);
      bashLoading.update((all) => {
        if (all[key] === undefined) return all;
        const next = { ...all };
        delete next[key];
        return next;
      });
    });
  bashRequests.set(key, request);
}

/**
 * A `!command` message: its command, its output (the whole log once read), and
 * "view full output" / "download" while the message says it was truncated.
 */
export function BashOutputView(props: { message: BashExecutionMessage; sessionId?: string }) {
  const message = computed(() => props.message);
  const path = computed(() => message().fullOutputPath);
  const key = computed(() => bashKey(props.sessionId, path()));
  const output = computed(() => {
    const k = key();
    return (k === null ? undefined : bashOutputs()[k]) ?? message().output;
  });
  const loaded = computed(() => {
    const k = key();
    return k !== null && bashOutputs()[k] !== undefined;
  });
  const loading = computed(() => {
    const k = key();
    return k !== null && bashLoading()[k] === true;
  });
  const failure = computed(() => {
    const k = key();
    return k === null ? null : bashErrors()[k] ?? null;
  });

  const load = () => {
    const sessionId = props.sessionId;
    const file = path();
    if (sessionId && file) loadBashOutput(sessionId, file);
  };
  const download = async () => {
    const sessionId = props.sessionId;
    const file = path();
    if (!sessionId || !file) return;
    try {
      await openUrl(bashOutputUrl(sessionId, file, true));
    } catch (cause) {
      const k = bashKey(sessionId, file);
      if (k) bashErrors.update((all) => ({ ...all, [k]: errorText(cause) }));
    }
  };

  return (
    <Card title={`$ ${message().command}`} style={{ paddingVertical: 0 }}>
      <View style={{ gap: 3 }}>
        <Scroll style={{ maxHeight: 240 }} scrollbar={false}>
          <Text
            style={{ fontFamily: mono, fontSize: 12, lineHeight: 18, color: colors.muted, userSelect: "text" }}
          >{output()}</Text>
        </Scroll>
        <If when={message().truncated}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <If when={props.sessionId !== undefined && path() !== undefined && !loaded()}>
              <Button
                label={loading() ? uiText("chat.loadingFullOutput") : uiText("chat.viewFullOutput")}
                variant="ghost"
                size="small"
                busy={loading()}
                disabled={loading()}
                onPress={load}
              />
            </If>
            <If when={props.sessionId !== undefined && path()}>
              <Button
                label={uiText("chat.downloadFullOutput")}
                variant="ghost"
                size="small"
                onPress={() => void download()}
              />
            </If>
            <If when={!path()}>
              <Text style={{ fontSize: 11.5, color: colors.faint }}>{uiText("errors.outputUnavailable")}</Text>
            </If>
            <If when={failure()}>
              {(text) => <Text style={{ flex: 1, fontSize: 11.5, color: colors.danger }}>{text()}</Text>}
            </If>
          </View>
        </If>
      </View>
    </Card>
  );
}

/** Result text in a well that scrolls instead of growing the row. */
function ScrollingText(props: { text: string; tone: "plain" | "muted" | "error" }) {
  const color = () => (props.tone === "error" ? colors.danger : props.tone === "muted" ? colors.muted : colors.text);
  return (
    <View
      style={{
        ...insetSurface(),
        overflow: "hidden",
        borderColor: props.tone === "error" ? alpha(colors.danger, 0.35) : colors.line,
      }}
    >
      <Scroll style={{ maxHeight: 320 }} scrollbar={false}>
        <Text
          style={{
            padding: 8,
            fontFamily: mono,
            fontSize: 12,
            lineHeight: 17,
            color: color(),
            userSelect: "text",
          }}
        >
          {props.text}
        </Text>
      </Scroll>
    </View>
  );
}

/** One patch as a single column (the stacked layout): every line with its number.
 * TODO(nsh): the kit's `diffViewStyles` / `DiffHunkActions` target its workspace
 * editor; render through them once they expose a single-column chat diff. */
function DiffView(props: { files: SplitDiffFile[] }) {
  return (
    <View style={{ gap: 6 }}>
      <Each of={props.files} key={(file, index) => `${index}:${file.newPath ?? file.oldPath ?? ""}`}>
        {(file) => (
          <View style={{ ...insetSurface(), overflow: "hidden" }}>
            <Text
              style={{
                backgroundColor: colors.inset,
                paddingHorizontal: 7,
                paddingVertical: 3,
                fontFamily: mono,
                fontSize: 11.5,
                color: colors.muted,
              }}
            >
              {file().newPath ?? file().oldPath ?? t("chat.patch")}
            </Text>
            <Each of={unifiedDiffLines(file())} key="index">
              {(line) => (
                <If when={line().type === "gap"} else={<DiffLine line={line() as UnifiedDiffLine} />}>
                  <DiffGap gap={line() as SplitDiffGap} />
                </If>
              )}
            </Each>
          </View>
        )}
      </Each>
    </View>
  );
}

function DiffLine(props: { line: UnifiedDiffLine }) {
  const marker = () => (props.line.type === "added" ? "+" : props.line.type === "removed" ? "-" : " ");
  const fill = () => (props.line.type === "added" ? toneTint("up") : props.line.type === "removed" ? toneTint("down") : undefined);
  return (
    <View style={{ flexDirection: "row", backgroundColor: fill() }}>
      <Text
        style={{
          width: 40,
          paddingHorizontal: 4,
          fontFamily: mono,
          fontSize: 11,
          lineHeight: 17,
          textAlign: "right",
          color: colors.faint,
          fontVariant: ["tabular-nums"],
        }}
      >
        {props.line.newLineNo ?? props.line.oldLineNo ?? ""}
      </Text>
      <Text
        style={{
          flex: 1,
          paddingRight: 6,
          fontFamily: mono,
          fontSize: 11.5,
          lineHeight: 17,
          color: colors.text,
          userSelect: "text",
        }}
      >
        {`${marker()}${props.line.text}`}
      </Text>
    </View>
  );
}

function DiffGap(props: { gap: SplitDiffGap }) {
  const text = () => (props.gap.count === null ? "⋯" : diffGapLabel(props.gap.count, t));
  return (
    <Text
      style={{
        backgroundColor: colors.inset,
        paddingHorizontal: 8,
        paddingVertical: 3,
        fontFamily: mono,
        fontSize: 11,
        color: colors.muted,
      }}
    >
      {text()}
    </Text>
  );
}
