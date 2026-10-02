// fork:proma-43-automation —— 定时任务的 CRUD 与动作入口。
/**
 * `GET /api/automation` → `{ automations, scheduler }`
 * `POST /api/automation` → `{ action, ... }`，动作见下方 switch。
 *
 * 路径 / 权限校验**复用既有那一套**，不自写：`isApiRequestAllowed` + `hasJsonContentType`
 * （与 `app/api/subagents/settings/route.ts`、`app/api/context-budget-settings/route.ts` 同款）。
 *
 * 状态码分工（照 context-budget 那条经验）：
 *   · 400 —— 请求体不合法（`AutomationInputError`）；
 *   · 415 —— Content-Type 不是 json；
 *   · 403 —— 不可信来源；
 *   · 404 —— 任务不存在；
 *   · 422 —— 存储读不出来（`AutomationStoreReadError`）。**不给它盖一份空列表回去**，
 *     那是 `lib/models-config-store.ts` 的教训：吞掉解析错误，下一次保存就把数据全抹了。
 */
import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { AutomationInputError, normalizeAutomationDraft, type AutomationDraft } from "@/lib/automation-types";
import { resumeAutomation } from "@/lib/automation-scheduler";
import { getAutomationSchedulerStatus, runAutomationNow } from "@/lib/automation-runtime";
import {
  AutomationStoreReadError,
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  markSessionTakenOver,
  patchAutomation,
  updateAutomation,
} from "@/lib/automation-store";

export const dynamic = "force-dynamic";

function errorStatus(error: unknown): number {
  if (error instanceof AutomationInputError) return 400;
  if (error instanceof AutomationStoreReadError) return 422;
  return 500;
}

export async function GET() {
  try {
    return NextResponse.json({
      automations: listAutomations(),
      scheduler: getAutomationSchedulerStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: errorStatus(error) },
    );
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const id = typeof body.id === "string" ? body.id : "";
  const now = Date.now();

  try {
    switch (action) {
      case "create": {
        const draft = normalizeAutomationDraft(body.automation);
        return NextResponse.json({ automation: createAutomation(draft, now) }, { status: 201 });
      }

      case "update": {
        if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
        if (!getAutomation(id)) return NextResponse.json({ error: "automation not found" }, { status: 404 });
        // 整体替换：面板保存的是完整表单，用 patch 语义会让「清掉一个可选字段」这种操作做不到。
        const draft: AutomationDraft = normalizeAutomationDraft(body.automation);
        const automation = updateAutomation(id, draft, now);
        return NextResponse.json({ automation });
      }

      case "delete": {
        if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
        if (!deleteAutomation(id)) {
          return NextResponse.json({ error: "automation not found" }, { status: 404 });
        }
        return NextResponse.json({ ok: true });
      }

      case "set-active": {
        if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
        const existing = getAutomation(id);
        if (!existing) return NextResponse.json({ error: "automation not found" }, { status: 404 });
        if (typeof body.active !== "boolean") {
          return NextResponse.json({ error: "active must be a boolean" }, { status: 400 });
        }
        // 重新启用 = 清掉暂停痕迹 + 立刻重算 nextRunAt。
        // resetQuota 用于「已完成（once / maxRuns）」的任务重开：不清 runCount 它会立刻又停用。
        const automation = body.active
          ? resumeAutomation(existing, now, body.resetQuota === true)
          : patchAutomation(id, { active: false, updatedAt: now })!;
        return NextResponse.json({ automation });
      }

      case "reset-failures": {
        if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
        const existing = getAutomation(id);
        if (!existing) return NextResponse.json({ error: "automation not found" }, { status: 404 });
        const automation = patchAutomation(id, { consecutiveFailures: 0, updatedAt: now })!;
        return NextResponse.json({ automation });
      }

      case "run-now": {
        if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
        if (!getAutomation(id)) return NextResponse.json({ error: "automation not found" }, { status: 404 });
        // 不 await：手动触发一跑可能几十分钟，HTTP 不能挂在这儿。
        void runAutomationNow(id).catch((error: unknown) => {
          console.error("[automation] run-now failed:", error);
        });
        return NextResponse.json({ ok: true, started: true });
      }

      case "take-over": {
        // 用户在会话里接管了一个定时任务的子会话 → 标记它，之后不再复用（规则三）。
        if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        const automation = markSessionTakenOver(id, sessionId || getAutomation(id)?.lastSessionId || "");
        if (!automation) return NextResponse.json({ error: "automation not found" }, { status: 404 });
        return NextResponse.json({ automation });
      }

      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: errorStatus(error) },
    );
  }
}