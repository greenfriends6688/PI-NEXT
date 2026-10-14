/**
 * fork:agent-mail —— agent↔agent 的信箱。
 *
 * 抄 MusePi 的 `IrcBus`（`packages/coding-agent/src/irc/bus.ts`：进程内邮箱，
 * `send` / `inbox` / `wait`，投递语义 injected / woken / revived / failed），
 * 但只抄**信箱**这一半：唤醒活着的会话走 `subagent-runtime.ts` 的 `deliver()`
 * （`sendCustomMessage` + `deliverAs:"followUp"`），所以不需要在信箱里再造一套唤醒逻辑。
 *
 * 与 IrcBus 一样是**进程内**的：重启即丢。这是刻意的 —— 真正的持久化归会话文件
 * （parent↔child 的对话本来就在各自 `.jsonl` 里），信箱只放运行期才存在的旁路消息。
 */

export interface SubagentMailMessage {
  id: string;
  from: string;
  /** 发件人的可读名（profile / description），只为了模型能看懂是谁在说话。 */
  fromLabel: string;
  to: string;
  body: string;
  sentAt: number;
}

// ponytail: 每个收件箱固定上限 FIFO 丢弃最旧的。进程内信箱，跑满 50 封意味着有人
// 在 `wait` 循环里 spam —— 换成落盘或按会话配额是过度设计，真需要时再加。
const MAX_MESSAGES_PER_BOX = 50;

export class SubagentMailbox {
  #boxes = new Map<string, SubagentMailMessage[]>();
  #waiters = new Map<string, Set<() => void>>();

  send(message: SubagentMailMessage): void {
    const box = this.#boxes.get(message.to) ?? [];
    box.push(message);
    if (box.length > MAX_MESSAGES_PER_BOX) box.splice(0, box.length - MAX_MESSAGES_PER_BOX);
    this.#boxes.set(message.to, box);
    // 唤醒所有在等的 waitFor（可能有多个并发 wait）。
    const waiters = this.#waiters.get(message.to);
    if (waiters) for (const wake of [...waiters]) wake();
  }

  /** 不消费地看一眼，用于「有没有信」的判断。 */
  peek(to: string): SubagentMailMessage[] {
    return [...(this.#boxes.get(to) ?? [])];
  }

  /** 取走并清空：读一次就只读一次，避免模型反复 drain 同一封信。 */
  drain(to: string): SubagentMailMessage[] {
    const box = this.#boxes.get(to) ?? [];
    this.#boxes.delete(to);
    return box;
  }

  /**
   * 等一封信。`signal` 中止或超时都返回 false（调用方据此决定是超时还是被取消），
   * 两种情况都不抛 —— 让模型看到「还没等到」比看到异常更好用。
   */
  waitFor(to: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    if ((this.#boxes.get(to) ?? []).length > 0) return Promise.resolve(true);
    if (signal?.aborted) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (delivered: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const waiters = this.#waiters.get(to);
        waiters?.delete(wake);
        if (waiters && waiters.size === 0) this.#waiters.delete(to);
        resolve(delivered);
      };
      const wake = () => finish((this.#boxes.get(to) ?? []).length > 0);
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      const waiters = this.#waiters.get(to) ?? new Set<() => void>();
      waiters.add(wake);
      this.#waiters.set(to, waiters);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  get boxCount(): number {
    return this.#boxes.size;
  }
}

const MAILBOX_KEY = Symbol.for("pi-web.subagentMailbox");

export function subagentMailbox(): SubagentMailbox {
  const registry = globalThis as unknown as Record<symbol, SubagentMailbox | undefined>;
  const existing = registry[MAILBOX_KEY];
  if (existing) return existing;
  const created = new SubagentMailbox();
  registry[MAILBOX_KEY] = created;
  return created;
}

/** 给模型看的原文。一行一条，前面带发件人，省得模型猜谁在说话。 */
export function formatMail(messages: readonly SubagentMailMessage[]): string {
  return messages
    .map((message) => `[${message.fromLabel} · ${message.from}] ${message.body}`)
    .join("\n\n");
}
