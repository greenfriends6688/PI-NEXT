import { isDroppableEvent } from "./agent-event-wire";
// fork:event-seq
import type { AgentEventLog, ClientAgentEvent } from "./agent-event-log";
import { acquireSessionLivenessLease } from "./session-liveness";

export interface AgentEventStreamSession {
  readonly isStreaming: boolean;
  /** fork:upstream-compaction-status — #1008：自动压缩期间客户端必须知道正在压缩。 */
  readonly isCompacting: boolean;
  readonly streamingMessage: unknown;
  /** fork:event-seq — 会话级序号与重放窗口。 */
  readonly eventLog: AgentEventLog;
  /** fork:event-seq — 已投影、权威事件带 `seq` 的订阅。 */
  onClientEvent(listener: (event: ClientAgentEvent) => void): () => void;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * 一条 SSE 连接的背压。客户端经常是手机：它一旦停止读（息屏、后台标签页、
 * 网络抖动），我们继续入队的事件就全部留在这个进程里。
 *
 *  - 超过 STREAM_HIGH_WATER_MARK_BYTES 时，只丢**后面能修回来**的事件
 *    （流式 delta、工具的部分输出）；
 *  - 超过 backlog 上限时直接终止流，让客户端重连并重新取快照。
 *
 * 这条实测数据：一条 24 MB 的命令 + 一个停止读取的客户端，在服务端排了
 * 22.7 MB，而这笔内存只等一次本应用几乎不触发的 GC（issue #923）。
 *
 * 上限也必须容得下慢网路上一个**健康**客户端的在途量：一次图片 `read` 会把
 * 它的 base64 发三遍（`tool_execution_end`，然后工具结果的 `message_start` 与
 * `message_end`），而第一遍还在往 socket 写时后面几遍就排上了。所以默认 16 MB。
 */
const STREAM_HIGH_WATER_MARK_BYTES = 512 * 1024;
const DEFAULT_BACKLOG_LIMIT_BYTES = 16 * 1024 * 1024;
const BACKPRESSURE_LOG_INTERVAL_MS = 60_000;
let lastBackpressureLogAt = 0;

/**
 * 这个事件被丢掉时，后面还有没有事件能修好它 —— 见 `agent-event-wire.ts`
 * 的 `isDroppableEvent`（fork:event-seq 后与“给不给序号”共用同一判据）。
 */
function resolveBacklogLimitBytes(): number {
  const raw = Number(process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES);
  return Number.isFinite(raw) && raw >= 64 * 1024 ? raw : DEFAULT_BACKLOG_LIMIT_BYTES;
}

function logBackpressure(
  sessionId: string,
  queuedBytes: number,
  limitBytes: number,
  droppedEvents: number,
  closing: boolean,
): void {
  const now = Date.now();
  if (now - lastBackpressureLogAt < BACKPRESSURE_LOG_INTERVAL_MS) return;
  lastBackpressureLogAt = now;
  const queued = `${Math.round(queuedBytes / 1024)} KB`;
  console.warn(closing
    ? `[pi-web] Agent event stream for ${sessionId} closed: client backlog ${queued} exceeds ${Math.round(limitBytes / 1024)} KB; it reconnects and re-snapshots.`
    : `[pi-web] Agent event stream for ${sessionId} is behind (${queued} queued): dropping rebuildable deltas (${droppedEvents} so far).`);
}

/**
 * Registry of live SSE streams. Next.js 16 (prod mode) handles SIGINT/SIGTERM
 * by calling server.close() and waiting INDEFINITELY for every connection to
 * end — with no timeout and no closeAllConnections (those are dev-only, see
 * node_modules/next/dist/server/lib/start-server.js cleanup()). An SSE stream
 * never ends on its own (it waits for the CLIENT to disconnect), so on
 * shutdown the process lingers forever: listener closed (502 upstream) but
 * node alive as an orphan, Servy never sees the exit. CloseAll below lets our
 * signal hook terminate the streams so Next's own drain completes and the
 * process exits normally. See instrumentation.ts.
 */
// IMPORTANT: instrumentation.ts and the route handlers are bundled into
// SEPARATE module graphs — each gets its own copy of this module, so a plain
// module-level Set would be two disconnected registries (verified live: the
// shutdown hook closed an empty set while the route's SSE kept heart-beating).
// Symbol.for + globalThis gives every copy the SAME registry.
const CLOSER_REGISTRY: symbol = Symbol.for("pi-web.agentEventStreamClosers");
type StreamCloser = (closeController: boolean | "error") => void;
const activeStreamClosers: Set<StreamCloser> =
  ((globalThis as Record<symbol, Set<StreamCloser>>)[CLOSER_REGISTRY] ??= new Set<StreamCloser>());

/** Close every live SSE stream (called on process shutdown signals). */
export function closeAllAgentEventStreams(): void {
  for (const close of [...activeStreamClosers]) {
    try { close("error"); } catch { /* stream already closed */ }
  }
}

export function activeAgentEventStreamCount(): number {
  return activeStreamClosers.size;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Open the SSE transport immediately, then publish the session snapshot only
 * after the agent is ready and its event listener has been installed.
 */
export function createAgentEventStream(
  req: Request,
  sessionId: string,
  sessionPromise: Promise<AgentEventStreamSession>,
  lastEventId: number | null = null,
): ReadableStream<Uint8Array> {
  let cancelStream: (closeController: boolean | "error") => void = () => {};
  let releaseLease: () => void = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;

      // "error": hard-terminate the response (SSE client sees a broken
      // stream and reconnects). Used on process shutdown: a plain close() is
      // swallowed by the Next/Node response pipeline without emitting a
      // chunked termination, so the socket stays ESTABLISHED and Next's
      // server.close() drain never completes (the original zombie bug).
      // fork:upstream-sse-backlog — #997：客户端停止消费时也走这里；在那种情况下
      // 优雅的 close() 会把 socket（连同排着的 backlog）留在那里。
      // "true": graceful close after we finished writing a final event.
      const cleanup = (closeController: boolean | "error", reason?: Error) => {
        if (closed) return;
        closed = true;
        releaseLease();
        releaseLease = () => {};
        activeStreamClosers.delete(cleanup);
        if (heartbeat !== null) clearInterval(heartbeat);
        unsubscribe?.();
        unsubscribe = null;
        if (abortHandler) req.signal.removeEventListener("abort", abortHandler);
        if (closeController === "error") {
          try { controller.error(reason ?? new Error("pi-web server shutting down")); } catch { /* already closed */ }
        } else if (closeController) {
          try { controller.close(); } catch { /* stream already closed */ }
        }
      };
      cancelStream = cleanup;
      releaseLease = acquireSessionLivenessLease(sessionId).release;
      activeStreamClosers.add(cleanup);

      const backlogLimitBytes = resolveBacklogLimitBytes();
      let droppedEvents = 0;
      const enqueueText = (text: string, options?: { droppable?: boolean }) => {
        if (closed) return;
        const desiredSize = controller.desiredSize;
        if (desiredSize === null) {
          cleanup(false);
          return;
        }
        const queuedBytes = STREAM_HIGH_WATER_MARK_BYTES - desiredSize;
        if (options?.droppable && queuedBytes > STREAM_HIGH_WATER_MARK_BYTES) {
          droppedEvents += 1;
          logBackpressure(sessionId, queuedBytes, backlogLimitBytes, droppedEvents, false);
          return;
        }
        if (queuedBytes > backlogLimitBytes) {
          logBackpressure(sessionId, queuedBytes, backlogLimitBytes, droppedEvents, true);
          cleanup(
            "error",
            new Error(`pi-web agent event stream closed: client backlog exceeded ${Math.round(backlogLimitBytes / 1024)} KB`),
          );
          return;
        }
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup(false);
        }
      };
      const encode = (data: unknown, options?: { droppable?: boolean }) => {
        enqueueText(`data: ${JSON.stringify(data)}\n\n`, options);
      };
      // fork:event-seq — 权威事件带 `id:`（SSE 游标），可重建增量不带。
      const encodeSequenced = (entry: { seq: number; text: string }) => {
        enqueueText(`id: ${entry.seq}\ndata: ${entry.text}\n\n`);
      };

      const publishSession = async () => {
        try {
          const session = await sessionPromise;
          if (closed) return;

          const snapshot = session.streamingMessage;
          const buffered: ClientAgentEvent[] = [];
          let live = false;
          // 已经交付给这个客户端的最大序号。重连时初值是它上次的游标。
          let deliveredSeq = 0;
          let replayed = false;

          const deliver = (event: ClientAgentEvent) => {
            // 快照通路：这条就是马上要单独发的快照，不要重复渲染一次。
            if (
              !replayed
              && event.messageRef !== undefined
              && event.messageRef === snapshot
              && (event.event.type === "message_start" || event.event.type === "message_update")
            ) {
              if (event.seq !== null) deliveredSeq = event.seq;
              return;
            }
            if (event.seq === null) {
              // 可重建增量 / 重放的待决请求：按原样发，不参与序号与缺口判定。
              // 增量仍走背压丢弃（它们的 `*_end` 会带权威内容补回来）。
              encode(event.event, { droppable: isDroppableEvent(event.event) });
              return;
            }
            if (event.seq <= deliveredSeq) return;
            encodeSequenced(event);
            deliveredSeq = event.seq;
          };

          const handleEvent = (event: ClientAgentEvent) => {
            if (!live) {
              buffered.push(event);
              return;
            }
            deliver(event);
          };

          const stopListening = session.onClientEvent(handleEvent);
          if (closed) {
            stopListening();
            return;
          }
          unsubscribe = stopListening;

          // fork:upstream-compaction-status — #1008 移植（2e66e40）· 事件侧：
          // 自动压缩会把一个 turn 吊住好一阵子，而 `compaction_start` 只有一个 SSE
          // 客户端能收到。重连（息屏、后台标签页）之后 `connected` 只说「在跑」，
          // 客户端就不知道这一轮卡在压缩上，会一直报“等待模型”。压缩状态跟着快照
          // 一起发，重连一次就对上了。
          encode({
            type: "connected",
            sessionId,
            isStreaming: session.isStreaming,
            isCompacting: Boolean(session.isCompacting),
          });

          // fork:event-seq — 带游标回来就补发断线期间漏掉的**权威事件**。
          // 补不齐（缓冲已滚过）就不装：退回快照通路，让客户端自己重读转写。
          if (lastEventId !== null) {
            const replay = session.eventLog.replayAfter(lastEventId);
            if (replay.complete) {
              replayed = true;
              deliveredSeq = lastEventId;
              for (const entry of replay.events) {
                encodeSequenced(entry);
                deliveredSeq = entry.seq;
              }
            }
          }

          // 先冲掉订阅窗口内缓下的实时事件，再补快照 —— 与 fork:event-seq 之前一致
          // 的顺序（实时事件在前、快照在后，快照只用来把流式消息拉回当前）。
          // 重放通路不需要快照：补上的事件里已经有它的 message_start/update。
          for (const event of buffered) deliver(event);
          if (!replayed && snapshot !== undefined && snapshot !== null) {
            encode({ type: "message_start", message: snapshot });
          }

          live = true;
        } catch (error) {
          if (closed) return;
          encode({
            type: "startup_error",
            errorMessage: `Failed to start agent: ${errorMessage(error)}`,
          });
          cleanup(true);
        }
      };

      // Attach the rejection handler before checking the request signal. The
      // route may already have started a shared cold-start promise.
      void publishSession();

      abortHandler = () => cleanup(true);
      if (req.signal.aborted) {
        cleanup(true);
        return;
      }
      req.signal.addEventListener("abort", abortHandler, { once: true });

      heartbeat = setInterval(() => enqueueText(":\n\n"), HEARTBEAT_INTERVAL_MS);

      // Force the response headers through without claiming that the agent is
      // ready. The client waits for the later `connected` data event.
      enqueueText(":\n\n");
    },
    cancel() {
      cancelStream(false);
    },
  }, {
    highWaterMark: STREAM_HIGH_WATER_MARK_BYTES,
    size: (chunk) => chunk.byteLength,
  });
}
