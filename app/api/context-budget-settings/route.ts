// fork:pr12-a5-context-budget —— 上下文压缩预算的 GET/PUT（画板 40 帧 1 右栏那一块的数据源）
import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  ContextBudgetReadError,
  parseContextBudgetUpdate,
  readContextBudgetSettings,
  writeContextBudgetSettings,
} from "@/lib/context-budget-settings";
import type { ContextBudgetSettingsResponse } from "@/lib/context-budget-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readContextBudgetSettings());
  } catch (error) {
    // 422 而不是 500：settings.json 读不出来是「你的文件坏了」，不是「服务器炸了」。
    // 前端据此禁用控件并显示原因 —— 盖一份默认值回去会丢掉文件里其余的设置。
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: error instanceof ContextBudgetReadError ? 422 : 500 },
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
    const update = parseContextBudgetUpdate(body);
    const settings = await writeContextBudgetSettings(update, {
      cwd: typeof (body as { cwd?: unknown }).cwd === "string"
        ? (body as { cwd: string }).cwd
        : process.cwd(),
    });
    return NextResponse.json(settings satisfies ContextBudgetSettingsResponse);
  } catch (error) {
    if (error instanceof TypeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: error instanceof ContextBudgetReadError ? 422 : 500 },
    );
  }
}
