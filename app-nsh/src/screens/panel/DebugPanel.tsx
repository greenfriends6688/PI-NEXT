// The dock's debug view: what the pi server holds for this app right now.
//
// pi-next's `DebugPanel` reads `GET /api/agent/debug?session=` (a read-only
// snapshot: it never starts a wrapper, opens a stream or moves an idle timer)
// and shows the server, the sessions it holds, and the open session's wrapper,
// streams, MCP host and subagent runs. The native app has no page-level
// EventSource registry to report, so this panel shows the server half — the
// half that answers "is a wrapper leaking, is a stream stuck?".
//
// A refresh button re-reads on demand. The body runs once (`tsx.md`): the
// snapshot is a resource, every row its binding.
import { resource, signal, Scroll, Text, View, type JSX } from "nsh";
import { Button, colors, Icon, sectionSurface, Status } from "../../ui/kit";
import { mono } from "../../ui/fonts";
import { api, req, withQuery } from "../../api/client";
import { errorText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { selectedSessionId } from "../../state/session";

/** The fields this panel reads (`lib/debug-types.ts`). */
interface DebugSnapshot {
  now: number;
  server: {
    startedAt: number;
    idleTimeoutMs: number;
    heartbeatMs: number;
    wrappers: { alive: number; closing: number; starting: number };
    eventStreams: { total: number };
    sseTotal: number;
    fileWatches: number;
    terminals: { count: number; listeners: number; detached: number; exited: number };
  };
  sessions: Array<{
    sessionId: string;
    state: "alive" | "closing" | "none";
    running: boolean;
    awaitingInput: boolean;
    subagent: boolean;
    eventStreams: number;
    starts: number;
  }>;
  session: {
    sessionId: string;
    wrapper: { running?: boolean; model?: { provider?: string; id?: string } } | null;
    starting: boolean;
    eventStreams: unknown[];
    subagents: { active: boolean; runs: unknown[] };
    mcp: { status?: string; servers?: unknown[] } | null;
  } | null;
}

/** A long duration as minutes / hours / days (debug numbers, not a clock). */
function duration(ms: number): string {
  const value = Math.max(0, Math.round(ms / 1000));
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`;
  if (value < 86400) return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
  return `${Math.floor(value / 86400)}d ${Math.floor((value % 86400) / 3600)}h`;
}

/** A session id, short enough for a row (`01a1dce1…`). */
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/** A label / value row. */
function Fact(props: { label: string; value: string; tone?: "accent" | "warn" | "danger" }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 22 }}>
      <Text style={{ width: 132, flexShrink: 0, fontSize: 11, color: colors.faint }}>{props.label}</Text>
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 11.5,
          fontFamily: mono,
          color: props.tone === "danger" ? colors.danger : props.tone === "warn" ? colors.warn : colors.text,
        }}
      >
        {props.value}
      </Text>
    </View>
  );
}

/** A section: a title over its facts. */
function Section(props: { title: string; children: JSX.Element }) {
  return (
    <View style={{ ...sectionSurface({ padded: true }), gap: 4, padding: 10 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.text, paddingBottom: 4 }}>{props.title}</Text>
      {props.children}
    </View>
  );
}

export function DebugPanel() {
  const nonce = signal(0);
  const snapshot = resource(
    () => `${selectedSessionId() ?? ""}:${nonce()}`,
    async (key, info) => {
      const session = key.slice(0, key.lastIndexOf(":"));
      return req<DebugSnapshot>(
        withQuery("/api/agent/debug", { session: session || undefined }),
        {},
        { signal: info.signal },
      );
    },
  );

  const now = () => Date.now();
  const uptime = () => duration(now() - (snapshot()?.server.startedAt ?? now()));

  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.surface }}>
      <View
        style={{
          height: 36,
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <Text style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: colors.muted, numberOfLines: 1 }}>
          {t("debug.panelLabel")}
        </Text>
        <Button
          label={t("changes.retry")}
          icon="undo"
          variant="secondary"
          size="small"
          onPress={() => nonce.update((value) => value + 1)}
        />
      </View>

      <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ padding: 10, gap: 8 }}>
        <If when={snapshot.error()}>
          <Text style={{ fontSize: 11.5, color: colors.danger }}>{errorText(snapshot.error())}</Text>
        </If>
        <If when={!snapshot() && !snapshot.error()}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="chart" size={12} tint={colors.faint} />
            <Text style={{ fontSize: 11.5, color: colors.muted }}>{t("debug.reading")}</Text>
          </View>
        </If>

        <If when={snapshot()}>
          <Section title={`${api.base()} · ${t("debug.title")}`}>
            <Fact label={t("debug.serverUptime")} value={uptime()} />
            <Fact label={t("debug.wrappers")} value={`${snapshot()?.server.wrappers.alive ?? 0} · ${t("debug.starting")} ${snapshot()?.server.wrappers.starting ?? 0} · ${t("debug.closing")} ${snapshot()?.server.wrappers.closing ?? 0}`} />
            <Fact label={t("debug.streams")} value={`${snapshot()?.server.eventStreams.total ?? 0} agent · ${snapshot()?.server.sseTotal ?? 0} SSE`} />
            <Fact label={t("debug.fileWatches")} value={String(snapshot()?.server.fileWatches ?? 0)} />
            <Fact label={t("debug.terminals")} value={`${snapshot()?.server.terminals.count ?? 0} · ${snapshot()?.server.terminals.listeners ?? 0} ${t("debug.listeners")} · ${snapshot()?.server.terminals.detached ?? 0} ${t("debug.detached")}`} />
          </Section>

          <Section title={`${t("debug.sessions")} · ${snapshot()?.sessions.length ?? 0}`}>
            <Each of={snapshot()?.sessions ?? []} key={(session) => session.sessionId}>
              {(session) => (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 24 }}>
                  <Status
                    label={session().running ? t("chat.statsWorking") : t("chat.statsIdle")}
                    tone={session().running ? "info" : "neutral"}
                  />
                  <Text style={{ flex: 1, minWidth: 0, fontSize: 11, fontFamily: mono, color: colors.text, numberOfLines: 1 }}>
                    {shortId(session().sessionId)}
                  </Text>
                  <Text style={{ fontSize: 10.5, color: colors.faint }}>
                    {`${session().state} · ${session().eventStreams}× · ${session().starts}↑`}
                  </Text>
                </View>
              )}
            </Each>
          </Section>

          <If when={snapshot()?.session}>
            <Section title={`${t("debug.selectedSession")} · ${shortId(snapshot()?.session?.sessionId ?? "")}`}>
              <Fact label={t("debug.wrapper")} value={snapshot()?.session?.wrapper ? t("debug.yes") : t("debug.no")} />
              <Fact label={t("debug.starting")} value={snapshot()?.session?.starting ? t("debug.yes") : t("debug.no")} />
              <Fact label={t("debug.streams")} value={String(snapshot()?.session?.eventStreams.length ?? 0)} />
              <Fact label={t("debug.subagents")} value={`${snapshot()?.session?.subagents.active ? t("debug.yes") : t("debug.no")} · ${snapshot()?.session?.subagents.runs.length ?? 0}`} />
              <Fact label={t("debug.mcp")} value={snapshot()?.session?.mcp ? (snapshot()?.session?.mcp?.status ?? t("debug.yes")) : t("debug.none")} />
            </Section>
          </If>
        </If>

        <Text style={{ fontSize: 10.5, lineHeight: 15, color: colors.faint }}>{t("debug.readOnly")}</Text>
      </Scroll>
    </View>
  );
}
