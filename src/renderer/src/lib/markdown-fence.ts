/**
 * Which fenced blocks in a reply are pages rather than source.
 *
 * A model writes a chart, a demo page or a diagram inline in its answer, and reading it as
 * highlighted text is the one way that never shows what it does. The decision here is
 * deliberately narrow, because a wrong "yes" costs more than a missed preview: only a
 * **complete document** qualifies. A fragment (`<div class="hero">…`) has no own layout, no
 * `<head>` and no idea of its size, so framed it draws a lie; it stays source, which the
 * reader can still copy into a file.
 *
 * The same rule as `components/chat/preview-panel.tsx` draws for a file: the frame is
 * served with `INLINE_HTML_CSP` and sandboxed without `allow-same-origin`, so the page may
 * run its own inline code and load https libraries while reaching none of the app. Nothing
 * here decides *when* it runs — the caller puts a button in front of it, so a transcript
 * reopening never starts a loop somebody wrote into a reply.
 */

export type FenceDocument = { kind: "html" | "svg"; document: string };

/**
 * The most a document may weigh, repeated from `shared/inline-document.ts`.
 *
 * Repeated because this module is loaded by `node --test`, which resolves neither the
 * `@shared/*` alias nor a bare specifier — the same reason a loose extension file carries
 * its own copy of a list. `test/markdown-fence.test.ts` pins the two together, so the text
 * and the URL cap cannot drift apart silently.
 */
export const MAX_FENCE_DOCUMENT_BYTES = 256 * 1024;

const HTML_LANGUAGES = new Set(["html", "htm", "xhtml"]);
const SVG_LANGUAGES = new Set(["svg", "xml", "html", "htm"]);

/** `<!DOCTYPE html>` / `<html …>`, allowing a BOM, whitespace and a leading comment. */
function looksLikeHtmlDocument(text: string): boolean {
  const head = text.replace(/^\uFEFF/, "").replace(/^\s*(<!--[\s\S]*?-->\s*)*/, "");
  return /^<!doctype\s+html[\s>]/i.test(head) || /^<html[\s/>]/i.test(head);
}

/** An `<svg>` root, either bare or inside the boilerplate a model likes to add. */
function looksLikeSvgDocument(text: string): boolean {
  const head = text
    .replace(/^\uFEFF/, "")
    .replace(/^\s*(<!--[\s\S]*?-->\s*)*/, "")
    .replace(/^<\?xml[^>]*\?>\s*/i, "")
    .replace(/^<!doctype\s+svg[^>]*>\s*/i, "");
  // `<svg/>` is a document like `<svg>` is: the self-closing slash comes right after the
  // name, which is exactly the shape a one-line graphic takes.
  return /^<svg[\s/>]/i.test(head);
}

/**
 * The document a fence holds, or null when it is source, a fragment, or too large to serve.
 *
 * A fence with no language is never a page: ```\n<!DOCTYPE html>… is a model quoting a
 * document, which is exactly the case where "show me the source" is the right answer.
 */
export function fenceDocument(language: string | undefined, code: string): FenceDocument | null {
  if (language === undefined) return null;
  const name = language.toLowerCase();
  const text = code.trim();
  if (text.length === 0) return null;
  // The cap is the one the URL can carry: past it the frame would come up blank, and a
  // preview button that does nothing is worse than no button.
  if (new TextEncoder().encode(code).length > MAX_FENCE_DOCUMENT_BYTES) return null;
  if (HTML_LANGUAGES.has(name) && looksLikeHtmlDocument(text)) return { kind: "html", document: code };
  if (SVG_LANGUAGES.has(name) && looksLikeSvgDocument(text)) return { kind: "svg", document: code };
  return null;
}
