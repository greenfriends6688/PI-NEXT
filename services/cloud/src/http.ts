/**
 * Request and response plumbing, kept free of any knowledge of what this service does.
 *
 * Everything here speaks the Web platform's `Request` / `Response` / `Headers`, so a handler
 * written against it runs unchanged on a Node server and on a worker. The one response that is
 * easy to get wrong is the cookie: `Set-Cookie` is a list header, so it is appended rather than
 * set, and the host is what turns the list back into repeated header lines.
 *
 * Every helper here returns a complete `Response`; a handler that returns null is the one that
 * is saying "this route is not mine".
 */

const encoder = new TextEncoder();

export function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

export function jsonResponse(status: number, body: unknown, headers: Headers = new Headers()): Response {
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

/** The failure envelope the client parses: `{ error: { code } }`. */
export function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, { error: { code } });
}

export function htmlResponse(status: number, html: string, headers: Headers = new Headers()): Response {
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  // A page that carries a sign-in decision is never framed by somebody else's site.
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "same-origin");
  return new Response(`<!doctype html>${html}`, { status, headers });
}

export function redirectResponse(location: string, headers: Headers = new Headers()): Response {
  headers.set("location", location);
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 302, headers });
}

/**
 * Read a JSON body with a hard ceiling.
 *
 * The ceiling is what keeps a large POST from being a memory exhaustion; a host that already
 * buffered the body still cannot make the parse happen on more than this many bytes.
 */
export async function readJson(request: Request, limit = 64 * 1024): Promise<Record<string, unknown>> {
  const text = await readBody(request, limit);
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function readForm(request: Request, limit = 64 * 1024): Promise<Record<string, string>> {
  const text = await readBody(request, limit);
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(text)) out[key] = value;
  return out;
}

export async function readBody(request: Request, limit: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) throw new Error("body too large");
  const text = await request.text();
  if (byteLength(text) > limit) throw new Error("body too large");
  return text;
}

export function cookiesOf(request: Request): Record<string, string> {
  const header = request.headers.get("cookie");
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

export function setCookie(
  headers: Headers,
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
  headers.append("set-cookie", parts.join("; "));
}

export function bearerOf(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(typeof header === "string" ? header : "");
  return match?.[1] ?? null;
}

export function bearer(request: Request): string | null {
  return bearerOf(request.headers.get("authorization"));
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
