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

test("fork:v5-landing — the fallback file is a board card, not an inline block", () => {
  const html = render({ filePath: "D:/workspace/dist/bundle.zip", cwd: "D:/workspace", size: 2_400_000 });

  assert.match(html, /<div class="d-empty" role="status" style="height:100%">\s*<div class="d-card" style="width:100%;max-width:560px">/);
  assert.match(html, /<i data-ico="file" data-size="14"><\/i><span class="d-grow d-mono">bundle\.zip<\/span>/);
  // Name + type + size are all still there, as board badges.
  assert.match(html, /<span class="d-badge mute">Type: zip<\/span>/);
  assert.match(html, /<span class="d-badge mute">2\.3 MB<\/span>/);
  // Both actions survive, as board buttons.
  assert.match(html, /<button type="button" class="d-btn sm"[^>]*><i data-ico="folder-open"[^>]*><\/i>/);
  assert.match(html, /<button type="button" class="d-btn sm primary"[^>]*><i data-ico="external-link"[^>]*><\/i>/);
  // The copyable path is kept, in the card foot.
  assert.match(html, /<div class="d-pop-foot" style="border-top:1px solid var\(--nx-line\)"><span class="d-mono">D%3A\/workspace\/dist\/bundle\.zip<\/span>/);
});

test("an unknown size drops the size badge instead of guessing one", () => {
  const html = render({ filePath: "D:/workspace/blob.unknown" });

  assert.match(html, /<span class="d-grow d-mono">blob\.unknown<\/span>/);
  assert.doesNotMatch(html, /<span class="d-badge mute">[\d.]+ ?[KMGT]?B<\/span>/);
});
