/**
 * 把一条聊天消息交给会话，并把这一轮的答复带回来。
 *
 * 走的是既有 RPC 面（`POST /api/agent/<id>` 的 prompt / get_state /
 * get_last_assistant_text），与浏览器发消息**同一条路** —— 不另开一套 agent 通道，少一份
 * 生命周期、少一处行为漂移。
 */

const DEFAULT_SETTLE_MS = 700;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

async function postAgent<T>(deliverUrl: string, sessionId: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${deliverUrl}${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; data?: unknown };
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload.data as T;
}

/**
 * 给没绑会话的渠道开一个会话：今天的临时目录（~/pi-cwd/YYYYMMDD），走 UI「新建会话」
 * 同一条路由（`POST /api/agent/new`）。
 *
 * 为什么不落到「最近活跃的会话」：那会把一条手机消息塞进你正在改代码的那个会话里 ——
 * 你可能正开着它，机器人一插话就把那一轮冲掉了。
 */
export async function newBotSession(deliverUrl: string): Promise<string> {
  try {
    const [{ defaultCwdPath }, { mkdirSync }] = await Promise.all([
      import("./default-cwd"),
      import("node:fs"),
    ]);
    const cwd = defaultCwdPath();
    mkdirSync(cwd, { recursive: true });
    // `type: "ensure_session"` 是必须的：这条路由只建会话、不发第一条 prompt
    // （没有 type 会回 400 "Unsupported command"）。消息由 runPromptAndWait 发。
    const response = await fetch(new URL("new", deliverUrl).toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, type: "ensure_session" }),
    });
    const payload = await response.json().catch(() => ({})) as { sessionId?: string };
    if (!response.ok || !payload.sessionId) {
      console.warn("[bot-channel] could not create a session:", response.status);
      return "";
    }
    return payload.sessionId;
  } catch (error) {
    console.warn("[bot-channel] could not create a session:", error instanceof Error ? error.message : String(error));
    return "";
  }
}

export interface RunOptions {
  settleMs?: number;
  timeoutMs?: number;
}

/**
 * 发一条消息，等这一轮结束，取最后一段 assistant 文本。
 *
 * **注入前先看这个会话是不是在跑。** 这不是假想：把渠道绑到一个正在用的会话上时，机器人
 * 的消息会直接插进那一轮对话里，把人正在进行的操作冲掉。所以正在跑就不注入，只回一句
 * 「它现在在忙」，让人自己决定什么时候放机器人进来。
 */
export async function runPromptAndWait(
  deliverUrl: string,
  sessionId: string,
  text: string,
  options: RunOptions = {},
): Promise<string> {
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const before = await postAgent<{ isStreaming?: boolean } | null>(deliverUrl, sessionId, { type: "get_state" });
  if (before?.isStreaming === true) {
    return "That session is running a turn right now — not injecting into it. Try again when it settles.";
  }

  // 字段名与浏览器发消息那条路一致：是 `message`，不是 `text`。
  await postAgent(deliverUrl, sessionId, { type: "prompt", message: text });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    const state = await postAgent<{ isStreaming?: boolean } | null>(deliverUrl, sessionId, { type: "get_state" });
    if (state && state.isStreaming === false) break;
  }

  const final = await postAgent<{ text?: string } | string | null>(deliverUrl, sessionId, { type: "get_last_assistant_text" });
  const reply = typeof final === "string" ? final : final?.text;
  return (reply ?? "").trim() || "(no reply)";
}
