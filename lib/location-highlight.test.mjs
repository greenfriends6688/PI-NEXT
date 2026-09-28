import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const [helperSource, globalCss, codeEditorSource] = await Promise.all([
  readFile(new URL("./location-highlight.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../components/CodeFileEditor.tsx", import.meta.url), "utf8"),
]);

test("preview location highlight uses the runtime class in both preview surfaces", () => {
  assert.match(helperSource, /LOCATION_HIGHLIGHT_CLASS\s*=\s*["']location-highlight["']/);
  assert.match(globalCss, /\.location-highlight\s*(?:,|\{)/);
  // fork:perf-viewer-two-modes — this used to assert a `.markdown-editable >` rule in
  // the WYSIWYG editor's stylesheet. The live editor is CodeMirror now and marks a whole
  // line, so the shared `globals.css` rule is the only one involved.
  assert.match(codeEditorSource, /Decoration\.line\(\{ class: LOCATION_HIGHLIGHT_CLASS \}\)/);
});
