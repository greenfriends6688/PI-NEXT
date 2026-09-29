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

test("fork:design-system SW-D — the meta strip is the board viewer head", () => {
  const html = render({ content: "name,city\nada,oslo\n", filePath: "/data/rows.csv" });

  assert.match(html, /<div class="pw-viewer-head">/);
  assert.match(html, /<span class="pw-ico"><i data-ico="table" data-size="13"><\/i><\/span>/);
  // Delimiter / row count / column count are badges now, not bare spans.
  assert.match(html, /<span class="pw-badge">[^<]*<\/span><span class="pw-badge count">1 rows<\/span>/);
  assert.match(html, /<span class="pw-badge count">2 columns<\/span>/);
});

test("fork:design-system SW-D — the first column carries the source row number", () => {
  const html = render({ content: "name,city\nada,oslo\ngrace,nyc\n", filePath: "/data/rows.csv" });

  // A `#` header plus a right-aligned, dimmed number per body row.
  assert.match(html, /<th class="num"[^>]*width:36px" title="#">#<\/th>/);
  assert.match(html, /<td class="num pw-dim"[^>]*width:36px">1<\/td>/);
  assert.match(html, /<td class="num pw-dim"[^>]*width:36px">2<\/td>/);
  // Windowed spacers have to span the extra column or the table tears.
  assert.doesNotMatch(html, /colspan="2"/);
});

test("the empty table renders the board empty state instead of a bare line", () => {
  const html = render({ content: "", filePath: "/data/rows.csv" });

  assert.match(html, /<div class="pw-empty">\s*<div class="pw-empty-inner">/);
  assert.match(html, /<span class="mark" style="width:32px;height:32px">/);
  assert.match(html, /no rows to preview/);
  assert.doesNotMatch(html, /<table/);
});
