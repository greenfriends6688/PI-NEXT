// The terminal pane: `nsh/base`'s `Terminal` (a full VT emulator) wired to
// the pi-web host's node-pty over HTTP + SSE.
//
// Why not xterm.js: NSH already ships the emulator (`crates/nsh-base/src/term/
// mod.rs:41-115`), so this file only moves bytes. The pty lives on the
// desktop/phone host (`lib/terminal-manager.ts`), never inside the app:
//
//   first layout -> onResize({cols, rows}) -> POST /api/terminal
//   SSE output   -> ref.write(data)  (or ref.reset() then write on `reset`)
//   onData({data}) -> POST { type: "input", data }
//   onResize     -> POST { type: "resize", cols, rows }
//   unmount      -> close SSE + DELETE /api/terminal/[id]
//
// The server's frames, cursor and replay are in `app/api/terminal/[id]/events/
// route.ts`; `api/terminal.ts` wraps them and `sse.ts` owns reconnection.
//
// The look is the gallery's kit (`../../ui/kit`): the panel is a
// `sectionSurface()`, the header's tools sit in a `toolbarTrack()` with
// `iconButtonLook` buttons and a `toolbarRule` between them, and the status
// line uses `Status`, `Badge` and `Spinner`. The numbers are pi-next's
// terminal panel (`app/v5/panel.css:928-1010`): a 32-point header, a
// 22-point status line, the terminal's 10 / 10 / 8 padding.
//
// The touch bar (`TerminalExtraKeys`) sends the sequences pi-next's
// `lib/terminal-extra-keys.ts` defines; NSH's `Terminal` still owns every
// hardware key it receives.

import { cleanup, effect, signal, Text, View } from "nsh";
import { Terminal, type TerminalRef } from "nsh/base";
import {
  alpha,
  Badge,
  colors,
  Icon,
  iconButtonGlyph,
  iconButtonLook,
  Inset,
  Press,
  sectionSurface,
  Spinner,
  Status,
  toolbarRule,
  toolbarTrack,
  type IconName,
  type Tone,
} from "../../ui/kit";
import { errorText as readableError } from "../../ui/errors";
import {
  createTerminal,
  killTerminal,
  openTerminalOutput,
  resizeTerminal,
  writeTerminalInput,
  type TerminalEvent,
} from "../../api/terminal";
import { activeCwd, selectedSessionId } from "../../state/session";
import { t } from "../../ui/i18n";
import { showTerminalExtraKeys, TerminalExtraKeys } from "./TerminalExtraKeys";

/** Same size as the chat body, so the two panes read at one scale. */
const FONT_SIZE = 13;
/** NSH's own default row height (`TerminalProps.lineHeight`). */
const LINE_HEIGHT = 18;
/** More than the server's 128 KiB replay (`MAX_BACKLOG`), for scrollback in the view. */
const SCROLLBACK = 5000;

/** pi-next's terminal header and status line (`app/v5/panel.css:930-1000`). */
const HEADER_HEIGHT = 40;
const HEADER_PADDING_START = 12;
const HEADER_PADDING_END = 8;
/** The terminal body: 10 points around it, 8 below (`terminal-xterm`). */
const BODY_PADDING = { top: 10, side: 10, bottom: 8 };

type Phase = "connecting" | "ready" | "closed" | "error";

/** The tone of a connection state: green ready, blue while connecting,
 * the danger tone on a failure, quiet once the shell is gone. */
function phaseTone(phase: Phase): Tone {
  if (phase === "ready") return "up";
  if (phase === "connecting") return "info";
  if (phase === "error") return "danger";
  return "neutral";
}

/** What each connection state is called, in the reader's language. */
const PHASE_KEYS: Record<Phase, string> = {
  connecting: "terminal.connecting",
  ready: "terminal.ready",
  closed: "terminal.exited",
  error: "terminal.error",
};

/** A header tool: `iconButtonLook`'s square icon button (28 points with a
 * pointer, 40 on a touch screen), bare until the pointer is over it. */
function ToolButton(props: { icon: IconName; label: string; onPress: () => void }) {
  const look = iconButtonLook();
  return (
    <View {...look} onPress={props.onPress} accessibilityLabel={props.label} role="button">
      <Icon name={props.icon} {...iconButtonGlyph()} />
    </View>
  );
}

export interface TerminalViewProps {
  /** The shell's folder; defaults to the open session's `activeCwd()`. */
  cwd?: string | null;
  /** The session this pane belongs to (defaults to `selectedSessionId()`). */
  sessionId?: string | null;
  /** Classes of the outer column, over the panel's own style. */
  class?: string | null;
  /** What screen readers call the terminal. */
  accessibilityLabel?: string | null;
  /** The program set its window title (OSC 0/2). */
  onTitleChange?: (title: string) => void;
  /** The shell's process ended (`exit` or a server-side `closed`). */
  onExit?: (exitCode: number) => void;
}

export function TerminalView(props: TerminalViewProps) {
  let term: TerminalRef | undefined;
  let terminalId: string | null = null;
  let outputClose: (() => void) | null = null;
  /** The last `onResize` size; the create call needs it and a late create may miss a resize. */
  let lastSize: { cols: number; rows: number } | null = null;
  let starting = false;
  let running = false;
  let disposed = false;
  /** Bumped by every stop/start: a create or SSE callback of an older shell is ignored. */
  let generation = 0;
  /** The session/cwd pair the pane follows; a different one starts a new shell. */
  let workspaceKey = "";

  const phase = signal<Phase>("connecting");
  const sizeLabel = signal("");
  const errorText = signal<string | null>(null);

  const session = (): string | null => (
    props.sessionId !== undefined ? props.sessionId : selectedSessionId()
  );
  const cwd = (): string | null => (
    props.cwd !== undefined ? props.cwd : activeCwd()
  );

  /** Stops the stream and the shell, if any. Safe to call twice. */
  const stop = (): void => {
    generation += 1;
    outputClose?.();
    outputClose = null;
    running = false;
    starting = false;
    const id = terminalId;
    terminalId = null;
    if (id) void killTerminal(id).catch(() => {});
  };

  const start = (cols: number, rows: number, folder: string): void => {
    if (disposed || starting || terminalId) return;
    const token = ++generation;
    starting = true;
    errorText.set(null);
    phase.set("connecting");
    void createTerminal({ cwd: folder, cols, rows })
      .then(({ id }) => {
        if (disposed || token !== generation) {
          // The pane went (or another shell began) while the POST was on its
          // way; nobody will draw this one.
          void killTerminal(id).catch(() => {});
          return;
        }
        starting = false;
        terminalId = id;
        running = true;
        phase.set("ready");
        const handle = (event: TerminalEvent): void => {
          if (disposed || token !== generation) return;
          if (event.type === "output") {
            // The server's cursor fell outside its bounded backlog: the screen
            // must be cleared before the full replay (`subscribeTerminal()`).
            if (event.reset) term?.reset();
            term?.write(event.data);
            return;
          }
          running = false;
          phase.set("closed");
          if (event.type === "exit") props.onExit?.(event.exitCode);
        };
        outputClose = openTerminalOutput(id, handle, {
          onOpen: () => {
            if (disposed || token !== generation) return;
            errorText.set(null);
            phase.set("ready");
          },
          onError: (_error, info) => {
            if (disposed || token !== generation) return;
            if (info.willRetry) {
              phase.set("connecting");
              return;
            }
            phase.set("error");
            errorText.set(
              info.status === undefined
                ? t("terminal.outputClosed")
                : t("terminal.outputClosedStatus", { status: info.status }),
            );
          },
        });
        // The layout may have resized while the create was pending.
        const size = lastSize;
        if (size && (size.cols !== cols || size.rows !== rows)) {
          void resizeTerminal(id, size.cols, size.rows).catch(() => {});
        }
        term?.focus();
      })
      .catch((error: unknown) => {
        if (disposed || token !== generation) return;
        starting = false;
        phase.set("error");
        errorText.set(readableError(error));
      });
  };

  // The first layout (and every later size change) reports the cell grid.
  // Before the first one there is no size to spawn a pty at.
  const onResize = ({ cols, rows }: { cols: number; rows: number }): void => {
    lastSize = { cols, rows };
    sizeLabel.set(`${cols}×${rows}`);
    const id = terminalId;
    if (id) {
      if (!running) return;
      void resizeTerminal(id, cols, rows).catch((error: unknown) => {
        if (disposed || terminalId !== id) return;
        phase.set("error");
        errorText.set(readableError(error));
      });
      return;
    }
    const folder = cwd();
    if (folder) start(cols, rows, folder);
  };

  /** One failed input write ends the pane's use of a dead shell. */
  const inputFailed = (id: string, error: unknown): void => {
    if (disposed || terminalId !== id) return;
    phase.set("error");
    errorText.set(readableError(error));
  };

  const onData = ({ data }: { data: string }): void => {
    const id = terminalId;
    if (!id || !running || disposed) return;
    void writeTerminalInput(id, data).catch((error: unknown) => inputFailed(id, error));
  };

  /** A key of the touch bar: the same pty input path as a hardware key. */
  const sendExtraKey = (sequence: string): void => {
    const id = terminalId;
    if (!id || !running || disposed) return;
    void writeTerminalInput(id, sequence).catch((error: unknown) => inputFailed(id, error));
  };

  /** "retry" in the status row: kills a half-working shell and starts another. */
  const retry = (): void => {
    const folder = cwd();
    const size = lastSize;
    if (disposed || !folder || !size) return;
    stop();
    start(size.cols, size.rows, folder);
  };

  // A session switch (or a workspace change) means a different shell. The
  // parent's layout may keep the same `Terminal` node, so this restarts it
  // explicitly instead of waiting for a size change that may never come.
  effect(() => {
    const id = session();
    const folder = cwd();
    const key = `${id ?? ""}\u0000${folder ?? ""}`;
    if (key === workspaceKey) return;
    workspaceKey = key;
    if (terminalId || starting) stop();
    errorText.set(null);
    if (!folder) {
      phase.set("error");
      return;
    }
    phase.set("connecting");
    const size = lastSize;
    if (size) start(size.cols, size.rows, folder);
  });

  // Leaving the pane kills the pty as well as closing the stream: the server
  // would keep an unobserved shell for two minutes otherwise
  // (`TERMINAL_RECONNECT_MS` in `lib/terminal-manager.ts`).
  cleanup(() => {
    disposed = true;
    stop();
  });

  return (
    <View class={props.class ?? undefined} style={{ ...sectionSurface(), flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* pi-next's `.terminal-panel-header`: the path, then the tools. */}
      <View
        style={{
          minHeight: HEADER_HEIGHT,
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingStart: HEADER_PADDING_START,
          paddingEnd: HEADER_PADDING_END,
          paddingVertical: 2,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <Icon name="terminal" size={13} tint={colors.faint} />
        <Text style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: colors.muted, numberOfLines: 1 }}>{cwd() ?? t("terminal.title")}</Text>
        <View style={toolbarTrack()}>
          <ToolButton icon="undo" label={t("terminal.restart")} onPress={retry} />
          <View style={toolbarRule()} />
          <ToolButton icon="terminal" label={t("terminal.focus")} onPress={() => term?.focus()} />
        </View>
      </View>

      {/* The emulator keeps the whole middle; its default background is the
          view's own (`term/mod.rs:259-270`), so only the color and padding
          are the app's. `fontFamily` is left out on purpose: its default is
          the theme's `font-mono` (`term/mod.rs:51,226-231`). */}
      <View style={{ flex: 1, minHeight: 0, paddingTop: BODY_PADDING.top, paddingHorizontal: BODY_PADDING.side, paddingBottom: BODY_PADDING.bottom }}>
        <Terminal
          ref={(r) => {
            term = r;
          }}
          scrollback={SCROLLBACK}
          fontSize={FONT_SIZE}
          lineHeight={LINE_HEIGHT}
          accessibilityLabel={props.accessibilityLabel ?? t("terminal.title")}
          cursorStyle={{ backgroundColor: alpha(colors.text, 0.6) }}
          style={{ flex: 1, minHeight: 0, backgroundColor: colors.background }}
          onData={onData}
          onResize={onResize}
          onTitleChange={({ title }) => props.onTitleChange?.(title)}
        />
      </View>

      {/* The status line: what the shell is doing, its cell grid, and a
          failure's message (pi-next's `.terminal-panel-status`). */}
      <View style={{ flexShrink: 0, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface }}>
        <Inset padding={6} gap={6}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <If when={phase() === "connecting"}>
              <Spinner size={11} tint={colors.accent} />
            </If>
            <Status label={t(PHASE_KEYS[phase()])} tone={phaseTone(phase())} />
            <If when={sizeLabel()}>
              {(size) => <Badge label={size()} outline />}
            </If>
            <View style={{ flex: 1, minWidth: 0 }} />
            <If when={errorText()}>
              {(message) => (
                <Text style={{ flexShrink: 1, fontSize: 11.5, color: colors.danger, numberOfLines: 1 }}>{message()}</Text>
              )}
            </If>
            <If when={phase() === "error" && !cwd() && !errorText()}>
              <Text style={{ flexShrink: 1, fontSize: 11.5, color: colors.danger, numberOfLines: 1 }}>
                {t("common.noWorkingDirectory")}
              </Text>
            </If>
          </View>
        </Inset>
      </View>

      {/* A software keyboard leaves out Ctrl, Alt, Esc, Tab and the arrows. */}
      <If when={showTerminalExtraKeys}>
        <TerminalExtraKeys onKey={sendExtraKey} />
      </If>
    </View>
  );
}
