// fork:pr12-a6-thinking-budget —— 思考档 token 预算的 GET/PUT（画板 40 帧 1 右栏那一块的数据源）
import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  parseThinkingBudgetUpdate,
  readThinkingBudgetSettings,
  ThinkingBudgetReadError,
  writeThinkingBudgetSettings,
} from "@/lib/thinking-budget-settings";
import type { ThinkingBudgetSettingsResponse } from "@/lib/thinking-budget-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readThinkingBudgetSettings());
  } catch (error) {
    // 422 而不是 500：settings.json 读不出来是「你的文件坏了」，不是「服务器炸了」。
    // 前端据此禁用控件并显示原因 —— 盖一份默认值回去会丢掉文件里其余的设置。
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: error instanceof ThinkingBudgetReadError ? 422 : 500 },
    );
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json();
    const update = parseThinkingBudgetUpdate(body);
    const settings = await writeThinkingBudgetSettings(update);
    return NextResponse.json(settings satisfies ThinkingBudgetSettingsResponse);
  } catch (error) {
    if (error instanceof TypeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: error instanceof ThinkingBudgetReadError ? 422 : 500 },
    );
  }
}
