// The three routes that described the old server itself: LAN exposure, chat
// channels, and the Debug panel's snapshot.
//
// An attached window has no server to expose and no relay to run, so these
// answer a truthful "nothing here" instead of an error: the panes draw their
// empty state, and the Debug panel says the window is the only process.
import { errorResponse, jsonResponse, type LocalRequest, type LocalResponse } from "./request";

/** `LanAccessState`: no server, so nothing is exposed and no token exists. */
function lanAccess(): LocalResponse {
  return jsonResponse({
    enabled: false,
    created: false,
    boundLan: false,
    needsRebind: false,
    lanUrls: [],
    tokenHint: null,
    message: "这个构建没有内置服务：手机直连需要服务器，attached 模式下不需要。",
  });
}

/**
 * `DebugSnapshot`: this window is the only process. The shapes are the old
 * server's, filled with what is true here rather than with nothing at all.
 */
function debugSnapshot(request: LocalRequest): LocalResponse {
  // Exactly the fields the panel dereferences (`DebugPanel`'s own interface),
  // with the numbers an attached window really has: no server-side wrappers,
  // streams or relays — but a session may hold a live `pi` child.
  const sessionId = request.params.get("session") ?? null;
  return jsonResponse({
    now: Date.now(),
    server: {
      startedAt: Date.now(),
      idleTimeoutMs: 0,
      heartbeatMs: 30_000,
      wrappers: { alive: sessionId === null ? 0 : 1, closing: 0, starting: 0 },
      eventStreams: { total: 0 },
      sseTotal: 0,
      fileWatches: 0,
      terminals: { count: 0, listeners: 0, detached: 0, exited: 0 },
    },
    sessions: [],
    session: sessionId === null
      ? null
      : {
        sessionId,
        wrapper: null,
        starting: false,
        eventStreams: [],
        subagents: { active: false, runs: [] },
        mcp: null,
      },
    note: "attached 模式：窗口自己回答请求，没有服务器进程。",
  });
}

export async function handleServerOnly(request: LocalRequest): Promise<LocalResponse | null> {
  const [first, second] = request.segments;
  if (first !== "api") return null;

  if (second === "lan" && request.segments[2] === "access" && request.segments.length === 3) {
    return request.method === "GET" || request.method === "PUT" ? lanAccess() : null;
  }

  if (second === "bot-channel" && request.segments.length === 2) {
    // Saving or starting a channel is the relay's job; there is no relay here.
    if (request.method === "GET") return jsonResponse({ channels: [] });
    return errorResponse("这个构建没有内置服务：聊天通道需要服务器。", 503);
  }

  if (second === "agent" && request.segments[2] === "debug" && request.segments.length === 3) {
    return request.method === "GET" ? debugSnapshot(request) : null;
  }

  return null;
}
