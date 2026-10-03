/**
 * fork:proma-37-deferred-model —— 「运行中改模型，下轮生效」纯逻辑的单测。
 *
 * 钉住三件事：
 *   · 运行中（isStreaming）绝不判成 apply-now（硬约束：不许运行中 set_model）；
 *   · 排队要可覆盖、可去重，取走条件不满足时必须留着（模型不能丢）；
 *   · 换会话作废、但「新会话 promote」不误伤。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  decideModelSelection,
  pendingFlushDecision,
  sameModelRef,
  shouldClearPendingModel,
} = await jiti.import("@/lib/pending-model");

const CURRENT = { provider: "anthropic", modelId: "claude-opus" };
const OTHER = { provider: "openai", modelId: "gpt-5" };

test("同一个模型引用需要 provider 与 modelId 都相等", () => {
  assert.equal(sameModelRef(CURRENT, { ...CURRENT }), true);
  assert.equal(sameModelRef(CURRENT, { provider: "openai", modelId: "claude-opus" }), false);
  assert.equal(sameModelRef(CURRENT, { provider: "anthropic", modelId: "claude-sonnet" }), false);
  assert.equal(sameModelRef(null, CURRENT), false);
  assert.equal(sameModelRef(CURRENT, null), false);
});

test("空闲时选中别的模型 = 立刻应用", () => {
  const decision = decideModelSelection({
    next: OTHER, current: CURRENT, pending: null, isStreaming: false, runId: 3,
  });
  assert.deepEqual(decision, { kind: "apply-now" });
});

test("运行中选中别的模型 = 排队，绝不立刻应用", () => {
  const decision = decideModelSelection({
    next: OTHER, current: CURRENT, pending: null, isStreaming: true, runId: 9,
  });
  assert.equal(decision.kind, "defer");
  assert.deepEqual(decision.pending, { model: OTHER, queuedAtRunId: 9 });
  // 排队对象必须是拷贝：调用方之后改自己的 next 不能改掉已记下的模型。
  assert.notEqual(decision.pending.model, OTHER);
});

test("运行中连选两次 = 最后一次胜出，且保留排队时那轮的 runId", () => {
  const first = decideModelSelection({
    next: OTHER, current: CURRENT, pending: null, isStreaming: true, runId: 9,
  });
  const second = decideModelSelection({
    next: { provider: "google", modelId: "gemini-3" },
    current: CURRENT,
    pending: first.pending,
    isStreaming: true,
    runId: 9,
  });
  assert.equal(second.kind, "defer");
  assert.deepEqual(second.pending.model, { provider: "google", modelId: "gemini-3" });
  assert.equal(second.pending.queuedAtRunId, 9);
});

test("选当前模型 / 选已排队的模型 = noop，不产生新的排队记录", () => {
  const unchanged = decideModelSelection({
    next: CURRENT, current: CURRENT, pending: null, isStreaming: true, runId: 9,
  });
  assert.deepEqual(unchanged, { kind: "noop", reason: "unchanged" });

  const pending = { model: OTHER, queuedAtRunId: 4 };
  const repick = decideModelSelection({
    next: OTHER, current: CURRENT, pending, isStreaming: true, runId: 12,
  });
  assert.deepEqual(repick, { kind: "noop", reason: "unchanged" });
});

test("空闲时选「已排队的那个模型」也是 noop（清队列由显式取消负责）", () => {
  const decision = decideModelSelection({
    next: OTHER,
    current: CURRENT,
    pending: { model: OTHER, queuedAtRunId: 4 },
    isStreaming: false,
    runId: 12,
  });
  assert.deepEqual(decision, { kind: "noop", reason: "unchanged" });
});

test("没有 current（模型还没解析出来）时按新选择处理", () => {
  assert.equal(
    decideModelSelection({ next: OTHER, current: null, pending: null, isStreaming: false, runId: 0 }).kind,
    "apply-now",
  );
  assert.equal(
    decideModelSelection({ next: OTHER, current: null, pending: null, isStreaming: true, runId: 0 }).kind,
    "defer",
  );
});

test("落地闸门：只有一切就绪才 flush", () => {
  const pending = { model: OTHER, queuedAtRunId: 4 };
  assert.equal(
    pendingFlushDecision({ pending, hasSession: true, isStreaming: false, modelSwitchInFlight: false }),
    "flush",
  );
});

test("落地闸门：任何一种「发不了」都必须保留 pending", () => {
  const pending = { model: OTHER, queuedAtRunId: 4 };
  assert.equal(
    pendingFlushDecision({ pending: null, hasSession: true, isStreaming: false, modelSwitchInFlight: false }),
    "skip-none",
  );
  assert.equal(
    pendingFlushDecision({ pending, hasSession: false, isStreaming: false, modelSwitchInFlight: false }),
    "skip-no-session",
  );
  // 又来了一轮：不能发，否则就是在运行中 set_model。
  assert.equal(
    pendingFlushDecision({ pending, hasSession: true, isStreaming: true, modelSwitchInFlight: false }),
    "skip-streaming",
  );
  // 已有一次切换在途：串行化优先。
  assert.equal(
    pendingFlushDecision({ pending, hasSession: true, isStreaming: false, modelSwitchInFlight: true }),
    "skip-switch-in-flight",
  );
});

test("落地闸门的检查顺序：无会话先于运行中", () => {
  assert.equal(
    pendingFlushDecision({ pending: { model: OTHER, queuedAtRunId: 1 }, hasSession: false, isStreaming: true, modelSwitchInFlight: true }),
    "skip-no-session",
  );
});

test("换会话作废排队；新会话 promote（null → 真 id）不误伤", () => {
  assert.equal(shouldClearPendingModel("a", "b"), true);
  assert.equal(shouldClearPendingModel("a", null), false);
  assert.equal(shouldClearPendingModel(null, "b"), false);
  assert.equal(shouldClearPendingModel("a", "a"), false);
  assert.equal(shouldClearPendingModel(undefined, "b"), false);
  assert.equal(shouldClearPendingModel(null, undefined), false);
});