/**
 * fork:proma-46-mcp-catalog — 「一键 OAuth」：把 pi 的 MCP 登录流程直接接到浏览器。
 *
 * 复用 `lib/mcp-auth-command.ts` 的 `signInMcpServerWithPrompt`（内部就是 pi 的
 * `signInMcpServer` + `McpOAuthCredentialStore`），**不自己实现任何 OAuth**：
 * PKCE、动态客户端注册、token 刷新、`mcp-auth.json` 落盘全部由 pi 负责。
 *
 * 与 `app/api/auth/login/[provider]` 同一套形态：GET 是 SSE 流，POST 回填
 * 「浏览器地址栏里的 callback URL」。loopback 回调（pi 只监听 `127.0.0.1`）能直达
 * 时不会触发 prompt 分支；远程部署拿不到回跳时，扩展会要求用户把 URL 粘回来。
 *
 * 这是**新增**路由，不碰 `app/api/mcp/route.ts` 的响应形状与状态码。
 */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getMcpServerConfig } from "@/lib/mcp-config-file";
import { signInMcpServerWithPrompt } from "@/lib/mcp-auth-command";
import type { McpServerConfig } from "@/lib/mcp-validator";
import type { McpSignInPrompt } from "@/lib/pi-sdk-internals";

export const dynamic = "force-dynamic";

declare global {
  var __piMcpOauthCallbacks:
    | Map<string, { resolve: (value: string) => void; reject: (error: Error) => void }>
    | undefined;
}

function callbackRegistry() {
  if (!globalThis.__piMcpOauthCallbacks) globalThis.__piMcpOauthCallbacks = new Map();
  return globalThis.__piMcpOauthCallbacks;
}

function scopeFile(cwd: string, scope: string | null): string {
  return scope === "project" ? join(cwd, ".pi", "mcp.json") : join(getAgentDir(), "mcp.json");
}

// POST — 回填 callback URL（loopback 不可达时的粘贴分支）。
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const body = (await req.json().catch(() => ({}))) as { token?: string; code?: string };
  if (!body.token || !body.code?.trim()) {
    return NextResponse.json({ error: "token and code required" }, { status: 400 });
  }
  const pending = callbackRegistry().get(body.token);
  if (!pending) return NextResponse.json({ error: "No pending MCP sign-in for token" }, { status: 404 });
  pending.resolve(body.code.trim());
  return NextResponse.json({ ok: true });
}

// GET — SSE：auth URL / 粘贴请求 / 成功 / 取消 / 错误。
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const name = searchParams.get("name");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const server = await getMcpServerConfig(scopeFile(cwd, searchParams.get("scope")), name);
    if (!server) return NextResponse.json({ error: "server not found" }, { status: 404 });
    if (!("url" in server)) {
      return NextResponse.json({ error: "Only remote (url) servers can sign in with OAuth" }, { status: 400 });
    }
    return new Response(buildOAuthStream(req, name, server), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

function buildOAuthStream(req: Request, name: string, server: Extract<McpServerConfig, { url: string }>): ReadableStream {
  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  return new ReadableStream({
    async start(controller) {
      const registry = callbackRegistry();
      const token = `mcp-${randomUUID()}`;
      const cleanup = () => {
        registry.get(token)?.reject(new Error("Sign-in cancelled"));
        registry.delete(token);
      };
      abort.signal.addEventListener("abort", cleanup);

      const prompt: McpSignInPrompt = {
        showAuthorizationUrl(url) {
          send(controller, { type: "auth", url: url.toString(), token });
        },
        promptForRedirectUrl(signal) {
          const promise = new Promise<string>((resolve, reject) => {
            registry.set(token, {
              resolve: (value) => {
                registry.delete(token);
                resolve(value);
              },
              reject: (error) => {
                registry.delete(token);
                reject(error);
              },
            });
          });
          // pi 的 loopback 回调到达时会 abort 这个 signal，粘贴框随即失效。
          signal.addEventListener("abort", () => {
            registry.get(token)?.reject(new Error("Sign-in cancelled"));
            registry.delete(token);
          }, { once: true });
          send(controller, { type: "prompt", token, message: "Paste the redirect URL from the browser address bar." });
          return promise;
        },
      };

      try {
        const outcome = await signInMcpServerWithPrompt({ name, server, prompt });
        if (outcome.ok) send(controller, { type: "success" });
        else if (outcome.cancelled) send(controller, { type: "cancelled" });
        else send(controller, { type: "error", message: outcome.error });
      } catch (error) {
        send(controller, { type: "error", message: error instanceof Error ? error.message : String(error) });
      } finally {
        cleanup();
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
}
