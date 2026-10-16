import test from "node:test";
import assert from "node:assert/strict";
import { MAX_FENCE_DOCUMENT_BYTES, fenceDocument } from "../src/renderer/src/lib/markdown-fence.ts";
import { MAX_INLINE_DOCUMENT_BYTES, decodeInlineDocument, encodeInlineDocument } from "../src/shared/inline-document.ts";

/**
 * A fence is offered a 预览 only when it is a whole document, and the document has to
 * survive the trip through the URL. Both are one-way doors for the reader: a fragment shown
 * framed draws a lie about the page it will become, and a payload that comes back wrong
 * renders nothing at all — a button that does nothing is worse than no button.
 */

test("a whole page is a page, a fragment stays source", () => {
  assert.deepEqual(fenceDocument("html", "<!DOCTYPE html>\n<html><body>hi</body></html>"), {
    kind: "html",
    document: "<!DOCTYPE html>\n<html><body>hi</body></html>",
  });
  assert.equal(fenceDocument("html", "<!doctype HTML><html></html>")?.kind, "html", "case does not matter");
  assert.equal(fenceDocument("html", "\uFEFF\n<!-- generated -->\n<html></html>")?.kind, "html", "BOM and a comment come first");
  assert.equal(fenceDocument("htm", "<html lang=\"en\"></html>")?.kind, "html");
  assert.equal(fenceDocument("xhtml", "<html></html>")?.kind, "html");

  // The cases that must NOT get a preview button.
  assert.equal(fenceDocument("html", "<div class=\"hero\">hi</div>"), null, "a fragment has no page of its own");
  assert.equal(fenceDocument(undefined, "<!DOCTYPE html><html></html>"), null, "no language is a quotation");
  assert.equal(fenceDocument("html", ""), null);
  assert.equal(fenceDocument("html", "   \n  "), null);
  assert.equal(fenceDocument("js", "<html></html>"), null, "the language has to name a page");
  assert.equal(fenceDocument("python", "<html></html>"), null);
});

test("an svg root is a page, and so is one an html fence carries", () => {
  assert.equal(fenceDocument("svg", "<svg viewBox=\"0 0 10 10\"><circle r=\"4\"/></svg>")?.kind, "svg");
  assert.equal(fenceDocument("xml", "  <svg xmlns=\"http://www.w3.org/2000/svg\"/>")?.kind, "svg");
  assert.equal(fenceDocument("svg", "<?xml version=\"1.0\"?>\n<svg/>")?.kind, "svg", "a prolog comes first");
  assert.equal(fenceDocument("html", "<svg viewBox=\"0 0 4 4\"></svg>")?.kind, "svg", "html fences can hold one");
  assert.equal(fenceDocument("svg", "<rect width=\"10\" height=\"10\"/>"), null, "an svg fragment is not a page");
});

test("the two copies of the cap are one number", () => {
  // The fence module carries its own literal so `node --test` can load it (no alias
  // resolution), and the shared module is the one that actually serves the URL. A change to
  // either has to be a change to both, which is what this asserts.
  assert.equal(MAX_FENCE_DOCUMENT_BYTES, MAX_INLINE_DOCUMENT_BYTES);
});

test("a document too large to serve is not offered a preview", () => {
  const filler = "x".repeat(MAX_FENCE_DOCUMENT_BYTES + 1);
  assert.equal(fenceDocument("html", `<!DOCTYPE html><html>${filler}</html>`), null);
  const fits = "y".repeat(1024);
  assert.equal(fenceDocument("html", `<!DOCTYPE html><html>${fits}</html>`)?.kind, "html");
});

test("a document survives the URL it travels in", () => {
  const document = "<!DOCTYPE html>\n<html><body><p>中文 + ünïcødé</p><p># ? &amp; =</p></body></html>";
  const payload = encodeInlineDocument(document);
  assert.match(payload, /^[A-Za-z0-9_-]+$/, "base64url: no padding, no characters a URL reserves");
  assert.equal(decodeInlineDocument(payload), document);

  // Bytes outside the BMP, and a multi-byte character split across the encoding path.
  const emoji = "<!DOCTYPE html><p>🎛️ 图表</p>";
  assert.equal(decodeInlineDocument(encodeInlineDocument(emoji)), emoji);

  assert.equal(decodeInlineDocument(""), null);
  assert.equal(decodeInlineDocument(null), null);
  assert.equal(decodeInlineDocument("not base64!!"), null);
  assert.equal(decodeInlineDocument("////"), null, "valid base64url, but not UTF-8 text");
});
