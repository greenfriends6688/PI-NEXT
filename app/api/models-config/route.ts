import { NextResponse } from "next/server";
import { ModelsConfigReadError, readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";
import { findBuiltinModelConflicts } from "@/lib/builtin-models";

export const dynamic = "force-dynamic";

export async function GET() {
  // 422（而不是读成空配置）：读不出内容时前端必须禁用保存，否则面板会把整份
  // draft 覆盖回 models.json，用户的 provider 全部消失。
  try {
    return NextResponse.json(readModelsConfig());
  } catch (error) {
    if (error instanceof ModelsConfigReadError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeModelsConfig(body);
    // provider-composer 对 `models[]` 是「整条替换」：用户写一个与内置同名的模型会丢掉
    // 内置 thinkingLevelMap / compat。保存成功后把 `provider/modelId` 冲突列表作为可选字段
    // `warnings` 回传（旧响应是 { success: true }，新字段向后兼容）。
    // 前端（components/ModelsConfig.tsx 保存回调）应在 d.warnings?.length > 0 时用现有
    // toast/notice 机制展示「覆盖内置定义」警告；没有冲突时不带该字段。
    const providers = (body.providers ?? {}) as Record<string, { models?: { id?: string }[] }>;
    const warnings = findBuiltinModelConflicts(providers);
    return NextResponse.json({
      success: true,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (error) {
    // 409：models.json 读不出来，写入不会碰文件（writeModelsConfig 先 re-read）。
    if (error instanceof ModelsConfigReadError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
