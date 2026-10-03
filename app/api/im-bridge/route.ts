import { NextResponse } from "next/server";

import {
  IM_PROVIDER_IDS,
  type ImBridgeConfig,
  type ImProvider,
  type ImTarget,
  detectImProvider,
  maskedImTargets,
  readImBridgeConfig,
  sendImMessage,
  writeImBridgeConfig,
} from "@/lib/im-bridge";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * GET /api/im-bridge —— 设置页读目标（掩码视图：只给 host，secret 不回浏览器）。
 * PUT —— 整表替换。掩码值表示「沿用原来的 secret」，所以编辑一条不会清掉它的加签密钥。
 * POST —— 给一个目标发一条测试消息（「试一下配对没有」是这类配置唯一的验收方式）。
 */
export async function GET() {
  return NextResponse.json({ targets: maskedImTargets(readImBridgeConfig()) });
}

function readTarget(body: Record<string, unknown>, stored: ImTarget | undefined): ImTarget | null {
  // **字段缺失 = 「客户端不知道，沿用已存的」；显式空串 = 「用户清掉了」。**
  // 设置页不回显 webhook 与 secret（两者都是凭证），所以编辑一条目标时这两个字段经常是缺省的。
  const raw = typeof body.url === "string" ? body.url.trim() : "";
  const url = raw || stored?.url || "";
  if (!/^https?:\/\//i.test(url)) return null;
  const provider = typeof body.provider === "string" && (IM_PROVIDER_IDS as readonly string[]).includes(body.provider)
    ? body.provider as ImProvider
    // 没写就按 URL 认；认不出落 custom，由发送路径原样 POST。
    : detectImProvider(url);
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : provider;
  const secret = typeof body.secret === "string" ? body.secret : stored?.secret;
  const chatId = typeof body.chatId === "string" ? body.chatId.trim() : stored?.chatId;
  return {
    id: typeof body.id === "string" && body.id.trim() ? body.id.trim() : crypto.randomUUID(),
    label,
    provider,
    url,
    ...(secret ? { secret } : {}),
    ...(chatId ? { chatId } : {}),
    enabled: body.enabled !== false,
  };
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let targets: ImTarget[];
  try {
    const body = await req.json() as { targets?: unknown };
    if (!Array.isArray(body.targets)) {
      return NextResponse.json({ error: "targets must be an array" }, { status: 400 });
    }
    const stored = new Map(readImBridgeConfig().targets.map((target) => [target.id, target]));
    const parsed = body.targets
      .map((entry) => {
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id.trim() : "";
        return readTarget(record, stored.get(id));
      })
      .filter((target): target is ImTarget => target !== null);
    if (parsed.length !== body.targets.length) {
      return NextResponse.json({ error: "every target needs an http(s) url" }, { status: 400 });
    }
    targets = parsed;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  const saved = writeImBridgeConfig({ version: 1, targets } satisfies ImBridgeConfig);
  return NextResponse.json({ targets: maskedImTargets(saved) });
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let id: string;
  let text: string | undefined;
  try {
    const body = await req.json() as { id?: unknown; text?: unknown };
    if (typeof body.id !== "string" || !body.id.trim()) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    id = body.id.trim();
    if (typeof body.text === "string" && body.text.trim()) text = body.text.trim();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  const target = readImBridgeConfig().targets.find((entry) => entry.id === id);
  if (!target) {
    return NextResponse.json({ error: `No IM target with id ${id}` }, { status: 404 });
  }

  // 出站副作用发生在**这条 POST 背后**，所以闸门照常管：非本机请求没有令牌就进不来
  // （fork:lan-access），读权限的只读令牌也只能 GET 到这里之外的东西。
  const outcome = await sendImMessage(target, {
    text: text ?? "PI NEXT IM bridge test",
    title: "PI NEXT",
  });
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
}
