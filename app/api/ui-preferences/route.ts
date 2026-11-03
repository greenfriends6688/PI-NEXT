import { NextResponse } from "next/server";
import { hasJsonContentType } from "@/lib/request-security";
import {
  isValidKey,
  parsePreferencePatch,
  readUiPreferences,
  writeUiPreferences,
} from "@/lib/ui-preferences";

export const dynamic = "force-dynamic";

// GET /api/ui-preferences  → { version, preferences: { <key>: { value, updatedAt } } }
// PUT /api/ui-preferences  body: { <key>: "<localStorage 原样的字符串>" }
//
// 设置页里每一项本来就自动生效，但只存在浏览器里。这个文件让它们在换设备、换浏览器、
// 手机扫码进来之后仍然是同一套值；合并语义（逐键、最后写入者胜）见 lib/ui-preferences.ts。
export async function GET() {
  return NextResponse.json(readUiPreferences(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "body must be an object of key/value pairs" }, { status: 400 });
  }
  const patch = parsePreferencePatch(body);
  const keys = Object.keys(body as Record<string, unknown>);
  if (patch.length !== keys.length) {
    // 部分非法：一个键名不合法或值太长。指出键名，方便排查是谁在写。
    const rejected = keys.filter((key) => !isValidKey(key) || patch.every((entry) => entry.key !== key));
    return NextResponse.json({ error: `invalid preference key(s): ${rejected.join(", ")}` }, { status: 400 });
  }
  const saved = await writeUiPreferences(patch);
  return NextResponse.json(saved, { headers: { "Cache-Control": "no-store" } });
}
