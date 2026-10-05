import { stat } from "fs/promises";
import { resolve } from "path";
import { DefaultModelWriteError, writeDefaultModel } from "@/lib/default-model-settings";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

/**
 * 写 pi 的「新会话起步模型」（settings.json 的 defaultProvider / defaultModel）。
 *
 * 读数在 GET /api/models（`defaultModel` 字段）；这里只有写。`{clear: true}` 用
 * pi 的内置默认——SDK 没有 clear setter，走 lib/default-model-settings.ts 的锁内
 * 改写，只删这两个顶层键。
 *
 * cwd 走与 /api/models 相同的 allow-list：settings.json 是全局文件，但请求仍然
 * 只允许来自已授权的工作区。
 */
export async function POST(req: Request) {
  let body: { cwd?: unknown; provider?: unknown; modelId?: unknown; clear?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const clearing = body.clear === true;
  if (!clearing && (typeof body.provider !== "string" || !body.provider
    || typeof body.modelId !== "string" || !body.modelId)) {
    return Response.json({ error: "provider and modelId are required" }, { status: 400 });
  }

  const cwd = resolve(typeof body.cwd === "string" && body.cwd ? body.cwd : process.cwd());
  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    await writeDefaultModel(clearing
      ? null
      : { provider: body.provider as string, modelId: body.modelId as string },
      { cwd },
    );
  } catch (error) {
    if (error instanceof DefaultModelWriteError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    return Response.json({ error: String(error) }, { status: 500 });
  }
  // 新会话的初始模型读的是缓存住的 services 视图，落盘后让它重读。
  invalidateModelsCache();
  return Response.json({ ok: true });
}
