import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Request and response plumbing, kept free of any knowledge of what this service does.
 *
 * Every response here ends the request. A handler that returns without answering leaves a
 * socket open until the client gives up, which on a login page reads as "the service is down".
 */

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
    "cache-control": "no-store",
  });
  response.end(text);
}

/** The failure envelope the client parses: `{ error: { code } }`. */
export function sendError(response: ServerResponse, status: number, code: string): void {
  sendJson(response, status, { error: { code } });
}

export function sendHtml(response: ServerResponse, status: number, html: string): void {
  const text = `<!doctype html>${html}`;
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    // A page that carries a sign-in decision is never framed by somebody else's site.
    "x-frame-options": "DENY",
    "referrer-policy": "same-origin",
  });
  response.end(text);
}

export function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location, "cache-control": "no-store" });
  response.end();
}

/**
 * Read a JSON body with a hard ceiling.
 *
 * The ceiling is what keeps a large POST from being a memory exhaustion: `content-length` is a
 * claim, so the limit is enforced on what actually arrives.
 */
export async function readJson(request: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  const text = await readBody(request, limit);
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function readForm(request: IncomingMessage, limit = 64 * 1024): Promise<Record<string, string>> {
  const text = await readBody(request, limit);
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(text)) out[key] = value;
  return out;
}

export async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > limit) throw new Error("body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function cookiesOf(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (typeof header !== "string") return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

export function setCookie(
  response: ServerResponse,
  name: string,
  value: string,
  options: { maxAgeSeconds?: number; secure: boolean; clear?: boolean },
): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    options.maxAgeSeconds !== undefined ? `Max-Age=${options.clear ? 0 : options.maxAgeSeconds}` : "",
    // Only over TLS: a Secure cookie on a plain-http development origin is silently dropped,
    // which looks exactly like a broken sign-in.
    options.secure ? "Secure" : "",
  ].filter(Boolean);
  const existing = response.getHeader("set-cookie");
  const list = Array.isArray(existing) ? existing : typeof existing === "string" ? [existing] : [];
  response.setHeader("set-cookie", [...list, parts.join("; ")]);
}

/** Escape for interpolation into HTML text or an attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A page with the shared chrome, so every page this service draws looks like the same thing. */
export function page(title: string, body: string, options: { origin: string }): string {
  return `<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · PI NEXT</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  font:15px/1.6 system-ui,-apple-system,"PingFang SC",sans-serif;background:#fafafa;color:#18181b}
@media(prefers-color-scheme:dark){body{background:#18181b;color:#fafafa}}
.card{width:100%;max-width:26rem;margin:1.5rem;padding:1.75rem;border-radius:1rem;
  background:#fff;border:1px solid #e4e4e7;box-shadow:0 1px 3px rgb(0 0 0/.06)}
@media(prefers-color-scheme:dark){.card{background:#27272a;border-color:#3f3f46}}
h1{margin:0 0 .35rem;font-size:1.125rem;font-weight:600}
p{margin:0 0 1.25rem;color:#71717a;font-size:.875rem}
dl{margin:0 0 1.25rem;font-size:.875rem}
dt{color:#71717a;font-size:.75rem;margin-top:.6rem}
dd{margin:.1rem 0 0;word-break:break-all}
.row{display:flex;gap:.5rem;margin-top:1.25rem}
button,a.btn{flex:1;padding:.6rem .9rem;border-radius:.6rem;border:1px solid transparent;
  font:inherit;font-weight:500;text-align:center;text-decoration:none;cursor:pointer}
.primary{background:#2b6cf6;color:#fff}
.ghost{background:transparent;color:inherit;border-color:#d4d4d8}
@media(prefers-color-scheme:dark){.ghost{border-color:#52525b}}
.muted{font-size:.75rem;color:#a1a1aa;margin:1rem 0 0}
</style></head><body><div class="card">${body}</div></body></html>`;
}
