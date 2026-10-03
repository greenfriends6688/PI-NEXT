// fork:proma-37-deferred-model —— 「运行中改模型，下轮生效」的纯逻辑层。
/**
 * Proma 的原话：「Agent 运行时可以预先切换模型，当前轮结束后会自动按新模型执行下一轮」
 * （release-notes v0.16.1「运行中切换模型」）。
 *
 * 本仓的 `set_model` 走 RPC，**运行中直接发会打断当前轮**（pi 的 AgentSession 在
 * 换模型时会重建内部 provider 流）。所以运行中的选择一律**只记账**，真正的
 * `set_model` 挂在**本轮真正结束**的那条既有路径上（`settleUiStage()`：SSE 的
 * `prompt_done` / `agent_settled` 与无 SSE 兜底的 `finishPromptWithoutStream` 都经过它），
 * 不另造定时器。
 *
 * 这里只有三个纯函数，不碰 React / SSE / 网络：
 *   · `decideModelSelection` —— 一次选择该「立刻换」「排队」还是「什么都不做」；
 *   · `pendingFlushDecision` —— 轮到落地时，这一刻能不能真的发 `set_model`；
 *   · `shouldClearPendingModel` —— 换会话时作废排队中的模型。
 *
 * 状态机（宿主在 hook 里存 `PendingModel | null`）：
 *
 * ```
 *   空闲 ──选择──▶ 立刻 set_model（无 pending）
 *   运行 ──选择──▶ pending = M（界面显示「下轮生效」）
 *   运行 ──再选──▶ pending = N（覆盖，最后一次胜出）
 *   运行 ──选当前──▶ 无变化（noop，不产生排队）
 *   本轮结束 ──▶ pending 非空且能发 → 取出 pending，立刻 set_model，pending 归零
 *   换会话 ──▶ pending = null（A 的模型不许带到 B）
 * ```
 */

/** 一个模型的身份。provider + modelId 一起才算同一个模型。 */
export interface ModelRef {
  provider: string;
  modelId: string;
}

/** 排队中、将在下一轮生效的模型。 */
export interface PendingModel {
  /** 排队的目标模型。 */
  model: ModelRef;
  /** 排队那一刻正在跑的轮次（单调 runId，见 useAgentSession 的 promptRunIdRef）。
   *  只用于诊断与单测钉住「排队发生在那轮进行中」，不参与任何时序判断。 */
  queuedAtRunId: number;
}

/** 一次模型选择的判定结果。 */
export type ModelSelectionDecision =
  /** 选的还是当前模型（或已排队的那个）：不发命令、不改 pending。 */
  | { kind: "noop"; reason: "unchanged" }
  /** 空闲：直接走既有的 `set_model` 路径。 */
  | { kind: "apply-now" }
  /** 运行中：只记账，等本轮结束。 */
  | { kind: "defer"; pending: PendingModel };

export interface ModelSelectionInput {
  /** 用户选中的模型。 */
  next: ModelRef;
  /** 当前这一轮实际在跑的模型（`displayModel`）。 */
  current: ModelRef | null;
  /** 已经排队中的模型。 */
  pending: PendingModel | null;
  /** 硬约束的判据：运行中不许 `set_model`。 */
  isStreaming: boolean;
  runId: number;
}

/** 两个模型引用是否同一个（provider 与 modelId 都相等）。 */
export function sameModelRef(a: ModelRef | null | undefined, b: ModelRef | null | undefined): boolean {
  if (!a || !b) return false;
  return a.provider === b.provider && a.modelId === b.modelId;
}

/**
 * 一次选择的唯一入口。
 *
 * 顺序很重要：先判 noop，再判是否 defer。选了「已经排队的那个模型」不该刷新排队
 * 记录（否则会把 `queuedAtRunId` 挪到当前轮，丢掉「哪一轮排的」这个诊断信息）。
 */
export function decideModelSelection(input: ModelSelectionInput): ModelSelectionDecision {
  if (
    sameModelRef(input.next, input.current)
    || sameModelRef(input.next, input.pending?.model)
  ) {
    return { kind: "noop", reason: "unchanged" };
  }
  if (input.isStreaming) {
    return { kind: "defer", pending: { model: { ...input.next }, queuedAtRunId: input.runId } };
  }
  return { kind: "apply-now" };
}

/** 到点落地时能不能真的把 `set_model` 发出去。 */
export type PendingFlushOutcome =
  /** 可以发。 */
  | "flush"
  /** 没有排队中的模型（或已被别的路径取走）。 */
  | "skip-none"
  /** 会话还没建出来（理论上到不了：运行中必有会话）。等下一轮结束再说。 */
  | "skip-no-session"
  /** 又来了一轮：发送与本轮结束事件撞车了。留着，下一轮结束再发。 */
  | "skip-streaming"
  /** 已经有一次模型切换在途（`modelSwitchPendingRef`），串行化优先。 */
  | "skip-switch-in-flight";

export interface PendingFlushInput {
  pending: PendingModel | null;
  hasSession: boolean;
  isStreaming: boolean;
  modelSwitchInFlight: boolean;
}

/**
 * 落地闸门。返回 `flush` 时调用方才可以把 pending 取走并发出 `set_model`；
 * 其它三种都必须**原样留着** pending —— 取走再发现发不了，模型就永远丢了。
 */
export function pendingFlushDecision(input: PendingFlushInput): PendingFlushOutcome {
  if (!input.pending) return "skip-none";
  if (!input.hasSession) return "skip-no-session";
  if (input.isStreaming) return "skip-streaming";
  if (input.modelSwitchInFlight) return "skip-switch-in-flight";
  return "flush";
}

/**
 * 换会话时要不要作废排队中的模型。
 *
 * 只有「从一个已经存在的会话换到另一个**不同的**已存在会话」才作废。
 * `null → 新会话 id`（`promoteNewSession`：新会话第一轮跑起来时 props 才拿到真 id）
 * **不算换会话** —— 那是同一个会话的前身，队列必须活着，否则新会话第一轮的
 * 「下轮生效」会被 remount 吃掉。
 */
export function shouldClearPendingModel(
  prevSessionId: string | null | undefined,
  nextSessionId: string | null | undefined,
): boolean {
  return Boolean(prevSessionId && nextSessionId && prevSessionId !== nextSessionId);
}