import { mediaDocumentUrl } from "./media-base.ts";

/**
 * A document a reply wrote, served back to the app as a page of its own.
 *
 * A fenced ```html block has no file behind it, and a `srcdoc` frame cannot stand in for
 * one: an `about:srcdoc` document inherits the window's CSP, whose `script-src 'self'`
 * blocks every inline `<script>` a chart or a demo carries — the same reason a real `.html`
 * file is framed from the media scheme rather than handed to `srcDoc` (see
 * `components/chat/preview-panel.tsx`).
 *
 * So the document travels in the URL: the renderer encodes the text, the host decodes it
 * and answers with `INLINE_HTML_CSP`, and the frame is sandboxed without
 * `allow-same-origin`. There is no registry and nothing to clean up — a page exists for
 * exactly as long as something points at it, which is also why a reply that is scrolled
 * away costs nothing.
 *
 * The cap is what keeps that honest: a URL is not a file, Chromium refuses a very long
 * one, and a preview that silently fails to load is worse than no preview button. Above
 * it the fence stays source, which is what the reader can still copy or save.
 */
export const MAX_INLINE_DOCUMENT_BYTES = 256 * 1024;

/** Where this page fetches one inline document from, for the shell it is running in. */
export function inlineDocumentUrl(html: string): string {
  return mediaDocumentUrl(encodeInlineDocument(html));
}

/**
 * The payload of an inline-document URL, or null when it is absent, too large or corrupt.
 *
 * `base64url`, because the text is a whole HTML document: percent-encoding would triple a
 * page of Chinese prose, and a stray `#` or `?` inside it would cut the URL short.
 */
export function encodeInlineDocument(html: string): string {
  const bytes = new TextEncoder().encode(html);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeInlineDocument(payload: string | null): string | null {
  if (!payload) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
  let binary: string;
  try {
    binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  // `fatal` so a payload that was not UTF-8 in the first place is refused rather than
  // rendered as replacement characters.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
