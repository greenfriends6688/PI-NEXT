import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { PLAN_MODE_SYSTEM_PROMPT, decidePlanModeToolCall, isPlanMode } from "./plan-mode";
import { isPlanArtifactToolCall, planDocumentsDirectory } from "./plan-documents";
import type { PermissionModeName } from "./approval-policy";

/**
 * fork:proma-03-plan — 计划模式扩展。
 *
 * 只做两件事，都是官方示例里与 UI 无关的那部分语义：
 *
 * 1. `before_agent_start`：计划档下往 system prompt 追加「先调研、再给编号计划」的指令；
 * 2. `tool_call`：拦截非只读动作（判定复用 `lib/plan-mode.ts`，而它复用 PROMA-01 的分类器）。
 *
 * 官方示例里那些 TUI 专属部分（`/plan` 命令、Ctrl+Alt+P、footer 状态、进度 widget）
 * 在本仓要么已有等价物（档位按钮 = 开关；todo 工具 + 待办 chip = 进度），要么不适用。
 * `[DONE:n]` 标记那套也不搬：本仓的 todo 工具已经能在任务列表里表达同样的进度，
 * 再引入一套标记只会让模型有两套互相竞争的进度表达方式。
 *
 * `agentCwd` 是 fork:proma-52 加进来的：计划档要放行 `write_plan` / `read_plan`
 * （它们写的就是计划本身，属于「调研 → 出计划」的产物），而放行判据需要知道计划
 * 目录在哪 —— `pi` 的 `tool_call` 事件不带 cwd，所以只能从创建时捕获。
 * **不给就退化成不放行**：判据 fail closed（`planDocumentsDirectory(undefined)`
 * 得到的不是合法目录），于是计划档里 `write_plan` 会被拦 —— 那是个安全方向的失败。
 */

export const HOST_PLAN_MODE_EXTENSION_NAME = "pi-web-plan-mode";

export function createPlanModeExtension(
  getMode: () => PermissionModeName,
  agentCwd?: string,
): InlineExtension {
  return {
    name: HOST_PLAN_MODE_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      pi.on("before_agent_start", async (event) => {
        if (!isPlanMode(getMode())) return undefined;
        // 官方示例的同类处理：保留原有 systemPrompt，在其后追加上去。
        const base = event?.systemPrompt ? `${event.systemPrompt}\n\n` : "";
        return { systemPrompt: `${base}${PLAN_MODE_SYSTEM_PROMPT}` };
      });

      pi.on("tool_call", async (event) => {
        if (!isPlanMode(getMode())) return undefined;
        const input = (event.input ?? {}) as Record<string, unknown>;
        // fork:proma-52 — 计划档放行计划产物本身（write_plan / read_plan）。
        // 必须在只读判定**之前**，否则 write_plan 属于「非只读」会被直接拦下，
        // 计划档下就永远写不出计划。判据自己 fail closed：不在计划目录里就 false。
        if (agentCwd && isPlanArtifactToolCall(event.toolName, input, planDocumentsDirectory(agentCwd))) {
          return undefined;
        }
        const decision = decidePlanModeToolCall(event.toolName, input);
        if (decision.allowed) return undefined;
        return { block: true, reason: decision.reason ?? "计划模式下只允许只读动作" };
      });
    },
  };
}
