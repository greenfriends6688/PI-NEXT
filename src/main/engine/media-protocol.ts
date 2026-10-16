import { Readable } from "node:stream";
import { protocol } from "electron";
import { decodeScopedId } from "@shared/server-scope";
import { INLINE_HTML_CSP, mediaPathFromUrl } from "@shared/media-preview";
import { openMediaBody } from "./media-file";
import { inlineDocumentResponse } from "./inline-document-http";
import { fetchRemoteMedia, type RemoteMediaEndpoint } from "./remote-media";

export type MediaProtocolDeps = {
  /** Where a remote ref's bytes are. Absent means this install has no remote connections. */
  remoteEndpoint: (serverInstanceId: string) => RemoteMediaEndpoint | null;
};

/**
 * Serves `pinext-media://media/play?path=` to the renderer's `<img>` and `<video>`.
 *
 * A local path is read from disk. A remote ref is proxied as a binary stream from the
 * machine that has the file. Either way the preview payload itself holds no bytes.
 */
export function registerMediaProtocol(deps: MediaProtocolDeps): void {
  protocol.handle("pinext-media", async (request) => {
    // A document a reply wrote in a fence: no file, no registry — the text is in the URL.
    // Checked before the file path, since `doc` is a host of its own and never a path.
    const inline = inlineDocumentFromUrl(request.url);
    if (inline !== null) return inlineDocumentResponse(inline);
    const requested = mediaPathFromUrl(request.url);
    if (!requested) return new Response(null, { status: 400 });
    const remote = decodeScopedId(requested);
    if (remote) {
      return withPageCsp(
        await fetchRemoteMedia(
          deps.remoteEndpoint(remote.serverInstanceId),
          requested,
          request.method,
          request.headers.get("range"),
        ),
      );
    }
    const opened = openMediaBody(requested, request.method, request.headers.get("range"));
    if (!opened.ok) return new Response(null, { status: opened.status, headers: opened.headers });
    const body = opened.stream ? (Readable.toWeb(opened.stream) as ReadableStream<Uint8Array>) : null;
    if (opened.stream) {
      const nodeStream = opened.stream;
      const abort = (): void => {
        nodeStream.destroy();
      };
      request.signal.addEventListener("abort", abort);
      nodeStream.on("close", () => request.signal.removeEventListener("abort", abort));
    }
    return withPageCsp(new Response(body, { status: opened.status, headers: opened.headers }));
  });
}

/**
 * A served HTML page carries its own policy, whichever machine it came from: the header is
 * what keeps it from reading beyond https, so it is set here and not trusted from upstream.
 */
function withPageCsp(response: Response): Response {
  if (!response.headers.get("content-type")?.startsWith("text/html")) return response;
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", INLINE_HTML_CSP);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * The payload of a `pinext-media://doc/<payload>` request, or null for any other URL.
 */
export function inlineDocumentFromUrl(requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "pinext-media:" || url.hostname !== "doc") return null;
  return url.pathname.replace(/^\//, "") || null;
}
