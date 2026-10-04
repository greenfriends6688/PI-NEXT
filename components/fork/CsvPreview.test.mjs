import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { CsvPreview } = await jiti.import("./CsvPreview.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(CsvPreview, props)));
}

test("fork:v5-landing — the meta strip is the board viewer bar", () => {
  const html = render({ content: "name,city\nada,oslo\n", filePath: "/data/rows.csv" });

  assert.match(html, /<div class="d-viewer" style="height:100%">/);
  assert.match(html, /<div class="d-viewer-bar">/);
  assert.match(html, /<i data-ico="table" data-size="13"><\/i>/);
  // Delimiter / row count / column count are board badges now, not bare spans.
  assert.match(html, /<span class="d-badge mute">[^<]*<\/span><span class="d-badge mute">1 rows<\/span>/);
  assert.match(html, /<span class="d-badge mute">2 columns<\/span>/);
});

test("fork:v5-landing — the first column carries the source row number", () => {
  const html = render({ content: "name,city\nada,oslo\ngrace,nyc\n", filePath: "/data/rows.csv" });

  // A `#` header plus a right-aligned, dimmed number per body row.
  assert.match(html, /<th class="d-mono"[^>]*width:36px" title="#">#<\/th>/);
  assert.match(html, /<td class="d-mono d-t-faint"[^>]*width:36px">1<\/td>/);
  assert.match(html, /<td class="d-mono d-t-faint"[^>]*width:36px">2<\/td>/);
  // Windowed spacers have to span the extra column or the table tears.
  assert.doesNotMatch(html, /colspan="2"/);
});

test("the empty table renders the board empty state instead of a bare line", () => {
  const html = render({ content: "", filePath: "/data/rows.csv" });

  assert.match(html, /<div class="d-empty"[^>]*>\s*<div class="d-empty-ico"><i data-ico="table" data-size="20"><\/i><\/div>\s*<div class="d-empty-t">[^<]*no rows to preview<\/div>/);
  assert.doesNotMatch(html, /<table/);
});
