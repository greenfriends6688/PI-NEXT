import { INLINE_HTML_CSP } from "../../shared/media-preview.ts";
import { MAX_INLINE_DOCUMENT_BYTES, decodeInlineDocument } from "../../shared/inline-document.ts";

/**
 * The answer for a document a reply wrote — a page with no file behind it.
 *
 * Shared by the two things that can serve one: the desktop's `pinext-media://doc/<payload>`
 * protocol handler and the browser client's `/api/media/doc/<payload>` route. Both hand it
 * the payload from the URL, so a page cannot behave differently depending on which shell
 * asked for it.
 *
 * It is deliberately **synchronous and byte-shaped** rather than a `Response`: the remote
 * access server writes its HTTP answers from a synchronous request handler, and building a
 * `Response` just to read its bytes back would mean making that whole path async for one
 * route. `inlineDocumentResponse` below adapts this for the protocol handler, which does
 * speak `Response`.
 *
 * It lives in its own module for one reason: `server.ts` is loaded directly by
 * `test/media-preview.test.ts`, so everything it imports has to resolve without the
 * `@shared/*` alias — and `media-protocol.ts`, which imports `electron`, can never be one of
 * those. The imports here are relative for that reason; do not tidy them into aliases.
 *
 * `no-store` because the same URL is the same bytes for ever: a rewritten reply produces a
 * different payload, so caching one would only pin memory. The CSP is `INLINE_HTML_CSP` and
 * the frame that loads it is sandboxed without `allow-same-origin`, so the page may run its
 * own inline code and load https libraries while reaching none of the app.
 */

export type InlineDocument = {
  status: number;
  headers: Record<string, string>;
  /** The document itself; empty for a refusal, which has nothing to serve. */
  html: string;
};

const DOCUMENT_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": INLINE_HTML_CSP,
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

/** A refusal carries no CSP of its own: there is no document to constrain. */
function refusal(): InlineDocument {
  return { status: 400, headers: { "cache-control": "no-store" }, html: "" };
}

export function inlineDocument(payload: string): InlineDocument {
  // The cap applies to the decoded text, and the encoded form is at most 4/3 of it — so a
  // payload that cannot possibly fit is refused before it is decoded at all.
  if (payload.length > Math.ceil((MAX_INLINE_DOCUMENT_BYTES * 4) / 3) + 8) return refusal();
  const html = decodeInlineDocument(payload);
  if (html === null) return refusal();
  if (new TextEncoder().encode(html).byteLength > MAX_INLINE_DOCUMENT_BYTES) return refusal();
  return { status: 200, headers: DOCUMENT_HEADERS, html };
}

/** The same answer as a `Response`, for the `protocol.handle` side. */
export function inlineDocumentResponse(payload: string): Response {
  const answer = inlineDocument(payload);
  return new Response(answer.html.length > 0 ? answer.html : null, {
    status: answer.status,
    headers: answer.headers,
  });
}
