// fork:proma-43-automation —— 调度器与真实 pi 会话之间的那一层。
/**
 * `lib/automation-scheduler.ts` 只知道「给子会话发一轮，回我 sessionId 和上下文占用率」，
 * 不知道怎么开 pi 会话、怎么发 prompt、怎么等它跑完。这一层补上，
 * 好处是调度器的全部决策都能被纯单测覆盖，而这一层只剩「调 SDK」这种没有分支的活。
 *
 * 三件**必须**在这里做对的事：
 *
 * 1. **强制 bypass 权限**（`set_permission_mode`）。定时任务跑的时候没人盯着；
 *    会话里若残留 `ask` 档，审批扩展会弹一张永远等不到回答的卡，那一轮会一路挂到 2 小时超时，
 *    之后每一轮都被判成「上一轮未结束」而 skip —— 任务看起来还活着，其实已经死了。
 * 2. **等 `agent_end` 而不是等 `send("prompt")` 返回**。`send` 只等到「SDK 接受了这条提示词」
 *    就返回（preflight ack），真正的回合还在跑。提前 resolve 会让调度器认为这一轮已完成，
 *    接着把上下文占用率记成 0，下一轮又去复用那个还在写的会话。
 * 3. **超时 abort**。`AbortSignal` 是调度器给的，这里翻译成 `send({type:"abort"})`。
 */
import { randomUUID } from "node:crypto";
import { getRpcSession, startRpcSession, type AgentSessionWrapper } from "./rpc-manager";
import { allowFileRoot } from "./file-access";
import { getSessionEntries, invalidateSessionListCache, resolveSessionPath } from "./session-reader";
import { AUTOMATION_FORCED_PERMISSION_MODE } from "./automation-types";
import type {
  AutomationRunPort,
  AutomationRunRequest,
  AutomationRunResult,
} from "./automation-scheduler";

/** 我们自己开出来的子会话：realSessionId → live wrapper，复用时免得重复打开同一个文件。 */
const liveSessions = new Map<string, AgentSessionWrapper>();

/** `${provider}/${modelId}` → startRpcSession 的 initialModel。 */
function parseModelRef(model: string | undefined): { provider: string; modelId: string } | undefined {
  if (!model) return undefined;
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return undefined;
  return { provider: model.slice(0, slash), modelId: model.slice(slash + 1) };
}

/** 拿到一个可用的子会话：复用优先，文件丢了就退回新建。 */
async function openSession(request: AutomationRunRequest): Promise<{
  session: AgentSessionWrapper;
  sessionId: string;
  reused: boolean;
}> {
  const reuseId = request.reuseSessionId;
  if (reuseId) {
    const live = liveSessions.get(reuseId) ?? getRpcSession(reuseId);
    if (live?.isAlive()) {
      liveSessions.set(reuseId, live);
      return { session: live, sessionId: reuseId, reused: true };
    }
    const sessionFile = await resolveSessionPath(reuseId);
    if (sessionFile) {
      const { session } = await startRpcSession(reuseId, sessionFile, undefined);
      liveSessions.set(reuseId, session);
      return { session, sessionId: reuseId, reused: true };
    }
    // 会话文件不在了（被删/被清理）→ 当作没跑过，另开一个。
    liveSessions.delete(reuseId);
  }

  // 一次性的 temp key：startRpcSession 会把并发同 key 的调用合并到同一个会话，
  // 而定时任务彼此独立，绝不能共用 key。
  const tempKey = `__automation__${randomUUID()}`;
  const initialModel = parseModelRef(request.model);
  const { session, realSessionId } = await startRpcSession(tempKey, "", request.cwd, {
    ...(initialModel ? { initialModel } : {}),
  });
  allowFileRoot(request.cwd);
  invalidateSessionListCache();
  liveSessions.set(realSessionId, session);
  // wrapper 被 rpc-manager 回收时同步清掉引用，别让 Map 攒一串死会话。
  session.onDestroy(() => {
    if (liveSessions.get(realSessionId) === session) liveSessions.delete(realSessionId);
  });
  return { session, sessionId: realSessionId, reused: false };
}

/** 一轮跑完：SDK 的 `agent_end` 表示 agent 循环结束。
 *  返回 cancel()：prompt 被 preflight 拒收时那条 await 永远不会兑现，
 *  必须由调用方把监听摘掉，否则 wrapper 上会攒下一个永不触发的闭包。 */
function waitForRunEnd(session: AgentSessionWrapper, signal: AbortSignal): {
  promise: Promise<void>;
  cancel: () => void;
} {
  let unsubscribe: (() => void) | null = null;
  let onAbort: (() => void) | null = null;
  const cleanup = (): void => {
    unsubscribe?.();
    unsubscribe = null;
    if (onAbort) signal.removeEventListener("abort", onAbort);
    onAbort = null;
  };
  const promise = new Promise<void>((resolve, reject) => {
    onAbort = () => {
      cleanup();
      reject(new Error("automation run aborted"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    unsubscribe = session.onEvent((event) => {
      if (event.type === "agent_end") {
        cleanup();
        resolve();
      }
    });
  });
  return { promise, cancel: () => { cleanup(); } };
}

/**
 * 「用户接管过」探测：上次定时运行之后，这个会话文件里是否多了一条**用户**消息。
 *
 * 定时任务自己发的每一条都是 user role，所以单看 role 分不出来；靠时间戳分：
 * 我们记着 `lastRunAt`，比它更新的用户消息只可能是用户自己在会话里敲的。
 * 探测不了（文件读不到 / 解析失败）返回 false —— 读不到不等于接管，
 * 宁可继续复用，也不要因为一次 IO 抖动就丢掉连续上下文。
 */
async function hasUserPromptSince(sessionId: string, since: number): Promise<boolean> {
  if (!since) return false;
  try {
    const path = await resolveSessionPath(sessionId);
    if (!path) return false;
    for (const entry of getSessionEntries(path)) {
      if (entry.type !== "message") continue;
      const message = (entry as { message?: { role?: string; timestamp?: number } }).message;
      if (message?.role === "user" && typeof message.timestamp === "number" && message.timestamp > since) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** 组装真实运行口。 */
export function createRpcAutomationRunner(): AutomationRunPort {
  return {
    async run(request: AutomationRunRequest): Promise<AutomationRunResult> {
      const startedAt = Date.now();
      const { session, sessionId } = await openSession(request);

      // 无人值守强制 bypass —— 见文件头第 1 条。
      await session.send({ type: "set_permission_mode", mode: AUTOMATION_FORCED_PERMISSION_MODE });
      await session.send({ type: "set_session_name", name: request.automation.name });

      const finished = waitForRunEnd(session, request.signal);
      try {
        await session.send({ type: "prompt", message: `${request.context}\n\n${request.prompt}` });
        await finished.promise;
      } catch (error) {
        finished.cancel();
        // 超时/中止：把底层这一轮也停下来，否则它会继续烧 token。
        if (request.signal.aborted) {
          void session.send({ type: "abort" }).catch(() => {});
        }
        throw error;
      } finally {
        finished.cancel();
      }

      let contextUsage: number | undefined;
      try {
        const state = await session.send({ type: "get_state" }) as {
          contextUsage?: { percent: number | null } | null;
        };
        const percent = state.contextUsage?.percent;
        contextUsage = typeof percent === "number" && Number.isFinite(percent) ? percent : undefined;
      } catch {
        contextUsage = undefined;
      }

      return { sessionId, contextUsage, durationMs: Date.now() - startedAt };
    },

    isSessionBusy(sessionId: string): boolean {
      const session = liveSessions.get(sessionId) ?? getRpcSession(sessionId);
      return Boolean(session?.isAlive() && session.isRunning());
    },

    hasUserPromptSince,
  };
}

/** 进程退出前把 live 引用丢掉（wrapper 自己的 idle 回收仍然生效）。 */
export function clearAutomationSessionCache(): void {
  liveSessions.clear();
}