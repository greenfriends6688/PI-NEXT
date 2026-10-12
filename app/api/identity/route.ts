import { userInfo } from "node:os";

import { NextResponse } from "next/server";

import { avatarRejectionReason, resolveIdentity } from "@/lib/identity";
import { readIdentity, writeIdentity } from "@/lib/identity-settings";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * fork:ai-identity —— 「设置 → AI 身份」（聊天里显示成谁）。
 *
 * GET  —— `{ version, identity, defaults }`：当前三态 + 品牌回退名/头像（设置页要拿它
 *         显示「恢复默认头像」与输入框的占位）。
 * PUT  —— `{ name?, avatar?, syncWithUserProfile? }`：整份覆盖。`avatar` 只收
 *         `data:image/...;base64,` 且限长 —— 它落在偏好文件里，几个 MB 的原图会连累
 *         同一文件其它开关的读写。空串 = 清掉（回退品牌图）。
 *
 * 纯展示数据，**不进 prompt**：agent 在系统提示词里的自我描述由 `AGENTS.md` 决定，
 * 两件事不互相影响（那是另一个决策，不藏在一次设置改动里）。
 */
function currentUserName(): string {
  try {
    return userInfo().username ?? "";
  } catch {
    return "";
  }
}

export async function GET() {
  try {
    return NextResponse.json({
      version: 1,
      identity: readIdentity(),
      // 「同步用户头像与名称」用哪个名字：本机用户名（不新开一个设置项 —— 那会是
      // 「为了一个开关再填一次自己的名字」）。取不到就空串，同步模式自动回退。
      userName: currentUserName(),
      defaults: { name: "PI NEXT", avatar: "/pi-next-logo.png" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
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
    const body = await req.json() as Record<string, unknown>;
    if (body.name !== undefined && typeof body.name !== "string") {
      return NextResponse.json({ error: "name must be a string" }, { status: 400 });
    }
    if (body.syncWithUserProfile !== undefined && typeof body.syncWithUserProfile !== "boolean") {
      return NextResponse.json({ error: "syncWithUserProfile must be a boolean" }, { status: 400 });
    }
    if (body.avatar !== undefined) {
      if (typeof body.avatar !== "string") {
        return NextResponse.json({ error: "avatar must be a string" }, { status: 400 });
      }
      const reason = avatarRejectionReason(body.avatar);
      if (reason === "too-large") {
        return NextResponse.json({ error: "Avatar is larger than 512 KB", reason }, { status: 413 });
      }
      if (reason) {
        return NextResponse.json({ error: "Avatar must be a base64 image data URL", reason }, { status: 400 });
      }
    }
    const identity = resolveIdentity({ ...readIdentity(), ...body });
    return NextResponse.json({ version: 1, identity: writeIdentity(identity) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
