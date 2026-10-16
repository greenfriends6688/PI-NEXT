/** Write one local media file to an HTTP response, honoring `Range`. */
import { createReadStream } from "node:fs";
import { INLINE_HTML_CSP } from "../../shared/media-preview.ts";
import { openMediaBody } from "./media-file.ts";
import type { IncomingMessage, ServerResponse } from "node:http";

export function pipeMediaHttp(request: IncomingMessage, response: ServerResponse, filePath: string): void {
  const opened = openMediaBody(filePath, request.method ?? "GET", headerValue(request.headers.range));
  if (!opened.ok) {
    response.writeHead(opened.status, opened.headers ?? { "cache-control": "no-store" });
    response.end();
    return;
  }
  // A page served to the browser client carries the same policy the Electron side gives it
  // (see `media-protocol.ts`'s `withPageCsp`): a served HTML page may run its own inline code
  // and reach https, and nothing else. Without this the two clients would hand the very same
  // document different powers, and the browser one — which has no `sandbox` attribute to fall
  // back on when the page is opened directly — would be the permissive half.
  if (opened.headers["content-type"]?.startsWith("text/html")) {
    opened.headers["content-security-policy"] = INLINE_HTML_CSP;
  }
  response.writeHead(opened.status, opened.headers);
  const stream = opened.stream;
  if (!stream) {
    response.end();
    return;
  }
  const stop = (): void => {
    stream.destroy();
  };
  request.on("close", stop);
  stream.on("error", stop);
  stream.on("close", () => request.removeListener("close", stop));
  stream.pipe(response);
}

function headerValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}
