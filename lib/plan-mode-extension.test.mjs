/**
 * fork:pr52-plan-tools —— 计划档放行计划产物本身。
 *
 * 为什么这条规则必须单独测：`write_plan` 是「非只读」动作（它落盘），而计划档的
 * 语义是「只允许只读」—— 所以不做放行的话，计划档下**永远写不出计划**，主用例直接
 * 失效（Proma 在 `agent-orchestrator.ts:1449` 做了同样的放行）。
 *
 * 但放行判据需要知道计划目录在哪（`isPlanArtifactToolCall` 要 planDirectory），
 * 而 pi 的 `tool_call` 事件**不带 cwd** —— 只能从创建时捕获。这是本文件存在的全部理由。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createPlanModeExtension, HOST_PLAN_MODE_EXTENSION_NAME } = await jiti.import("./plan-mode-extension.ts");
const { planDocumentsDirectory } = await jiti.import("./plan-documents.ts");

const CWD = "/tmp/proma-plan-mode-test/project";

/** 造一个只记录 tool_call 订阅的假 pi。 */
function harness(getMode, agentCwd) {
  const handlers = new Map();
  const pi = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerTool() {},
  };
  createPlanModeExtension(getMode, agentCwd).factory(pi);
  return {
    async call(toolName, input = {}) {
      const handler = handlers.get("tool_call");
      assert.ok(handler, "tool_call handler 未注册");
      return (await handler({ toolName, input }, {})) ?? undefined;
    },
  };
}

test("扩展名与 hidden 标记不变", () => {
  const ext = createPlanModeExtension(() => "bypass");
  assert.equal(ext.name, HOST_PLAN_MODE_EXTENSION_NAME);
  assert.equal(ext.hidden, true);
});

test("非计划档一律不注册任何拦截", async () => {
  const h = harness(() => "bypass");
  assert.equal(await h.call("write_plan", { path: `${planDocumentsDirectory(CWD)}/a.md` }), undefined);
  assert.equal(await h.call("bash", { command: "rm -rf /" }), undefined);
});

test("计划档：write_plan 写在本会话计划目录里 → 放行", async () => {
  const h = harness(() => "plan", CWD);
  const dir = planDocumentsDirectory(CWD);
  assert.equal(await h.call("write_plan", { path: `${dir}/2026-10-02-demo.md`, title: "t", body: "b" }), undefined);
});

test("计划档：write_plan 写去计划目录之外 → 仍然拦下（放行不能开成万能写文件）", async () => {
  const h = harness(() => "plan", CWD);
  const result = await h.call("write_plan", { path: "/tmp/somewhere-else/evil.md", title: "t", body: "b" });
  assert.ok(result?.block, "写到计划目录外必须被拦");
  assert.equal(result?.reason, result?.reason); // 只断言被拦
});

test("计划档：read_plan 不带 path（读本会话当前那份）→ 放行", async () => {
  const h = harness(() => "plan", CWD);
  assert.equal(await h.call("read_plan", {}), undefined);
});

test("计划档：bash 这类非计划产物动作照旧拦下", async () => {
  const h = harness(() => "plan", CWD);
  const result = await h.call("bash", { command: "rm -rf /" });
  assert.ok(result?.block, "bash 在计划档必须被拦");
});

test("没给 agentCwd 时 fail closed：write_plan 被拦下而不是被放行", () => {
  // 这条是安全方向的失败：判据拿不到计划目录就一律 false，于是计划档下写不出计划。
  // 显式钉住它 —— 万一有人把 fail closed 改成 fail open，这里会红。
  const h = harness(() => "plan", undefined);
  return h.call("write_plan", { path: `${planDocumentsDirectory(CWD)}/a.md`, title: "t", body: "b" })
    .then((result) => {
      assert.ok(result?.block, "没有 cwd 时必须拦（fail closed），不能放行");
    });
});