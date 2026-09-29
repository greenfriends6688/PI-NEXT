import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { UnsupportedFilePreview } = await jiti.import("./UnsupportedFilePreview.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(UnsupportedFilePreview, props)));
}

test("fork:design-system SW-D — the fallback file is a board card, not an inline block", () => {
  const html = render({ filePath: "D:/workspace/dist/bundle.zip", cwd: "D:/workspace", size: 2_400_000 });

  assert.match(html, /<div class="pw-empty" role="status" style="height:100%">\s*<div class="pw-empty-inner" style="width:100%">/);
  assert.match(html, /<span class="pw-ico"><i data-ico="file" data-size="13"><\/i><\/span><span class="pw-tool">bundle\.zip<\/span>/);
  // Name + type + size are all still there, as badges.
  assert.match(html, /<span class="pw-badge">Type: zip<\/span>/);
  assert.match(html, /<span class="pw-badge count">2\.3 MB<\/span>/);
  // Both actions survive, as board buttons.
  assert.match(html, /<button type="button" class="pw-btn sm"[^>]*>[\s\S]*?folder-open[\s\S]*?<\/button>/);
  assert.match(html, /<button type="button" class="pw-btn sm primary"[^>]*>[\s\S]*?external-link[\s\S]*?<\/button>/);
  // The copyable path is kept, in the card foot.
  assert.match(html, /<div class="pw-card-foot"><span class="pw-mono pw-dim">D%3A\/workspace\/dist\/bundle\.zip<\/span>/);
});

test("an unknown size drops the size badge instead of guessing one", () => {
  const html = render({ filePath: "D:/workspace/blob.unknown" });

  assert.match(html, /<span class="pw-tool">blob\.unknown<\/span>/);
  assert.doesNotMatch(html, /pw-badge count/);
});
