/**
 * fork:proma-37-deferred-model —— 「运行中改模型，下轮生效」接线层的回归网。
 *
 * 纯逻辑在 `lib/pending-model.ts`（那里已有单测）。这里钉的是**接线**，因为三条
 * 硬约束全都是接线问题，逻辑对了但接错地方一样会打断用户：
 *   · 运行中不许 set_model；
 *   · 落地必须挂在**既有的本轮结束路径**上，不许另造定时器；
 *   · 换会话要清队列，且「新会话 promote」不误伤。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hookSource = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");

// 注释里会提到 settleTurn() / settleUiStage()，先剥掉再数调用点。
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
  .map((line) => {
    const at = line.indexOf("//");
    return at === -1 ? line : line.slice(0, at);
  })
  .join("\n");

function slice(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `找不到起点：${from}`);
  const end = source.indexOf(to, start);
  assert.ok(end > start, `找不到终点：${to}`);
  return source.slice(start, end);
}

const settleTurnSource = slice(hookSource, "const settleTurn = useCallback", "const notifyPromptStage = useCallback");
const flushSource = slice(hookSource, "const flushNextTurnModel = useCallback", "const settleTurn = useCallback");
const modelChangeSource = slice(hookSource, "const handleModelChange = useCallback", "handleModelChangeRef.current = handleModelChange");

test("本轮结束的唯一出口是 settleTurn：先收尾，再落地排队模型", () => {
  assert.match(settleTurnSource, /const wasRunning = settleUiStage\(\);\s*flushNextTurnModel\(\);/);
  assert.match(settleTurnSource, /\[settleUiStage, flushNextTurnModel\]/);
});

test("三条既有结束路径都走 settleTurn，没有别处直接调 settleUiStage", () => {
  const code = stripComments(hookSource);
  // prompt_done / agent_settled / finishPromptWithoutStream 各一次调用点。
  const turnCalls = [...code.matchAll(/settleTurn\(\)/g)];
  assert.equal(turnCalls.length, 3, "prompt_done / agent_settled / finishPromptWithoutStream 各一次");
  // settleUiStage 只在 settleTurn 内部被调用（其余出现都是定义与注释）。
  const rawUiCalls = [...code.matchAll(/settleUiStage\(\)/g)];
  assert.equal(rawUiCalls.length, 1, "只允许 settleTurn 内部那一处");
  const definition = code.indexOf("const settleUiStage = useCallback");
  const settleTurnDef = code.indexOf("const settleTurn = useCallback");
  assert.ok(definition < settleTurnDef);
  assert.equal(
    code.slice(definition + "const settleUiStage = useCallback".length, settleTurnDef).includes("settleUiStage()"),
    false,
    "定义与 settleTurn 之间不许再有 settleUiStage 的直接调用",
  );
});

test("落地闸门：只有能发时才取走 pending", () => {
  assert.match(flushSource, /pendingFlushDecision\(\{/);
  assert.match(flushSource, /isStreaming: agentRunningRef\.current/);
  assert.match(flushSource, /modelSwitchInFlight: modelSwitchPendingRef\.current/);
  assert.match(flushSource, /if \(outcome !== "flush"\) return;/);
  // 取走 pending 之后才发命令，中间隔着 handleModelChangeRef。
  assert.match(flushSource, /nextTurnModelRef\.current = null;\s*setNextTurnModel\(null\);\s*void handleModelChangeRef\.current\?\./);
});

test("运行中的模型选择被 decideModelSelection 挡在 defer 分支里", () => {
  assert.match(modelChangeSource, /decideModelSelection\(\{/);
  assert.match(modelChangeSource, /isStreaming: agentRunningRef\.current/);
  assert.match(modelChangeSource, /if \(decision\.kind === "noop"\) return;\s*if \(decision\.kind === "defer"\) \{[\s\S]*?setNextTurnModel\(decision\.pending\);\s*return;/);
  // defer 分支之后才是既有的 isNew / 立即 set_model 路径。
  assert.match(modelChangeSource, /return;\s*\}\s*if \(isNew\) \{/);
  // 排队分支里刻意不碰选择器显示，否则落地时会被判成 noop 而永远发不出去。
  assert.doesNotMatch(
    modelChangeSource.slice(modelChangeSource.indexOf('if (decision.kind === "defer")'), modelChangeSource.indexOf("if (isNew) {")),
    /setNewSessionModel|setCurrentModelOverride/,
  );
});

test("换会话清队列，且用纯函数保住 promoteNewSession（null → 真 id）", () => {
  assert.match(hookSource, /if \(shouldClearPendingModel\(pendingModelSessionIdRef\.current, nextId\)\) \{[\s\S]*?setNextTurnModel\(null\);/);
});

test("模型选择器不再因运行中而置灰", () => {
  assert.doesNotMatch(chatInputSource, /<ModelSelector[\s\S]{0,320}?disabled=\{isStreaming\}/);
  /* fork:v5-landing —— 换皮后「下轮生效」芯片按形态各发一套类：桌面 D-04 的
     `.d-chipbtn is-on`、窄屏 M-03 的 `.m-tray-chip is-on`。断言跟着改成「两形态
     都要有一枚处于 is-on 的芯片」，而不是钉死 v1 的 `pw-chip accent`。 */
  assert.match(chatInputSource, /pendingModel && \([\s\S]{0,900}?className="d-chipbtn is-on"/);
  assert.match(chatInputSource, /pendingModel && \([\s\S]{0,900}?className="m-tray-chip is-on"/);
});