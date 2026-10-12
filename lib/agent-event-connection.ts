import type { AgentEventLike } from "./agent-event-wire";

export interface AgentEventSourceLike {
  readonly readyState: number;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export type AgentEventConnectionStatus = "ready_timeout" | "startup_error" | "closed";

export class AgentEventConnectionError extends Error {
  constructor(public readonly status: AgentEventConnectionStatus, message?: string) {
    super(message ?? (
      status === "ready_timeout"
        ? "Timed out starting the agent session. Please try again."
        : "Failed to connect to the agent event stream. Please try again."
    ));
    this.name = "AgentEventConnectionError";
  }
}

type Attempt = {
  promise: Promise<void>;
  ready: boolean;
  succeed(): void;
  fail(error: AgentEventConnectionError): void;
};

type Connection = {
  sessionId: string;
  source: AgentEventSourceLike;
  attempt: Attempt;
};

export interface AgentEventConnectionOptions {
  /** fork:event-seq — `lastEventId` 是上一次从这个会话收到的最大序号（没有则 null）。 */
  createSource(sessionId: string, lastEventId: number | null): AgentEventSourceLike;
  onEvent(event: AgentEventLike): void;
  shouldMaintain(sessionId: string): boolean;
  readinessTimeoutMs: number;
  reconnectDelayMs: number;
  onUnexpectedError?(error: unknown): void;
  /** fork:event-seq — 收到的事件序号跳过了一段，说明有权威事件没拿到。 */
  onSequenceGap?(sessionId: string, from: number, to: number): void;
}

const EVENT_SOURCE_OPEN = 1;

/** Owns the EventSource, agent-readiness handshake, and passive reconnect. */
export class AgentEventConnection {
  private current: Connection | null = null;
  private retry: { sessionId: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private retryGeneration = 0;
  /** fork:event-seq — 每个会话各自的 SSE 游标，跨重连保留（换会话自然失效）。 */
  private cursor: { sessionId: string; seq: number } | null = null;

  constructor(private readonly options: AgentEventConnectionOptions) {}

  close(): void {
    this.stopRetrying();
    if (this.current) this.discard(this.current, new AgentEventConnectionError("closed"));
  }

  maintain(sessionId: string): void {
    if (!this.options.shouldMaintain(sessionId)) return;
    const retryGeneration = this.retryGeneration;
    void this.ensureConnected(sessionId).catch((error) => {
      if (retryGeneration !== this.retryGeneration) return;
      if (error instanceof AgentEventConnectionError) {
        if (error.status === "startup_error") this.stopRetrying();
        else this.scheduleRetry(sessionId);
      } else {
        this.options.onUnexpectedError?.(error);
      }
    });
  }

  async ensureConnected(sessionId: string): Promise<void> {
    while (true) {
      let connection = this.current;
      if (!connection || connection.sessionId !== sessionId) {
        connection = this.open(sessionId);
      } else if (
        connection.attempt.ready
        && connection.source.readyState === EVENT_SOURCE_OPEN
      ) {
        return;
      }

      await connection.attempt.promise;
      if (this.current !== connection) {
        if (this.current?.sessionId === sessionId) continue;
        throw new AgentEventConnectionError("closed");
      }
      if (connection.source.readyState === EVENT_SOURCE_OPEN) return;

      // A once-ready EventSource may otherwise remain CONNECTING indefinitely.
      this.discard(connection, new AgentEventConnectionError("closed"));
    }
  }

  private open(sessionId: string): Connection {
    if (this.current) this.discard(this.current, new AgentEventConnectionError("closed"));

    let source: AgentEventSourceLike;
    const lastEventId = this.cursor?.sessionId === sessionId ? this.cursor.seq : null;
    try {
      source = this.options.createSource(sessionId, lastEventId);
    } catch (error) {
      throw new AgentEventConnectionError(
        "closed",
        error instanceof Error ? error.message : String(error),
      );
    }

    let settled = false;
    let resolve!: () => void;
    let reject!: (error: AgentEventConnectionError) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const timeout = setTimeout(() => {
      this.fail(connection, new AgentEventConnectionError("ready_timeout"));
    }, this.options.readinessTimeoutMs);
    const attempt: Attempt = {
      promise,
      ready: false,
      succeed() {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      },
      fail(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    };
    const connection: Connection = { sessionId, source, attempt };
    this.current = connection;

    source.onmessage = (message) => {
      if (this.current !== connection) return;
      let event: AgentEventLike;
      try {
        event = JSON.parse(message.data) as AgentEventLike;
      } catch {
        return;
      }

      if (event.type === "connected") {
        attempt.ready = true;
        attempt.succeed();
        this.stopRetrying();
      } else if (event.type === "startup_error") {
        const message = typeof event.errorMessage === "string" ? event.errorMessage : undefined;
        this.fail(connection, new AgentEventConnectionError("startup_error", message));
        return;
      }
      this.trackSequence(sessionId, event);
      this.options.onEvent(event);
    };
    source.onerror = () => {
      this.fail(connection, new AgentEventConnectionError("closed"));
    };

    return connection;
  }

  /**
   * fork:event-seq — 只有**带 `seq` 的事件**（权威事件）参与游标与缺口判定。
   * 可重建增量不带 seq，被背压丢掉不会误报缺口。
   */
  private trackSequence(sessionId: string, event: AgentEventLike): void {
    const raw = event.seq;
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0) return;
    const known = this.cursor?.sessionId === sessionId ? this.cursor.seq : null;
    if (known !== null && raw > known + 1) {
      try {
        this.options.onSequenceGap?.(sessionId, known, raw);
      } catch (error) {
        this.options.onUnexpectedError?.(error);
      }
    }
    if (known === null || raw > known) this.cursor = { sessionId, seq: raw };
  }

  private fail(connection: Connection, error: AgentEventConnectionError): void {
    if (this.current !== connection) return;
    this.discard(connection, error);
    if (error.status === "startup_error") this.stopRetrying();
    else this.scheduleRetry(connection.sessionId);
  }

  private discard(connection: Connection, error: AgentEventConnectionError): void {
    connection.attempt.fail(error);
    connection.source.close();
    if (this.current === connection) this.current = null;
  }

  private scheduleRetry(sessionId: string): void {
    if (!this.options.shouldMaintain(sessionId)) return;
    if (this.retry?.sessionId === sessionId) return;
    this.clearRetry();

    const timer = setTimeout(() => {
      if (this.retry?.timer !== timer) return;
      this.retry = null;
      this.maintain(sessionId);
    }, this.options.reconnectDelayMs);
    this.retry = { sessionId, timer };
  }

  private stopRetrying(): void {
    this.retryGeneration += 1;
    this.clearRetry();
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry.timer);
    this.retry = null;
  }
}
