// Settings › MCP: the servers the agent's MCP extension loads, drawn as the
// reference's list + detail page: a middle list grouped by scope (the
// project's entries first, then the global file's, including the project
// overrides the route returns), and the selected server's header, actions,
// status and facts at the right. "Add MCP" replaces the detail with the add
// pane, and the trust notice stays above both panes.
//
// The listing is `GET /api/mcp?cwd=` (`app/api/mcp/route.ts:112-127`): it reads
// the global `mcp.json` and the project's `.pi/mcp.json` and spawns nothing
// (`lib/mcp-config-read.ts`), so it is safe on an untrusted folder. Each row
// shows what the file holds: name, scope, transport, `enabled`, the validator's
// refusal (`invalidError`), the project override (`overriddenByProject`), and
// the last known connection state (`status`, `lib/api-types.ts:424-425`).
//
// A switch posts `enable` / `disable` (`app/api/mcp/route.ts:616-626`) and
// replaces the list with the overview the answer carries (`overviewResponse`,
// `186-195`); open sessions apply it at their next message. A whole group uses
// `set-enabled`. Test is a separate click, never automatic: `POST /api/mcp/test`
// (`app/api/mcp/test/route.ts:26-36`) connects the entry once, outside any
// session, which starts a process or contacts a URL; the row shows a pending
// state, then the result.
//
// A server's exposure is `POST /api/mcp { action: "set-exposure" }`
// (`app/api/mcp/route.ts:634-641`), one of codemode / deferred / direct /
// hidden. A global server can be turned on or off for this project alone with
// `set-in-project` (`route.ts:642-649`), which writes an override in the
// project's `.pi/mcp.json`. Remove answers with an undo token for 60 seconds
// (`route.ts:350-366`). Sign out deletes the URL's tokens from `mcp-auth.json`;
// an OAuth server signs in through `/api/mcp/sign-in`, whose flow lives on the
// server and is polled here.
//
// The look is the split-page shell (`./parts`): `ConfigPage` / `ConfigSplit`
// for the two panes and the pinned footer, `ConfigSidebarItem` rows,
// `ConfigRowText` / `ConfigDetailTitle` / `ConfigSectionTitle` / `ConfigField`
// / `ConfigText` / `ConfigEmpty` / `ConfigFooter` for the content, the kit's
// `Badge`, `Button`, `Input` and `Status`, and `SettingsSwitch` for the switch.
// No Tailwind of our own.

import type { JSX } from "nsh";
import { openUrl, resource, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import {
  Badge,
  Button,
  colors,
  inputLook,
  mono,
  Status,
  type Tone,
} from "../../ui/kit";
import {
  actOnMcpServer,
  loadMcpOverview,
  MCP_EXPOSURES,
  setMcpServerEnabled,
  setMcpServerExposure,
  setMcpServersEnabled,
  testMcpServer,
  undoMcpRemoval,
  type McpExposure,
  type McpResponse,
  type McpScope,
  type McpServerInfo,
  type McpServerStatus,
  type McpTestResult,
  type McpTestTool,
  type McpUndoToken,
} from "../../api/config";
import { postJson, req } from "../../api/client";
import { trustProject } from "../../api/trust";
import { errorText } from "../../ui/errors";
import { shortenPath } from "../../lib/display-path";
import { activeCwd, settingsOpen } from "../../state/session";
import { t } from "../../ui/i18n";
import {
  ConfigDetailTitle,
  ConfigEmpty,
  ConfigField,
  ConfigFooter,
  ConfigListAction,
  ConfigPage,
  ConfigRowText,
  ConfigSectionTitle,
  ConfigSidebarItem,
  ConfigSidebarLabel,
  ConfigSplit,
  ConfigText,
  SettingsLoading,
  SettingsSelect,
  SettingsSwitch,
  settingsCode,
} from "./parts";

/** The entry fields the local route also reads, beyond what the list row needs. */
type McpServerDetail = McpServerInfo & {
  description?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  envNames?: string[];
  url?: string;
  headerNames?: string[];
  usesOAuth?: boolean;
  authProvider?: string;
  signedIn?: boolean;
  oauthStateStored?: boolean;
  override?: { keys: string[] };
  shadowedByProject?: boolean;
  replacesGlobal?: boolean;
  masked?: boolean;
  webPasswordField?: { kind: string; name?: string };
};

/** The trust status the overview carries for the listing's project. */
interface McpTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
  decision: boolean | null;
  decisionPath?: string;
  inherited: boolean;
  decisionError?: string;
}

/** `GET /api/mcp` also sends the project and any inactive host, which the type omits. */
type McpOverview = McpResponse & {
  project?: { cwd: string; trust?: McpTrustStatus; trustError?: string };
  hostInactive?: { owner: string; cwd: string; updatedAt: number };
};

/** `POST /api/mcp`'s answer adds what the action wrote, beyond the new overview. */
type McpActionAnswer = McpOverview & {
  added?: { scope: McpScope; name: string; path: string };
  undo?: McpUndoToken;
  restored?: { scope: McpScope; name: string };
  signedOut?: { removed: boolean };
};

/** The sign-in flow the local route keeps; only the fields the pane reads. */
interface McpSignInFlow {
  flowId?: string;
  id?: string;
  scope?: McpScope;
  name?: string;
  phase: string;
  authorizationUrl?: string;
  url?: string;
  message?: string;
  error?: string;
  failure?: string;
  expiresInMs?: number;
  alreadySignedIn?: true;
  refreshed?: true;
  result?: McpTestResult;
}

interface McpSignInRun {
  starting?: boolean;
  flow?: McpSignInFlow;
  error?: string;
  cancelling?: boolean;
  cancelError?: string;
  signedOut?: { removed: boolean };
}

/** One row's key: a name is unique within its scope only (`lib/api-types.ts:694-697`). */
function serverKey(server: { scope: McpScope; name: string }): string {
  return `${server.scope}:${server.name}`;
}

/** The status's one-line reading; `undefined` while nothing recorded one. */
const SESSION_STATE_KEYS: Record<string, string> = {
  connected: "mcp.state.session.connected",
  failed: "mcp.state.session.failed",
  "needs-auth": "mcp.state.needs-auth",
  connecting: "mcp.state.connecting",
  disconnected: "mcp.state.disconnected",
  conflict: "mcp.state.conflict",
};

function statusText(status: McpServerStatus | undefined): string {
  if (!status) return t("mcp.notTested");
  if (status.origin === "test") {
    if (status.state === "connected") {
      return t("mcp.connectedCount", { count: status.toolCount });
    }
    return t(status.state === "needs-auth" ? "mcp.state.needs-auth" : "mcp.test.state.failed");
  }
  const key = SESSION_STATE_KEYS[status.state];
  return t("mcp.sessionState", { state: key ? t(key) : status.state });
}

/** The short reading the middle list's second line carries. */
function rowStatusText(status: McpServerStatus | undefined): string {
  if (!status) return t("mcp.notTested");
  if (status.origin === "test") {
    if (status.state === "connected") return t("mcp.test.state.connected");
    return t(status.state === "needs-auth" ? "mcp.stateShort.needs-auth" : "mcp.stateShort.failed");
  }
  return t(`mcp.session.state.${status.state}`);
}

/** The manifest's `exposure` is a plain string in the file; only these four are writable. */
function asExposure(value: string | undefined): McpExposure | null {
  return value !== undefined && (MCP_EXPOSURES as readonly string[]).includes(value)
    ? value as McpExposure
    : null;
}

/** The exposure picker's rows; the value is the stored form. */
function exposureItems(): { value: string; title: string }[] {
  return MCP_EXPOSURES.map((exposure) => ({
    value: exposure,
    title: t(`mcp.exposureShort.${exposure}`),
  }));
}

function exposureTitle(exposure: McpExposure | null): string {
  return exposure === null ? t("mcp.exposureDefault") : t(`mcp.exposureShort.${exposure}`);
}

/** A tool's own exposure, when the server reported one. */
function toolExposureLabel(tool: McpTestTool): string {
  return tool.exposure === undefined ? "" : t(`mcp.exposureShort.${tool.exposure}`);
}

function statusTone(status: McpServerStatus | undefined): Tone {
  if (!status) return "neutral";
  if (status.state === "connected") return "up";
  if (status.state === "needs-auth" || status.state === "connecting") return "warn";
  if (status.state === "failed" || status.state === "conflict") return "danger";
  return "neutral";
}

/** A server's OAuth state, from the entry's file and the auth store. */
function signInText(server: McpServerDetail): string {
  if (server.authProvider !== undefined) return t("mcp.signIn.provider", { provider: server.authProvider });
  if (server.signedIn === true) return t("mcp.signIn.signedIn");
  if (server.oauthStateStored === true) return t("mcp.signIn.registrationOnly");
  return t("mcp.signIn.notSignedIn");
}

/** A test entry's summary line, empty while there is no result yet. */
function testSummary(entry: { result?: McpTestResult } | undefined): string {
  return entry?.result ? testText(entry.result) : "";
}

function testText(result: McpTestResult): string {
  const seconds = (result.durationMs / 1000).toFixed(1);
  if (result.state === "connected") {
    return `${t("mcp.connectedCount", { count: result.toolCount })} · ${seconds}s`;
  }
  if (result.state === "needs-auth") return t("mcp.needsSignInSeconds", { seconds });
  return t("mcp.failedSeconds", { seconds });
}

function scopeName(scope: McpScope): string {
  return scope === "project" ? t("common.project") : t("common.global");
}

function transportName(server: Pick<McpServerDetail, "transport" | "url" | "command">): string {
  if (server.transport === "http" || (server.transport === undefined && server.url !== undefined)) {
    return t("mcp.transport.http");
  }
  if (server.transport === "stdio" || server.command !== undefined) return t("mcp.transport.stdio");
  return "";
}

/** A command line as words: quoted runs stay one argument. */
function splitCommandLine(command: string): string[] {
  const parts: string[] = [];
  const matcher = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(command)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return parts;
}

const SIGN_IN_ENDED = new Set(["done", "failed", "cancelled", "expired"]);

function signInFlowId(flow: McpSignInFlow | undefined): string {
  return flow?.flowId ?? flow?.id ?? "";
}

function signInActive(run: McpSignInRun | undefined): boolean {
  return run?.flow !== undefined && !SIGN_IN_ENDED.has(run.flow.phase);
}

function signInEnded(flow: McpSignInFlow | undefined): boolean {
  return flow === undefined || SIGN_IN_ENDED.has(flow.phase);
}

/** A label/value pair in the detail; the label column is the reference's 108 points. */
function InfoRow(props: { label: string; children: JSX.Element }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
      <Text style={{ width: 108, flexShrink: 0, fontSize: 11.5, lineHeight: 17, color: colors.faint }}>
        {props.label}
      </Text>
      <View style={{ flex: 1, minWidth: 0 }}>{props.children}</View>
    </View>
  );
}

/** A detail value: quiet by default, code when it is a path, URL or command. */
function InfoValue(props: { text: string; mono?: boolean; tone?: "muted" | "danger" | "warn" }) {
  const color = () => (
    props.tone === "danger" ? colors.danger : props.tone === "warn" ? colors.warn : colors.muted
  );
  return (
    <Text
      style={{
        fontSize: 12,
        lineHeight: 17,
        color: color(),
        fontFamily: props.mono ? mono : undefined,
        numberOfLines: props.mono ? 3 : undefined,
      }}
    >
      {props.text}
    </Text>
  );
}

export function Mcp() {
  /** `""` loads with no `cwd` (the global file alone); only `null` skips the load. */
  const source = () => (settingsOpen() ? (activeCwd() ?? "") : null);
  const overview = resource(source, async (folder: string, info) =>
    await loadMcpOverview(folder === "" ? null : folder, { signal: info.signal }) as McpOverview);

  const saving = signal<string | null>(null);
  const error = signal<string | null>(null);
  /** Test results by row: the route records them too, but the row shows the click's own answer. */
  const tests = signal<Record<string, { pending: boolean; result?: McpTestResult; error?: string }>>({});
  /** A removal's undo token, while it lasts (`route.ts:350-366`, 60 s). */
  const undone = signal<{ name: string; path: string; token: string } | null>(null);
  /** The server open at the right, by scope/name; a missing key falls back to the first. */
  const selected = signal<string | null>(null);
  /** The add pane is shown instead of a selected server. */
  const adding = signal(false);
  /** OAuth flows started here, by server key. */
  const signIns = signal<Record<string, McpSignInRun>>({});
  const trusting = signal(false);
  const trustError = signal<string | null>(null);

  /** The add pane: one paste box, and the same entry as fields. */
  const addText = signal("");
  const addName = signal("");
  const addTransport = signal<"stdio" | "http">("stdio");
  const addCommand = signal("");
  const addUrl = signal("");
  const addScope = signal<McpScope>("global");
  const addBusy = signal(false);
  const addError = signal<string | null>(null);

  const allServers = (): McpServerDetail[] => (overview()?.servers ?? []) as McpServerDetail[];

  const directory = (): string | null => {
    const folder = source();
    return folder === null || folder === "" ? null : folder;
  };

  const hasProject = (): boolean => activeCwd() !== null && activeCwd() !== "";

  const serverGroups = (): { scope: McpScope; label: string; servers: McpServerDetail[] }[] => {
    const scopes: McpScope[] = hasProject() ? ["project", "global"] : ["global"];
    return scopes.map((scope) => ({
      scope,
      label: scopeName(scope),
      servers: allServers().filter((server) => server.scope === scope),
    }));
  };

  /** The list reads project first, then global, as the reference does. */
  const orderedServers = (): McpServerDetail[] => serverGroups().flatMap((group) => group.servers);

  /** The selected key, or the first server while nothing (or a removed one) is selected. */
  const activeKey = (): string | null => {
    if (adding()) return null;
    const current = selected();
    const servers = orderedServers();
    if (current !== null && servers.some((server) => serverKey(server) === current)) return current;
    return servers.length > 0 ? serverKey(servers[0]) : null;
  };

  const selectedServer = (): McpServerDetail | null =>
    orderedServers().find((server) => serverKey(server) === activeKey()) ?? null;

  const writable = (): boolean => overview()?.mcp.available === true;
  const busy = (server: McpServerInfo): boolean =>
    saving() === serverKey(server)
    || saving() === `remove:${serverKey(server)}`
    || saving() === `sign-out:${serverKey(server)}`
    || saving() === `exposure:${serverKey(server)}`
    || saving() === `in-project:${serverKey(server)}`;
  const pendingTest = (server: McpServerInfo): boolean => tests()[serverKey(server)]?.pending === true;

  /** Why MCP is read-only here, when the route says so (`McpAvailability`). */
  const unavailableText = (): string => {
    const state = overview()?.mcp;
    if (!state || state.available) return "";
    return t("mcp.offWithError", { error: state.error });
  };

  const projectTrust = (): McpTrustStatus | undefined => overview()?.project?.trust;

  /** The trust lines for the page banner; `canTrust` only for a folder the dialog may trust. */
  const trustNotice = (): { text: string; tone: "warn" | "danger"; canTrust: boolean } | null => {
    const project = overview()?.project;
    if (!project) return null;
    if (project.trustError !== undefined) {
      return { text: t("mcp.trust.unreadable"), tone: "danger", canTrust: false };
    }
    const trust = project.trust;
    if (!trust) return null;
    if (trust.decisionError !== undefined) {
      return { text: t("mcp.trust.unreadable"), tone: "danger", canTrust: false };
    }
    if (!trust.requiresTrust && trust.decision !== false) return null;
    if (trust.decision === true) {
      return trust.inherited && trust.decisionPath !== undefined
        ? { text: t("mcp.trust.trustedThrough", { path: shortenPath(trust.decisionPath) }), tone: "warn", canTrust: false }
        : null;
    }
    return {
      text: trust.inherited && trust.decisionPath !== undefined
        ? t("mcp.trust.untrustedThrough", { path: shortenPath(trust.decisionPath) })
        : t("mcp.trust.untrusted"),
      tone: "warn",
      canTrust: true,
    };
  };

  /** Why the add pane cannot save into this project, when it cannot. */
  const projectAddBlocked = (): string | null => {
    const folder = activeCwd();
    if (!folder) return t("mcp.add.projectBlocked.no-project");
    const trust = projectTrust();
    if (trust?.decisionError !== undefined) return t("mcp.add.projectBlocked.trust-unreadable");
    if (trust !== undefined && trust.requiresTrust && trust.decision !== true) {
      return t("mcp.add.projectBlocked.project-untrusted");
    }
    return null;
  };

  const toggle = async (server: McpServerInfo, on: boolean): Promise<void> => {
    const key = serverKey(server);
    saving.set(key);
    error.set(null);
    try {
      const next: McpResponse = await setMcpServerEnabled(server, on, directory());
      overview.mutate(next);
    } catch (cause) {
      error.set(errorText(cause));
      overview.refetch();
    } finally {
      saving.set(null);
    }
  };

  const toggleGroup = async (scope: McpScope, servers: McpServerDetail[], on: boolean): Promise<void> => {
    if (servers.length === 0) return;
    saving.set(`group:${scope}`);
    error.set(null);
    try {
      overview.mutate(await setMcpServersEnabled(servers, on, directory()));
    } catch (cause) {
      error.set(errorText(cause));
      overview.refetch();
    } finally {
      saving.set(null);
    }
  };

  const rowAction = async (server: McpServerInfo, action: "remove" | "sign-out"): Promise<void> => {
    const key = serverKey(server);
    saving.set(`${action}:${key}`);
    error.set(null);
    try {
      const answer = await actOnMcpServer(action, server, directory()) as McpActionAnswer;
      overview.mutate(answer);
      if (action === "remove") {
        const undo = answer.undo;
        undone.set(undo ? { name: server.name, path: server.sourcePath, token: undo.token } : null);
        if (undo) {
          setTimeout(() => {
            if (undone()?.token === undo.token) undone.set(null);
          }, undo.expiresInMs);
        }
      } else {
        const signedOut = answer.signedOut;
        signIns.update((runs) => ({
          ...runs,
          [key]: { ...runs[key], signedOut, error: undefined },
        }));
      }
    } catch (cause) {
      error.set(errorText(cause));
      overview.refetch();
    } finally {
      saving.set(null);
    }
  };

  const undoRemove = async (): Promise<void> => {
    const held = undone();
    if (!held) return;
    error.set(null);
    try {
      const answer = await undoMcpRemoval(held.token, directory()) as McpActionAnswer;
      overview.mutate(answer);
      if (answer.restored) selected.set(serverKey(answer.restored));
      undone.set(null);
    } catch (cause) {
      error.set(errorText(cause));
      undone.set(null);
      overview.refetch();
    }
  };

  const recordedTools = (server: McpServerInfo): McpTestTool[] => {
    const local = tests()[serverKey(server)]?.result;
    if (local !== undefined) return local.tools;
    return server.status?.origin === "test" ? server.status.tools : [];
  };

  const recordedToolCount = (server: McpServerInfo): number => {
    const local = tests()[serverKey(server)]?.result;
    if (local !== undefined) return local.toolCount;
    return server.status?.origin === "test" ? server.status.toolCount : 0;
  };

  const statusOffersResources = (server: McpServerInfo): boolean => {
    if (server.status?.origin !== "test") return false;
    return server.status.resources === true;
  };

  const changeExposure = async (server: McpServerInfo, value: string | null): Promise<void> => {
    if (!value || !(MCP_EXPOSURES as readonly string[]).includes(value)) return;
    const key = serverKey(server);
    saving.set(`exposure:${key}`);
    error.set(null);
    try {
      overview.mutate(await setMcpServerExposure(server, value as McpExposure, directory()));
    } catch (cause) {
      error.set(errorText(cause));
      overview.refetch();
    } finally {
      saving.set(null);
    }
  };

  const changeInProject = async (server: McpServerDetail, enabled: boolean): Promise<void> => {
    const key = serverKey(server);
    saving.set(`in-project:${key}`);
    error.set(null);
    try {
      const answer = await postJson<McpActionAnswer>("/api/mcp", {
        action: "set-in-project",
        name: server.name,
        enabled,
        cwd: directory() ?? undefined,
      });
      overview.mutate(answer);
    } catch (cause) {
      error.set(errorText(cause));
      overview.refetch();
    } finally {
      saving.set(null);
    }
  };

  const runTest = async (server: McpServerInfo): Promise<void> => {
    const key = serverKey(server);
    tests.update((current) => ({ ...current, [key]: { pending: true } }));
    try {
      const answer = await testMcpServer(server, directory());
      tests.update((current) => ({ ...current, [key]: { pending: false, result: answer.result } }));
      // The listing carries the recorded status; read it again to show it.
      overview.refetch();
    } catch (cause) {
      tests.update((current) => ({
        ...current,
        [key]: { pending: false, error: errorText(cause) },
      }));
    }
  };

  const updateSignIn = (key: string, patch: Partial<McpSignInRun>): void => {
    signIns.update((runs) => ({ ...runs, [key]: { ...runs[key], ...patch } }));
  };

  const pollSignIn = async (key: string, flowId: string): Promise<void> => {
    const run = signIns()[key];
    if (signInFlowId(run?.flow) !== flowId) return;
    try {
      const flow = await req<McpSignInFlow>(`/api/mcp/sign-in/${encodeURIComponent(flowId)}`);
      const current = signIns()[key];
      if (signInFlowId(current?.flow) !== flowId) return;
      updateSignIn(key, { flow, error: undefined });
      if (signInEnded(flow)) {
        overview.refetch();
        return;
      }
      setTimeout(() => void pollSignIn(key, flowId), 1_000);
    } catch (cause) {
      const current = signIns()[key];
      if (signInFlowId(current?.flow) !== flowId) return;
      updateSignIn(key, { error: errorText(cause) });
    }
  };

  const startSignIn = async (server: McpServerDetail): Promise<void> => {
    const key = serverKey(server);
    const run = signIns()[key];
    if (run?.starting === true || signInActive(run)) return;
    updateSignIn(key, { starting: true, flow: undefined, error: undefined });
    try {
      const flow = await postJson<McpSignInFlow>("/api/mcp/sign-in", {
        scope: server.scope,
        name: server.name,
        cwd: directory() ?? undefined,
      });
      const id = signInFlowId(flow);
      updateSignIn(key, { starting: false, flow });
      if (id !== "" && !signInEnded(flow)) setTimeout(() => void pollSignIn(key, id), 1_000);
      else overview.refetch();
    } catch (cause) {
      updateSignIn(key, { starting: false, error: errorText(cause) });
    }
  };

  const cancelSignIn = async (key: string): Promise<void> => {
    const flowId = signInFlowId(signIns()[key]?.flow);
    if (flowId === "") return;
    updateSignIn(key, { cancelling: true, cancelError: undefined });
    try {
      const flow = await req<McpSignInFlow>(`/api/mcp/sign-in/${encodeURIComponent(flowId)}`, { method: "DELETE" });
      updateSignIn(key, { cancelling: false, flow });
      if (signInEnded(flow)) overview.refetch();
    } catch (cause) {
      updateSignIn(key, { cancelling: false, cancelError: errorText(cause) });
    }
  };

  const trust = async (): Promise<void> => {
    const folder = activeCwd();
    if (!folder || trusting()) return;
    trusting.set(true);
    trustError.set(null);
    try {
      await trustProject(folder);
      overview.refetch();
    } catch (cause) {
      trustError.set(errorText(cause));
    } finally {
      trusting.set(false);
    }
  };

  const openAdd = (): void => {
    adding.set(true);
    error.set(null);
  };

  const openServer = (key: string): void => {
    selected.set(key);
    adding.set(false);
    error.set(null);
  };

  /** The add pane's request: the paste when there is one, else the manual fields. */
  const addRequest = (): { text: string; scope: McpScope } | null => {
    const scope = addScope();
    const paste = addText().trim();
    if (paste !== "") return { text: paste, scope };
    const name = addName().trim();
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      addError.set(t("mcp.add.nameInvalid"));
      return null;
    }
    if (addTransport() === "http") {
      const url = addUrl().trim();
      if (url === "") {
        addError.set(t("mcp.add.blocked.fields", { fields: t("mcp.detail.url") }));
        return null;
      }
      return { text: JSON.stringify({ mcpServers: { [name]: { url } } }), scope };
    }
    const words = splitCommandLine(addCommand());
    if (words.length === 0) {
      addError.set(t("mcp.add.blocked.fields", { fields: t("mcp.detail.command") }));
      return null;
    }
    const entry = {
      command: words[0],
      ...(words.length > 1 ? { args: words.slice(1) } : {}),
    };
    return { text: JSON.stringify({ mcpServers: { [name]: entry } }), scope };
  };

  const submitAdd = async (): Promise<void> => {
    if (addBusy()) return;
    if (addScope() === "project" && activeCwd() === null) {
      addError.set(t("mcp.add.projectBlocked.no-project"));
      return;
    }
    const request = addRequest();
    if (!request) return;
    addBusy.set(true);
    addError.set(null);
    error.set(null);
    try {
      const answer = await postJson<McpActionAnswer>("/api/mcp", {
        action: "add",
        text: request.text,
        scope: request.scope,
        cwd: directory() ?? undefined,
      });
      overview.mutate(answer);
      if (answer.added) {
        const key = serverKey(answer.added);
        selected.set(key);
        adding.set(false);
        addText.set("");
        addName.set("");
        addCommand.set("");
        addUrl.set("");
        const listed = (answer.servers as McpServerDetail[]).find((server) => serverKey(server) === key);
        if (listed) void runTest(listed);
      }
    } catch (cause) {
      addError.set(errorText(cause));
    } finally {
      addBusy.set(false);
    }
  };

  const addTargetPath = (): string => {
    const file = overview()?.files.find((entry) => entry.scope === addScope());
    if (file) return shortenPath(file.path);
    if (addScope() === "project" && activeCwd()) return `${shortenPath(activeCwd() ?? "")}/.pi/mcp.json`;
    return "mcp.json";
  };

  const scopeItems = () => [
    { value: "global", title: t("common.global") },
    {
      value: "project",
      title: t("common.project"),
      disabled: projectAddBlocked() !== null,
    },
  ];

  const transportItems = () => [
    { value: "stdio", title: t("mcp.transport.stdio") },
    { value: "http", title: t("mcp.transport.http") },
  ];

  const pasteField = inputLook({ multiline: true, style: { minHeight: 120, fontFamily: mono } });
  const addField = inputLook({ style: { flex: 1, minWidth: 0 } });

  const counts = (): { enabled: number; total: number } => {
    const servers = allServers();
    return { enabled: servers.filter((server) => server.enabled).length, total: servers.length };
  };

  const footerStatus = (): string => {
    const { enabled, total } = counts();
    if (overview.loading()) return t("mcp.loadingServers");
    if (overview.error()) return t("mcp.loadFailed");
    if (overview()?.mcp.available === false) return unavailableText();
    if (total === 0) return t("mcp.settingsSubtitle");
    return t("mcp.serverCount", { enabled, total });
  };

  const trustLine = trustNotice;

  return (
    <ConfigPage
      title={t("settings.mcp")}
      subtitle={hasProject() ? `${t("mcp.servers")} · ${shortenPath(activeCwd() ?? "")}` : t("mcp.servers")}
    >
      <If when={trustLine() !== null}>
        <View
          style={{
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: colors.line,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <ConfigText text={trustLine()?.text ?? ""} tone={trustLine()?.tone} />
            <If when={trustError()}>
              <ConfigText text={errorText(trustError())} tone="danger" />
            </If>
          </View>
          <If when={trustLine()?.canTrust === true}>
            <Button
              label={trusting() ? t("trust.trusting") : t("mcp.trust.trustButton")}
              variant="secondary"
              size="small"
              busy={trusting()}
              disabled={trusting()}
              onPress={() => void trust()}
            />
          </If>
        </View>
      </If>

      <ConfigSplit
        testID="settings-mcp-split"
        list={
          <View style={{ gap: 2 }}>
            <ConfigSidebarLabel text={t("mcp.servers")} aside={counts().total > 0 ? `${counts().enabled}/${counts().total}` : undefined} />

            <If when={overview.loading()}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <SettingsLoading label={t("mcp.loadingServers")} />
              </View>
            </If>
            <If when={overview.error()}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <ConfigText text={`${t("mcp.loadFailed")} ${errorText(overview.error())}`} tone="danger" />
              </View>
            </If>
            <If when={overview()?.mcp.available === false}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <ConfigText text={unavailableText()} tone="warn" />
              </View>
            </If>
            <If when={overview() !== undefined && allServers().length === 0}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                <ConfigText text={t(activeCwd() ? "mcp.emptyHereProject" : "mcp.emptyHere")} />
              </View>
            </If>

            <Each of={serverGroups()} key={(group) => group.scope}>
              {(group) => {
                const allOn = (): boolean => group().servers.length > 0 && group().servers.every((server) => server.enabled);
                const busyGroup = (): boolean => saving() === `group:${group().scope}`;
                return (
                  <View style={{ gap: 2 }}>
                    <ConfigSidebarLabel
                      text={group().label}
                      aside={group().servers.length > 0 ? `${group().servers.filter((server) => server.enabled).length}/${group().servers.length}` : undefined}
                    />
                    <If when={group().servers.length > 0}>
                      <View style={{ flexDirection: "row", paddingHorizontal: 8, paddingBottom: 2 }}>
                        <Button
                          label={allOn() ? t("common.disableAll") : t("common.enableAll")}
                          variant="secondary"
                          size="small"
                          busy={busyGroup()}
                          disabled={!writable() || saving() !== null}
                          onPress={() => void toggleGroup(group().scope, group().servers, !allOn())}
                        />
                      </View>
                    </If>
                    <If when={group().servers.length === 0}>
                      <View style={{ paddingHorizontal: 8, paddingBottom: 4 }}>
                        <ConfigText text={t("mcp.group.empty")} />
                      </View>
                    </If>
                    <Each of={group().servers} key={(server) => serverKey(server)}>
                      {(server) => {
                        const key = (): string => serverKey(server());
                        const active = (): boolean => activeKey() === key();
                        const detail = (): string => [
                          transportName(server()),
                          rowStatusText(server().status),
                          server().override !== undefined ? t("mcp.inProject.saved") : "",
                        ].filter(Boolean).join(" · ");
                        return (
                          <ConfigSidebarItem
                            active={active()}
                            onPress={() => openServer(key())}
                            testID={`mcp-server:${key()}`}
                            accessibilityLabel={t("mcp.rowLabel", { name: server().name, state: rowStatusText(server().status) })}
                          >
                            <Status
                              label={t(server().enabled ? "common.on" : "common.off")}
                              tone={server().enabled ? "up" : "neutral"}
                            />
                            <ConfigRowText
                              title={server().name}
                              detail={detail()}
                              muted={!server().enabled}
                              active={active()}
                            />
                            <If when={server().invalidError !== undefined || server().notAnObject === true}>
                              <Badge label={t("mcp.stateShort.invalid")} tone="warn" />
                            </If>
                            <If when={server().overriddenByProject === true}>
                              <Badge label={t("mcp.stateShort.overridden")} tone="warn" />
                            </If>
                          </ConfigSidebarItem>
                        );
                      }}
                    </Each>
                  </View>
                );
              }}
            </Each>
          </View>
        }
        listFooter={
          <ConfigListAction
            label={t("mcp.add.action")}
            onPress={openAdd}
            testID="settings-mcp-add"
            disabled={overview.loading() || overview()?.mcp.available === false}
          />
        }
        detail={
          <View style={{ gap: 16 }}>
            <If when={adding()}>
              <View style={{ gap: 14 }}>
                <ConfigDetailTitle title={t("mcp.add.title")} subtitle={t("mcp.add.afterAdd")} />

                <ConfigField label={t("config.saveTo")}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <SettingsSelect
                      items={scopeItems()}
                      value={addScope()}
                      onChange={(value) => addScope.set(value === "project" ? "project" : "global")}
                      label={t("config.saveTo")}
                      title={addScope() === "project" ? t("common.project") : t("common.global")}
                      minWidth={180}
                    />
                    <ConfigText text={scopeName(addScope())} />
                  </View>
                </ConfigField>
                <ConfigField label={t("mcp.detail.file")}>
                  <InfoValue text={addTargetPath()} mono />
                </ConfigField>
                <If when={addScope() === "project" && projectAddBlocked() !== null}>
                  <ConfigText text={projectAddBlocked() ?? ""} tone="warn" />
                </If>

                <ConfigField label={t("mcp.add.inputLabel")}>
                  <Input
                    multiline={true}
                    class={pasteField.class}
                    style={pasteField.style}
                    value={addText()}
                    onChange={({ value }) => addText.set(value)}
                    placeholder={t("mcp.add.placeholder")}
                    accessibilityLabel={t("mcp.add.inputLabel")}
                  />
                </ConfigField>
                <ConfigText text={t("mcp.add.previewUnfilled")} />

                <ConfigSectionTitle text={t("mcp.add.serverLabel")} />
                <ConfigField label={t("config.name")}>
                  <Input
                    class={addField.class}
                    style={addField.style}
                    value={addName()}
                    onChange={({ value }) => addName.set(value)}
                    placeholder="my-server"
                    accessibilityLabel={t("config.name")}
                    autoComplete="off"
                  />
                </ConfigField>
                <ConfigField label={t("mcp.detail.transport")}>
                  <SettingsSelect
                    items={transportItems()}
                    value={addTransport()}
                    onChange={(value) => addTransport.set(value === "http" ? "http" : "stdio")}
                    label={t("mcp.detail.transport")}
                    title={addTransport() === "http" ? t("mcp.transport.http") : t("mcp.transport.stdio")}
                    minWidth={180}
                  />
                </ConfigField>
                <If when={addTransport() === "http"}>
                  <ConfigField label={t("mcp.detail.url")}>
                    <Input
                      class={addField.class}
                      style={addField.style}
                      value={addUrl()}
                      onChange={({ value }) => addUrl.set(value)}
                      placeholder="https://mcp.example.com/mcp"
                      accessibilityLabel={t("mcp.detail.url")}
                      autoComplete="off"
                    />
                  </ConfigField>
                </If>
                <If when={addTransport() === "stdio"}>
                  <ConfigField label={t("mcp.detail.command")}>
                    <Input
                      class={addField.class}
                      style={addField.style}
                      value={addCommand()}
                      onChange={({ value }) => addCommand.set(value)}
                      placeholder="npx -y @scope/server"
                      accessibilityLabel={t("mcp.detail.command")}
                      autoComplete="off"
                    />
                  </ConfigField>
                </If>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Button
                    label={addBusy() ? t("mcp.add.adding") : t("mcp.add.button")}
                    variant="primary"
                    size="small"
                    busy={addBusy()}
                    disabled={addBusy() || (addScope() === "project" && projectAddBlocked() !== null)}
                    onPress={() => void submitAdd()}
                  />
                  <Button
                    label={t("i18n.cancel")}
                    variant="secondary"
                    size="small"
                    disabled={addBusy()}
                    onPress={() => adding.set(false)}
                  />
                </View>
                <If when={addError()}>
                  <ConfigText text={`${t("mcp.add.failed")} ${errorText(addError())}`} tone="danger" />
                </If>
                <ConfigText text={t("mcp.testFooter")} />
              </View>
            </If>

            <If when={!adding() ? selectedServer() : null}>
              {(server) => {
                const detail = (): McpServerDetail => server();
                const key = (): string => serverKey(detail());
                const run = (): McpSignInRun | undefined => signIns()[key()];
                const signingIn = (): boolean => run()?.starting === true || signInActive(run());
                const isBusy = (): boolean => busy(detail());
                const disabled = (): boolean => !writable() || isBusy();
                const invalid = (): boolean => detail().invalidError !== undefined || detail().notAnObject === true;
                const exposure = (): McpExposure | null => asExposure(detail().exposure);
                const target = (): string => detail().transport === "http" || detail().url !== undefined
                  ? detail().url ?? ""
                  : [detail().command, ...(detail().args ?? [])].filter(Boolean).join(" ");
                const overrideEntry = (): McpServerDetail | undefined => detail().scope === "global"
                  ? allServers().find((entry) => entry.scope === "project" && entry.name === detail().name && entry.override !== undefined)
                  : undefined;
                const shadowEntry = (): McpServerDetail | undefined => detail().scope === "global"
                  ? allServers().find((entry) => entry.scope === "project" && entry.name === detail().name && entry.override === undefined)
                  : undefined;
                const tools = (): McpTestTool[] => recordedTools(detail());
                return (
                  <View style={{ gap: 16 }}>
                    <If when={undone() !== null}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <ConfigText text={t("mcp.removed", { name: undone()?.name ?? "", path: shortenPath(undone()?.path ?? "") })} />
                        </View>
                        <Button
                          label={t("mcp.undo")}
                          variant="secondary"
                          size="small"
                          onPress={() => void undoRemove()}
                        />
                      </View>
                    </If>

                    <View style={{ gap: 8 }}>
                      <ConfigDetailTitle
                        title={detail().name}
                        subtitle={detail().description !== undefined && detail().description !== ""
                          ? detail().description
                          : statusText(detail().status)}
                      />
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <Badge label={scopeName(detail().scope)} />
                        <If when={transportName(detail()) !== ""}>
                          <Badge label={transportName(detail())} />
                        </If>
                        <If when={detail().overriddenByProject === true}>
                          <Badge label={t("mcp.overriddenByProjectBadge")} tone="warn" />
                        </If>
                        <If when={detail().override !== undefined}>
                          <Badge label={t("mcp.stateShort.overridden")} tone="warn" />
                        </If>
                        <Status label={statusText(detail().status)} tone={statusTone(detail().status)} />
                      </View>
                    </View>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Button
                        label={pendingTest(detail()) ? t("mcp.test.testing") : t("mcp.test.button")}
                        variant="secondary"
                        size="small"
                        busy={pendingTest(detail())}
                        disabled={!writable() || isBusy() || invalid()}
                        onPress={() => void runTest(detail())}
                      />
                      <If when={detail().usesOAuth === true}>
                        <If when={signingIn()}>
                          <Button
                            label={run()?.cancelling === true ? t("mcp.signIn.cancelling") : t("mcp.signIn.cancel")}
                            variant="secondary"
                            size="small"
                            busy={run()?.cancelling === true}
                            disabled={run()?.cancelling === true}
                            onPress={() => void cancelSignIn(key())}
                          />
                        </If>
                        <If when={!signingIn()}>
                          <Button
                            label={run()?.starting === true ? t("mcp.signIn.starting") : t("mcp.signIn.button")}
                            variant="secondary"
                            size="small"
                            busy={run()?.starting === true}
                            disabled={disabled() || invalid()}
                            onPress={() => void startSignIn(detail())}
                          />
                        </If>
                      </If>
                      <Button
                        label={saving() === `sign-out:${key()}` ? t("mcp.signIn.signingOut") : t("mcp.signIn.signOut")}
                        variant="secondary"
                        size="small"
                        disabled={disabled()}
                        onPress={() => void rowAction(detail(), "sign-out")}
                      />
                      <Button
                        label={saving() === `remove:${key()}` ? t("i18n.removing") : t("i18n.remove")}
                        variant="danger"
                        size="small"
                        disabled={disabled()}
                        onPress={() => void rowAction(detail(), "remove")}
                      />
                      <SettingsSwitch
                        value={detail().enabled}
                        disabled={disabled() || detail().notAnObject === true}
                        label={t(detail().enabled ? "mcp.server.switchOff" : "mcp.server.switchOn", { name: detail().name })}
                        onChange={(on) => void toggle(detail(), on)}
                      />
                    </View>

                    <If when={error()}>
                      <ConfigText text={errorText(error())} tone="danger" />
                    </If>
                    <If when={detail().invalidError !== undefined}>
                      <ConfigText text={detail().invalidError ?? ""} tone="danger" />
                    </If>
                    <If when={detail().notAnObject === true}>
                      <ConfigText text={t("mcp.entryNotObject")} tone="danger" />
                    </If>
                    <If when={statusOffersResources(detail())}>
                      <ConfigText text={t("mcp.test.resources")} />
                    </If>

                    <View style={{ gap: 8 }}>
                      <InfoRow label={t("i18n.status")}>
                        <View style={{ gap: 2 }}>
                          <Status label={statusText(detail().status)} tone={statusTone(detail().status)} />
                          <If when={detail().status?.origin === "test" && detail().status?.error !== undefined}>
                            <ConfigText text={detail().status?.error ?? ""} tone="danger" />
                          </If>
                          <If when={tests()[key()]?.result !== undefined}>
                            <ConfigText text={testSummary(tests()[key()])} />
                          </If>
                          <If when={tests()[key()]?.result?.error !== undefined}>
                            <ConfigText text={tests()[key()]?.result?.error ?? ""} tone="danger" />
                          </If>
                          <If when={tests()[key()]?.result?.timedOut === true}>
                            <ConfigText text={t("mcp.testTimedOut")} tone="warn" />
                          </If>
                          <If when={tests()[key()]?.error !== undefined}>
                            <ConfigText text={tests()[key()]?.error ?? ""} tone="danger" />
                          </If>
                        </View>
                      </InfoRow>

                      <If when={target() !== ""}>
                        <InfoRow label={detail().transport === "http" || detail().url !== undefined ? t("mcp.detail.url") : t("mcp.detail.command")}>
                          <InfoValue text={target()} mono />
                        </InfoRow>
                      </If>
                      <If when={detail().cwd !== undefined}>
                        <InfoRow label={t("mcp.detail.cwd")}>
                          <InfoValue text={detail().cwd ?? ""} mono />
                        </InfoRow>
                      </If>
                      <If when={(detail().envNames?.length ?? 0) > 0}>
                        <InfoRow label={t("mcp.detail.env")}>
                          <InfoValue text={(detail().envNames ?? []).join(", ")} mono />
                        </InfoRow>
                      </If>
                      <If when={(detail().headerNames?.length ?? 0) > 0}>
                        <InfoRow label={t("mcp.detail.headers")}>
                          <InfoValue text={(detail().headerNames ?? []).join(", ")} mono />
                        </InfoRow>
                      </If>
                      <If when={detail().masked === true}>
                        <ConfigText text={t("mcp.server.masked")} />
                      </If>
                      <InfoRow label={t("mcp.detail.file")}>
                        <InfoValue text={shortenPath(detail().sourcePath)} mono />
                      </InfoRow>
                    </View>

                    <View style={{ gap: 8 }}>
                      <ConfigSectionTitle text={t("mcp.detail.exposure")} />
                      <SettingsSelect
                        items={exposureItems()}
                        value={exposure()}
                        onChange={(value) => void changeExposure(detail(), value)}
                        label={t("mcp.exposure.label", { name: detail().name })}
                        title={exposureTitle(exposure())}
                        disabled={disabled() || detail().notAnObject === true}
                        minWidth={180}
                      />
                      <ConfigText text={t(`mcp.exposure.${exposure() ?? "codemode"}`)} />
                      <If when={saving() === `exposure:${key()}`}>
                        <ConfigText text={t("i18n.saving")} />
                      </If>
                      <If when={(detail().toolExposureCount ?? 0) > 0}>
                        <ConfigText text={t("mcp.exposure.toolOverrides", { count: detail().toolExposureCount ?? 0 })} />
                      </If>
                    </View>

                    <If when={detail().scope === "global" && hasProject()}>
                      <View style={{ gap: 8 }}>
                        <ConfigSectionTitle text={t("mcp.detail.inProject")} />
                        <If when={overrideEntry() !== undefined}>
                          <ConfigText text={t("mcp.inProject.overridden", { keys: (overrideEntry()?.override?.keys ?? []).join(", ") })} />
                          <Button
                            label={t("mcp.inProject.show")}
                            variant="secondary"
                            size="small"
                            onPress={() => openServer(serverKey(overrideEntry()!))}
                          />
                        </If>
                        <If when={overrideEntry() === undefined && shadowEntry() !== undefined}>
                          <ConfigText text={t("mcp.server.shadowedByProject")} />
                          <Button
                            label={t("mcp.inProject.show")}
                            variant="secondary"
                            size="small"
                            onPress={() => openServer(serverKey(shadowEntry()!))}
                          />
                        </If>
                        <If when={overrideEntry() === undefined && shadowEntry() === undefined}>
                          <Button
                            label={saving() === `in-project:${key()}`
                              ? t("i18n.saving")
                              : t(detail().enabled ? "mcp.inProject.turnOff" : "mcp.inProject.turnOn")}
                            variant="secondary"
                            size="small"
                            disabled={disabled()}
                            onPress={() => void changeInProject(detail(), !detail().enabled)}
                          />
                          <ConfigText text={t("mcp.inProject.saved")} />
                        </If>
                      </View>
                    </If>

                    <If when={detail().usesOAuth === true || detail().authProvider !== undefined}>
                      <View style={{ gap: 8 }}>
                        <ConfigSectionTitle text={t("mcp.detail.signIn")} />
                        <ConfigText text={signInText(detail())} />
                        <If when={run()?.error !== undefined}>
                          <ConfigText text={`${t("mcp.signIn.requestFailed")} ${errorText(run()?.error)}`} tone="danger" />
                        </If>
                        <If when={run()?.cancelError !== undefined}>
                          <ConfigText text={`${t("mcp.signIn.cancelFailed")} ${errorText(run()?.cancelError)}`} tone="danger" />
                        </If>
                        <If when={run()?.signedOut !== undefined}>
                          <ConfigText text={t(run()?.signedOut?.removed === true ? "mcp.signIn.signedOutDone" : "mcp.signIn.signedOutNothing")} />
                        </If>
                        <If when={run()?.flow !== undefined}>
                          <View style={{ gap: 4 }}>
                            <If when={(run()?.flow?.message ?? "") !== ""}>
                              <ConfigText text={run()?.flow?.message ?? ""} />
                            </If>
                            <If when={(run()?.flow?.authorizationUrl ?? run()?.flow?.url ?? "") !== ""}>
                              <View style={{ gap: 6 }}>
                                <Text style={{ ...settingsCode(), lineHeight: 17 }}>
                                  {run()?.flow?.authorizationUrl ?? run()?.flow?.url ?? ""}
                                </Text>
                                <View style={{ flexDirection: "row" }}>
                                  <Button
                                    label={t("settings.providers.openSignInPage")}
                                    variant="secondary"
                                    size="small"
                                    onPress={() => void openUrl(run()?.flow?.authorizationUrl ?? run()?.flow?.url ?? "")}
                                  />
                                </View>
                              </View>
                            </If>
                          </View>
                        </If>
                      </View>
                    </If>

                    <View style={{ gap: 8 }}>
                      <ConfigSectionTitle
                        text={t("mcp.toolsTitle")}
                        aside={t("mcp.toolsRecorded", { count: recordedToolCount(detail()) })}
                      />
                      <If when={tools().length === 0}>
                        <ConfigText text={tests()[key()]?.result?.error ?? t("mcp.toolsNone")} />
                      </If>
                      <Each of={tools()} key={(tool) => tool.name}>
                        {(tool) => (
                          <InfoRow label={tool().name}>
                            <View style={{ gap: 3 }}>
                              <Text style={{ fontSize: 12, lineHeight: 17, color: colors.text }}>
                                {tool().description !== undefined && tool().description !== ""
                                  ? tool().description
                                  : t("mcp.toolsNoDescription")}
                              </Text>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                                <If when={tool().readOnly}>
                                  <Badge label={t("mcp.test.readOnly")} tone="up" outline />
                                </If>
                                <If when={toolExposureLabel(tool()) !== ""}>
                                  <Badge label={toolExposureLabel(tool())} outline />
                                </If>
                              </View>
                            </View>
                          </InfoRow>
                        )}
                      </Each>
                      <If when={recordedToolCount(detail()) > tools().length}>
                        <ConfigText text={t("mcp.test.moreTools", { count: recordedToolCount(detail()) - tools().length })} />
                      </If>
                      <ConfigText text={t("mcp.testFooter")} />
                    </View>
                  </View>
                );
              }}
            </If>

            <If when={!adding() && selectedServer() === null}>
              <View style={{ gap: 12 }}>
                <If when={undone() !== null}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <ConfigText text={t("mcp.removed", { name: undone()?.name ?? "", path: shortenPath(undone()?.path ?? "") })} />
                    </View>
                    <Button
                      label={t("mcp.undo")}
                      variant="secondary"
                      size="small"
                      onPress={() => void undoRemove()}
                    />
                  </View>
                </If>
                <ConfigEmpty
                  text={overview.loading()
                    ? t("mcp.loadingServers")
                    : (allServers().length === 0
                      ? t(activeCwd() ? "mcp.emptyHereProject" : "mcp.emptyHere")
                      : t("mcp.selectItem"))}
                />
              </View>
            </If>
          </View>
        }
        footer={
          <ConfigFooter status={footerStatus()}>
            <Button
              label={t("i18n.refresh")}
              variant="secondary"
              size="small"
              busy={overview.loading() || saving() !== null}
              disabled={overview.loading()}
              onPress={() => overview.refetch()}
            />
          </ConfigFooter>
        }
      />
    </ConfigPage>
  );
}
