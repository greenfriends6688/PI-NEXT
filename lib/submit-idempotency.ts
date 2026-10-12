// fork:submit-idempotency — 提交幂等键。
//
// 问题：`POST /api/agent/[id]` 的 prompt 没有幂等键。客户端只有一条同步软防重
// （`agentRunningRef`），挡得住同标签页连点，挡不住这两种真实情况：
//
//   1. 请求发出后响应丢失（代理超时/网络抖动）。`hooks/useAgentSession.ts` 把它判为
//      **不明确失败**（`definitivelyRejected = false`），乐观消息留在界面上等 SSE 确认；
//      用户看到消息还在，于是再点一次发送 —— 服务端可能已经接受了第一次，于是跑两轮。
//   2. 客户端在别处重试同一次提交。
//
// 做法照 XTLaw 的 `turn_requests(request_id + request_fingerprint)`：
// 客户端为**一次逻辑提交**生成一个 requestId，重试时复用；服务端按 requestId 去重，
// 同一个 requestId 带不同内容 → 冲突（409 语义），不静默跑第二轮。
//
// 刻意不做的事：**不用内容哈希当 requestId**。那样「用户过一会儿又发同一句
// continue」会被当成重放而不跑 —— XTLaw 的 requestId 是每次提交现生成的，不是内容派生的。

/** 一次提交的内容指纹。同 requestId 不同指纹 = 冲突。 */
export interface SubmissionContent {
  message: string;
  images?: Array<{ data: string; mimeType?: string }>;
  streamingBehavior?: string;
}

/** FNV-1a 32 位 ×2，够区分「同 id 不同内容」，不用于安全。 */
function hashString(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export function submissionFingerprint(content: SubmissionContent): string {
  const images = content.images?.map((image) => `${image.mimeType ?? ""}:${image.data.length}:${hashString(image.data)}`) ?? [];
  return hashString(JSON.stringify([content.message, images, content.streamingBehavior ?? ""]));
}

export function createSubmitRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `submit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 不明确失败后要不要复用上一个 requestId。
 *
 * 只在**内容指纹一致**时复用：用户改了正文再发，那是另一次提交，必须换新 id
 * （否则服务端会判冲突）。返回 null 表示「用新的 id」。
 */
export function reuseRequestIdAfterAmbiguousFailure(
  previous: { requestId: string; fingerprint: string } | null | undefined,
  fingerprint: string,
): string | null {
  if (!previous) return null;
  return previous.fingerprint === fingerprint ? previous.requestId : null;
}

export type SubmitTicket =
  | { kind: "new"; resolve(): void; reject(error: unknown): void }
  | { kind: "join"; promise: Promise<void> }
  | { kind: "conflict" };

interface Entry {
  fingerprint: string;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * 进程内、按会话持有的提交去重表。
 *
 * 语义（与 XTLaw 对齐）：
 * - 同 key 不同指纹 → `conflict`（调用方报错，不跑）。
 * - 同 key 同指纹 → `join`，等第一次的结果：第一次被拒，join 也拒（用户能重试）。
 * - 第一次**被拒**时立刻删除条目 —— 被拒的提交没有产生 run，重试必须能继续。
 * - 第一次**成功**后条目保留 `ttlMs`，期间重放直接 join（不产生第二轮）。
 *
 * ponytail: 进程内 Map + TTL，够用。要跨进程/跨重启去重就得落盘（XTLaw 用
 * `turn_requests` 表），本仓没有本地 run 表，等真有这个需求再加。
 */
export class SubmitDedup {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly options: { ttlMs?: number; maxEntries?: number } = {},
  ) {}

  begin(key: string, fingerprint: string): SubmitTicket {
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return { kind: "conflict" };
      return { kind: "join", promise: existing.promise };
    }

    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // 没人 join 时，这个 promise 的拒绝不能变成 unhandledRejection。
    promise.catch(() => {});

    const entry: Entry = { fingerprint, promise, resolve, reject, settled: false };
    this.entries.set(key, entry);
    this.trim();

    return {
      kind: "new",
      resolve: () => {
        if (entry.settled) return;
        entry.settled = true;
        entry.resolve();
        this.scheduleExpiry(key, entry);
      },
      reject: (error: unknown) => {
        if (entry.settled) return;
        entry.settled = true;
        entry.reject(error);
        // 被拒 = 没有 run，条目立刻消失，重试才能继续。
        if (this.entries.get(key) === entry) this.entries.delete(key);
      },
    };
  }

  /** 仅供测试/诊断：当前保留的 key 数。 */
  get size(): number {
    return this.entries.size;
  }

  private scheduleExpiry(key: string, entry: Entry): void {
    const ttlMs = this.options.ttlMs ?? 10 * 60 * 1000;
    if (ttlMs <= 0) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      return;
    }
    entry.timer = setTimeout(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    }, ttlMs);
    entry.timer.unref?.();
  }

  private trim(): void {
    const max = this.options.maxEntries ?? 128;
    while (this.entries.size > max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      const entry = this.entries.get(oldest.value);
      if (entry?.timer) clearTimeout(entry.timer);
      this.entries.delete(oldest.value);
    }
  }
}
